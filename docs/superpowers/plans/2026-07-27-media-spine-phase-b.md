# Media Spine Phase B — Your Own Footage + Captions: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator uploads their own video, ContentLoop transcribes it, burns captions in, and it flows through the same approval → publish path as everything else.

**Architecture:** Upload streams straight to disk under `MEDIA_DIR` (no multipart library needed — the browser POSTs the File as a raw body). `ffprobe` yields a `MediaAsset`. Transcription goes through Groq Whisper. **Captions are rendered by Remotion, not ffmpeg** — see the finding below. Spec: `docs/superpowers/specs/2026-07-27-media-source-spine-design.md`.

**Tech Stack:** TypeScript ESM (`.js` suffixes in `src/`), Express raw-body streaming, `@remotion/compositor-*` `ffprobe`, Groq Whisper (`whisper-large-v3`), Remotion, vitest.

**Conventions:** gates = `npx vitest run` (239 currently) + `npx tsc -p tsconfig.json --noEmit` + `npm run build`. READ every file before modifying. Commit per task. Never bind port 4000. Clean up test artifacts from `data/media/`.

---

## Findings from Phase A that shape this plan

Measured, not assumed — do not re-litigate these:

1. **Neither ffmpeg has `subtitles` or `drawtext`.** Not Remotion's bundled build (42 filters) and not the system build. `videoRenderer.ts:127-149` burns subtitles with ffmpeg's `subtitles` filter, so **caption burn-in is already broken today**, silently, because it is an optional step. Task 5 fixes the existing TTS-reel path and the new upload path with one Remotion mechanism.
2. **Bundled binaries need a library path.** `DYLD_LIBRARY_PATH` (macOS) / `LD_LIBRARY_PATH` (Linux) must point at the compositor dir or they fail with `Library not loaded: libavdevice.dylib`.
3. **Remotion rejects absolute paths and `file://` URLs.** Assets must sit under the bundle's `publicDir` (`MEDIA_DIR`, registered in Phase A) and be referenced relative to it via `staticFile()`. **This is why uploads must land in `MEDIA_DIR/<contentId>/`** — anywhere else and Remotion cannot composite them.
4. Available filters worth using: `scale`, `crop`, `overlay`, `pad` (system) / `scale`, `crop` (bundled), plus `libx264`/`aac` encoders.

**No new npm dependency is required.** A browser `fetch(url, { method: 'POST', body: file })` sends the File as a raw body; Express streams `req` to disk when no body parser is applied to that route. Multipart parsing (`busboy`/`multer`) is unnecessary and would add weight to the one-click bundle.

---

### Task 1: ffprobe wrapper (TDD)

**Files:**
- Create: `src/services/mediaProbe.ts`
- Test: `tests/mediaProbe.test.ts`

- [ ] **Step 1: Write the failing test**

The subprocess call is not unit-testable, but parsing its output and the
accept/reject decision are — and that is where mistakes cause bad data.

Create `tests/mediaProbe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseProbeOutput, describeRejection } from "../src/services/mediaProbe.js";

const raw = [
  "codec_name=h264", "width=1080", "height=1920", "duration=12.053333",
].join("\n");

describe("parseProbeOutput", () => {
  it("parses ffprobe's key=value output", () => {
    expect(parseProbeOutput(raw)).toEqual({
      codec: "h264", width: 1080, height: 1920, durationSec: 12.053333,
    });
  });

  it("returns null when there is no video stream rather than inventing zeros", () => {
    expect(parseProbeOutput("")).toBeNull();
    expect(parseProbeOutput("codec_name=aac")).toBeNull();
  });

  it("tolerates ffprobe reporting duration as N/A", () => {
    // Some containers omit it; dimensions are still usable.
    const out = parseProbeOutput("codec_name=h264\nwidth=1080\nheight=1920\nduration=N/A");
    expect(out?.durationSec).toBeNull();
    expect(out?.width).toBe(1080);
  });

  it("ignores stray blank lines and carriage returns", () => {
    expect(parseProbeOutput("codec_name=h264\r\nwidth=1080\r\n\r\nheight=1920\r\n")?.height).toBe(1920);
  });
});

describe("describeRejection", () => {
  it("accepts a vertical h264 clip of reasonable length", () => {
    expect(describeRejection({ codec: "h264", width: 1080, height: 1920, durationSec: 30 })).toBeNull();
  });

  it("explains a non-vertical clip in plain language", () => {
    const msg = describeRejection({ codec: "h264", width: 1920, height: 1080, durationSec: 30 });
    expect(msg).toMatch(/vertical|9:16/i);
    expect(msg).not.toMatch(/codec|aspect ratio [0-9.]+$/i);
  });

  it("rejects a clip too long for Shorts", () => {
    expect(describeRejection({ codec: "h264", width: 1080, height: 1920, durationSec: 200 }))
      .toMatch(/3 min|too long/i);
  });

  it("accepts a clip with unknown duration rather than guessing", () => {
    // ffprobe could not read it; the platform will reject it later if invalid.
    expect(describeRejection({ codec: "h264", width: 1080, height: 1920, durationSec: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mediaProbe.test.ts`
Expected: FAIL — cannot resolve `../src/services/mediaProbe.js`.

- [ ] **Step 3: Implement**

Create `src/services/mediaProbe.ts`:

```ts
/** Probe uploaded video with the ffprobe that ships inside
 *  @remotion/compositor-*, so no system ffmpeg is required (it cannot be
 *  assumed on a user's machine and would break the one-click bundle).
 *
 *  The binary needs its sibling dylibs on the library path — without that it
 *  fails with "Library not loaded: libavdevice.dylib".
 */
import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Max length YouTube accepts as a Short. */
export const MAX_SHORT_SECONDS = 180;

export interface ProbeResult {
  codec: string;
  width: number;
  height: number;
  durationSec: number | null;
}

/** Locate the platform's compositor package (name varies by os/arch). */
export function resolveCompositorDir(): string | null {
  const base = path.resolve(process.cwd(), "node_modules/@remotion");
  try {
    const dir = readdirSync(base).find((d) => d.startsWith("compositor-"));
    return dir ? path.join(base, dir) : null;
  } catch {
    return null;
  }
}

export function parseProbeOutput(stdout: string): ProbeResult | null {
  const fields = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const width = Number(fields.get("width"));
  const height = Number(fields.get("height"));
  const codec = fields.get("codec_name");
  if (!codec || !(width > 0) || !(height > 0)) return null;

  const rawDuration = fields.get("duration");
  const duration = Number(rawDuration);
  return {
    codec,
    width,
    height,
    durationSec: rawDuration && Number.isFinite(duration) ? duration : null,
  };
}

/** A sentence the uploader can act on, or null when the clip is usable. */
export function describeRejection(probe: ProbeResult): string | null {
  if (probe.height <= probe.width) {
    return "This video is landscape or square — Reels and Shorts need vertical (9:16). Crop it or pick another file.";
  }
  if (probe.durationSec !== null && probe.durationSec > MAX_SHORT_SECONDS) {
    return `This video is ${Math.round(probe.durationSec)}s — too long for Shorts and Reels (max 3 min). Trim it first.`;
  }
  return null;
}

export async function probeVideo(absPath: string): Promise<ProbeResult | null> {
  const dir = resolveCompositorDir();
  if (!dir) throw new Error("Could not locate the bundled ffprobe (@remotion/compositor-*)");
  const bin = path.join(dir, "ffprobe");
  const { stdout } = await execFileAsync(
    bin,
    ["-v", "error", "-select_streams", "v:0", "-show_entries",
      "stream=codec_name,width,height,duration",
      "-of", "default=noprint_wrappers=1", absPath],
    {
      env: { ...process.env, DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir },
      timeout: 30_000,
    }
  );
  return parseProbeOutput(stdout);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mediaProbe.test.ts` → 8 passed.
Run: `npx tsc -p tsconfig.json --noEmit` → clean.

- [ ] **Step 5: Prove the wrapper works on a real file**

```bash
npm run build
ffmpeg -y -f lavfi -i "testsrc=size=1080x1920:rate=30:duration=5" \
  -c:v libx264 -pix_fmt yuv420p /tmp/probe-test.mp4 2>/dev/null
node -e "
import('./dist/src/services/mediaProbe.js').then(async m => {
  console.log('compositor:', m.resolveCompositorDir());
  console.log('probe     :', await m.probeVideo('/tmp/probe-test.mp4'));
});"
rm -f /tmp/probe-test.mp4
```
Expected: `{ codec: 'h264', width: 1080, height: 1920, durationSec: 5 }`.
If the fixture step fails because system ffmpeg lacks `lavfi`, say so and skip
only the fixture — the unit tests still stand.

- [ ] **Step 6: Commit**

```bash
git add src/services/mediaProbe.ts tests/mediaProbe.test.ts
git commit -m "feat(media): ffprobe wrapper using the bundled Remotion binary"
```

---

### Task 2: Streaming upload endpoint

**Files:**
- Modify: `src/api/server.ts`
- Modify: `src/config/configStore.ts` (add `MAX_UPLOAD_MB`)
- Test: `tests/uploadGuards.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/uploadGuards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAcceptedVideoType, resolveMaxUploadBytes } from "../src/domain/uploadGuards.js";

describe("isAcceptedVideoType", () => {
  it("accepts the container types we can probe and render", () => {
    expect(isAcceptedVideoType("video/mp4")).toBe(true);
    expect(isAcceptedVideoType("video/quicktime")).toBe(true);
    expect(isAcceptedVideoType("video/webm")).toBe(true);
  });
  it("is case and parameter tolerant", () => {
    expect(isAcceptedVideoType("VIDEO/MP4")).toBe(true);
    expect(isAcceptedVideoType("video/mp4; codecs=avc1")).toBe(true);
  });
  it("rejects non-video and missing types", () => {
    expect(isAcceptedVideoType("image/png")).toBe(false);
    expect(isAcceptedVideoType("application/pdf")).toBe(false);
    expect(isAcceptedVideoType("")).toBe(false);
    expect(isAcceptedVideoType(undefined)).toBe(false);
  });
});

describe("resolveMaxUploadBytes", () => {
  it("defaults to 500 MB", () => {
    expect(resolveMaxUploadBytes(undefined)).toBe(500 * 1024 * 1024);
  });
  it("honours a configured value in megabytes", () => {
    expect(resolveMaxUploadBytes("100")).toBe(100 * 1024 * 1024);
  });
  it("falls back to the default for nonsense rather than allowing unlimited", () => {
    expect(resolveMaxUploadBytes("abc")).toBe(500 * 1024 * 1024);
    expect(resolveMaxUploadBytes("-5")).toBe(500 * 1024 * 1024);
    expect(resolveMaxUploadBytes("0")).toBe(500 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/uploadGuards.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement the guards**

Create `src/domain/uploadGuards.ts`:

```ts
/** Validation for uploaded video, kept pure so the rules are tested rather
 *  than buried in a request handler. */

const ACCEPTED = new Set([
  "video/mp4", "video/quicktime", "video/webm", "video/x-m4v",
]);

export const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export function isAcceptedVideoType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return ACCEPTED.has(base);
}

/** Megabytes from config → bytes. Anything invalid falls back to the default;
 *  it must never resolve to "unlimited". */
export function resolveMaxUploadBytes(configuredMb: string | undefined): number {
  const mb = Number(configuredMb);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : DEFAULT_MAX_UPLOAD_BYTES;
}
```

- [ ] **Step 4: Register the config key**

READ `src/config/configStore.ts`. Add `'MAX_UPLOAD_MB'` to the `ConfigKey`
union next to `'MAX_TOPICS_PER_SOURCE'`, a schema entry in the `Pipeline`
group, and a default of `'500'` — mirroring exactly how `MAX_TOPICS_PER_SOURCE`
was added.

- [ ] **Step 5: Add the endpoint**

READ `src/api/server.ts` around line 527 (`/api/content/:id/images`) to match
its conventions. Add:

```ts
// Route 2 — bring your own footage. The browser POSTs the File as a RAW body
// (fetch(url, { body: file })), so no multipart library is needed: we stream
// req straight to disk. express.json() does not apply here because the
// content-type is video/*, and the size guard aborts mid-stream rather than
// after a 500 MB file has already landed.
app.post("/api/content/:id/video", async (req, res, next) => {
  try {
    const { isAcceptedVideoType, resolveMaxUploadBytes } = await import("../domain/uploadGuards.js");
    if (!isAcceptedVideoType(req.headers["content-type"])) {
      return void res.status(415).json({ error: "Upload an MP4, MOV or WebM video." });
    }
    const maxBytes = resolveMaxUploadBytes(configStore.get("MAX_UPLOAD_MB"));

    // Must live under MEDIA_DIR: Remotion refuses absolute and file:// paths,
    // and only serves assets from its publicDir (registered as MEDIA_DIR).
    const dir = path.join(MEDIA_DIR, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    const absPath = path.join(dir, "source.mp4");

    let bytes = 0;
    let aborted = false;
    const out = fs.createWriteStream(absPath);

    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes && !aborted) {
          aborted = true;
          out.destroy();
          req.destroy();
          reject(new Error("TOO_LARGE"));
        }
      });
      req.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
      req.pipe(out);
    }).catch((err) => {
      fs.rmSync(absPath, { force: true });
      throw err;
    });

    const { probeVideo, describeRejection } = await import("../services/mediaProbe.js");
    const probe = await probeVideo(absPath);
    if (!probe) {
      fs.rmSync(absPath, { force: true });
      return void res.status(400).json({ error: "That file has no video track we can read." });
    }
    const rejection = describeRejection(probe);
    if (rejection) {
      fs.rmSync(absPath, { force: true });
      return void res.status(400).json({ error: rejection });
    }

    await query(
      `UPDATE content_items SET video_url = $2, render_status = 'pending', updated_at = now() WHERE id = $1`,
      [req.params.id, `/media/${req.params.id}/source.mp4`]
    );

    res.json({
      ok: true,
      asset: {
        kind: "video", url: `/media/${req.params.id}/source.mp4`, absPath,
        durationSec: probe.durationSec, width: probe.width, height: probe.height,
        bytes, origin: "user_upload",
      },
    });
  } catch (err: any) {
    if (err?.message === "TOO_LARGE") {
      const mb = Math.round(resolveMaxUploadBytesSafe());
      return void res.status(413).json({ error: `That video is larger than ${mb} MB. Trim it or export at a lower bitrate.` });
    }
    next(err);
  }
});

/** Small helper so the 413 message can state the real limit. */
function resolveMaxUploadBytesSafe(): number {
  const mb = Number(configStore.get("MAX_UPLOAD_MB"));
  return Number.isFinite(mb) && mb > 0 ? mb : 500;
}
```

Confirm `fs`, `path`, `MEDIA_DIR` and `query` are already imported in
`server.ts` (they are — `MEDIA_DIR` is defined at line 102). Report if not.

- [ ] **Step 6: Verify live**

```bash
npm run build
FRESH=$(mktemp -d)
CONTENTLOOP_DATA_DIR="$FRESH" PORT=4741 CONTENTLOOP_MODE=desktop \
  nohup node dist/src/desktop/main.js > "$FRESH/app.log" 2>&1 &
until curl -fsS http://localhost:4741/api/health >/dev/null 2>&1; do sleep 2; done

# wrong type -> 415 with a human sentence
curl -s -X POST http://localhost:4741/api/content/00000000-0000-0000-0000-000000000000/video \
  -H 'Content-Type: application/pdf' --data 'x' | head -c 200; echo

# real vertical clip -> accepted or a clear rejection
ffmpeg -y -f lavfi -i "testsrc=size=1080x1920:rate=30:duration=3" \
  -c:v libx264 -pix_fmt yuv420p /tmp/up.mp4 2>/dev/null
curl -s -X POST http://localhost:4741/api/content/00000000-0000-0000-0000-000000000000/video \
  -H 'Content-Type: video/mp4' --data-binary @/tmp/up.mp4 | head -c 300; echo

# landscape -> rejected in plain language
ffmpeg -y -f lavfi -i "testsrc=size=1920x1080:rate=30:duration=3" \
  -c:v libx264 -pix_fmt yuv420p /tmp/land.mp4 2>/dev/null
curl -s -X POST http://localhost:4741/api/content/00000000-0000-0000-0000-000000000000/video \
  -H 'Content-Type: video/mp4' --data-binary @/tmp/land.mp4 | head -c 300; echo

pkill -f "dist/src/desktop/main.js"; rm -rf "$FRESH" /tmp/up.mp4 /tmp/land.mp4
```
Expected: 415 message, then either an `asset` payload or a *clear* error (the
content id will not exist, so a DB error there is acceptable — report exactly
what happened rather than claiming success). The landscape clip must be
rejected by `describeRejection`, not by the database.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(media): streaming video upload with size and format guards"
```

---

### Task 3: Transcription via Groq Whisper

**Files:**
- Create: `src/services/transcribe.ts`
- Test: `tests/transcribe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/transcribe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { segmentsToSrt, srtTimestamp } from "../src/services/transcribe.js";

describe("srtTimestamp", () => {
  it("formats SRT timestamps", () => {
    expect(srtTimestamp(0)).toBe("00:00:00,000");
    expect(srtTimestamp(61.5)).toBe("00:01:01,500");
    expect(srtTimestamp(3661.25)).toBe("01:01:01,250");
  });
  it("clamps negatives to zero rather than emitting invalid SRT", () => {
    expect(srtTimestamp(-1)).toBe("00:00:00,000");
  });
});

describe("segmentsToSrt", () => {
  it("numbers cues from 1 and separates them with a blank line", () => {
    const srt = segmentsToSrt([
      { start: 0, end: 1.5, text: "Hello there" },
      { start: 1.5, end: 3, text: "Second line" },
    ]);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,500\nHello there");
    expect(srt).toContain("2\n00:00:01,500 --> 00:00:03,000\nSecond line");
  });
  it("trims whitespace Whisper leaves on segments", () => {
    expect(segmentsToSrt([{ start: 0, end: 1, text: "  padded  " }])).toContain("padded");
  });
  it("skips empty segments rather than emitting blank cues", () => {
    const srt = segmentsToSrt([
      { start: 0, end: 1, text: "" }, { start: 1, end: 2, text: "real" },
    ]);
    expect(srt.trim().startsWith("1")).toBe(true);
    expect(srt).toContain("real");
    expect(srt.split("-->").length - 1).toBe(1);
  });
  it("returns an empty string for no segments", () => {
    expect(segmentsToSrt([])).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/transcribe.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement**

Create `src/services/transcribe.ts`:

```ts
/** Transcribe an uploaded video so captions can be burned in.
 *
 *  Uses Groq's OpenAI-compatible audio endpoint — whisper-large-v3 is already
 *  available on the same key used for scoring, so this needs no new provider.
 *  With no key the creator types or pastes their own captions instead; we
 *  never fabricate a transcript.
 */
import fs from "node:fs";
import { llmConfigStore } from "../config/llmConfigStore.js";

export interface TranscriptSegment { start: number; end: number; text: string }

export function srtTimestamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, "0");
  return `${hh}:${mm}:${ss},${ms}`;
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
  const cues: string[] = [];
  let n = 1;
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    cues.push(`${n++}\n${srtTimestamp(seg.start)} --> ${srtTimestamp(seg.end)}\n${text}\n`);
  }
  return cues.join("\n");
}

/** Returns null when no key is configured — the caller falls back to manual
 *  captions rather than inventing a transcript. */
export async function transcribeVideo(absPath: string): Promise<TranscriptSegment[] | null> {
  // Verified: Groq keys are NOT in configStore — they live in
  // data/llm_configs.json via llmConfigStore.list(). Reuse whichever Groq
  // entry the user already configured for scoring/generation.
  const apiKey =
    llmConfigStore.list().find((c) => c.provider === "groq" && c.apiKey)?.apiKey
    ?? process.env.GROQ_API_KEY
    ?? "";
  if (!apiKey) return null;

  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(absPath)]), "source.mp4");
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${await res.text()}`);

  const data: any = await res.json();
  return (data.segments ?? []).map((s: any) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text ?? ""),
  }));
}
```

Verified while writing this plan: `GROQ_API_KEY` is **not** a `ConfigKey`, and
`llmConfigStore.list()` is the accessor that exposes configured provider keys.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/transcribe.test.ts` → 8 passed.
Run: `npx tsc -p tsconfig.json --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/transcribe.ts tests/transcribe.test.ts
git commit -m "feat(media): transcribe uploaded video via Groq Whisper"
```

---

### Task 4: Render captions in Remotion (fixes the existing path too)

`videoRenderer.ts:127-149` burns subtitles with ffmpeg's `subtitles` filter,
which **does not exist in either ffmpeg build** — so captions silently never
appear today. Remotion composites them instead.

**Files:**
- Create: `src/remotion/CaptionedVideo.tsx`
- Create: `src/domain/srt.ts`
- Modify: `src/remotion/ReelRoot.tsx`
- Test: `tests/srt.test.ts`

- [ ] **Step 1: Write the failing test for SRT parsing**

Create `tests/srt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSrt, cueAtFrame } from "../src/domain/srt.js";

const SRT = `1
00:00:00,000 --> 00:00:02,000
First caption

2
00:00:02,000 --> 00:00:04,500
Second caption
`;

describe("parseSrt", () => {
  it("parses cues with start and end seconds", () => {
    const cues = parseSrt(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 0, end: 2, text: "First caption" });
    expect(cues[1]!.end).toBeCloseTo(4.5, 3);
  });
  it("joins multi-line cue text with a space", () => {
    const cues = parseSrt("1\n00:00:00,000 --> 00:00:01,000\nline one\nline two\n");
    expect(cues[0]!.text).toBe("line one line two");
  });
  it("tolerates CRLF and trailing blank lines", () => {
    expect(parseSrt(SRT.replace(/\n/g, "\r\n") + "\r\n\r\n")).toHaveLength(2);
  });
  it("returns [] for empty or malformed input rather than throwing", () => {
    expect(parseSrt("")).toEqual([]);
    expect(parseSrt("not an srt file")).toEqual([]);
  });
});

describe("cueAtFrame", () => {
  const cues = parseSrt(SRT);
  it("finds the cue covering a frame", () => {
    // frame 30 at 30fps = t=1.0s, inside cue 1.
    expect(cueAtFrame(cues, 30, 30)?.text).toBe("First caption");
  });
  it("returns null between or after cues", () => {
    expect(cueAtFrame(cues, 300, 30)).toBeNull();   // t=10s, past the end
  });
  it("treats the cue end as exclusive so two cues never overlap", () => {
    // t=2.0s belongs to cue 2, not cue 1.
    expect(cueAtFrame(cues, 60, 30)?.text).toBe("Second caption");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/srt.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement the SRT parser**

Create `src/domain/srt.ts`:

```ts
/** Minimal SRT parsing for caption rendering. Pure — no I/O. */

export interface Cue { start: number; end: number; text: string }

function toSeconds(stamp: string): number | null {
  const m = stamp.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

export function parseSrt(input: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of input.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timing = lines.find((l) => l.includes("-->"));
    if (!timing) continue;
    const [rawStart, rawEnd] = timing.split("-->");
    const start = toSeconds(rawStart ?? "");
    const end = toSeconds(rawEnd ?? "");
    if (start === null || end === null) continue;
    const text = lines.slice(lines.indexOf(timing) + 1).join(" ").trim();
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

/** Cue covering a frame, end-exclusive so adjacent cues never both match. */
export function cueAtFrame(cues: Cue[], frame: number, fps: number): Cue | null {
  const t = frame / fps;
  return cues.find((c) => t >= c.start && t < c.end) ?? null;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/srt.test.ts` → all pass (after fixing the
deliberately-wrong assertion).

- [ ] **Step 5: Build the captioned-video composition**

Create `src/remotion/CaptionedVideo.tsx`:

```tsx
import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { parseSrt, cueAtFrame, type Cue } from '../domain/srt';

export interface CaptionedVideoProps {
  /** Path relative to the bundle publicDir (MEDIA_DIR). */
  videoSrc: string;
  /** Raw SRT contents. Empty string renders the clip with no captions. */
  srt: string;
  accent: string;
  /** Optional brand logo, also publicDir-relative. */
  logoSrc?: string;
}

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  videoSrc, srt, accent, logoSrc,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cues: Cue[] = React.useMemo(() => parseSrt(srt), [srt]);
  const cue = cueAtFrame(cues, frame, fps);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <OffthreadVideo src={staticFile(videoSrc)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

      {logoSrc && (
        <img src={staticFile(logoSrc)} alt=""
          style={{ position: 'absolute', top: 48, left: 48, width: 96, height: 96, objectFit: 'contain', opacity: 0.9 }} />
      )}

      {cue && (
        <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: '0 64px 220px' }}>
          <div style={{
            fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 64,
            lineHeight: 1.2, color: '#fff', textAlign: 'center',
            // Stroke + shadow keeps captions legible over any footage, which
            // is why this is composited rather than relying on a plain overlay.
            WebkitTextStroke: '3px rgba(0,0,0,0.85)',
            textShadow: `0 4px 24px rgba(0,0,0,0.9), 0 0 2px ${accent}`,
          }}>
            {cue.text}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: Register the composition**

READ `src/remotion/ReelRoot.tsx`. Register a `CaptionedVideo` composition
alongside the existing `Reel` ones, 1080×1920 at 30fps. Duration must come from
`calculateMetadata` using the probed clip duration — a hardcoded length would
truncate or pad real footage. Import it **extensionless**
(`'./CaptionedVideo'`), matching the Phase A fix; a `.js` suffix breaks the
webpack bundle.

- [ ] **Step 7: Typecheck + build + commit**

```bash
npx tsc -p tsconfig.json --noEmit
npm run build
git add -A
git commit -m "feat(media): composite captions in Remotion instead of ffmpeg's missing subtitles filter"
```

---

### Task 5: Wire upload → transcribe → caption in the editor

**Files:**
- Modify: `src/web/components/editor/ContentEditor.tsx`
- Modify: `src/web/lib/api.ts`
- Create: `src/web/components/editor/VideoUploadPanel.tsx`

- [ ] **Step 1: Add the API client methods**

READ `src/web/lib/api.ts`. Add beside `uploadContentImage`:

```ts
  /** Raw-body upload — the File is sent as the body, no multipart needed. */
  uploadContentVideo: (contentId: string, file: File) =>
    req<{ ok: boolean; asset: any }>(`/content/${contentId}/video`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'video/mp4' },
      body: file,
    }),
  transcribeContentVideo: (contentId: string) =>
    req<{ ok: boolean; srt: string | null }>(`/content/${contentId}/transcribe`, { method: 'POST' }),
```

Verified while writing this plan: `req()` merges caller headers and passes
`body` through untouched (it does not force JSON), so a raw `File` body works
without bypassing it.

- [ ] **Step 2: Build the panel**

Create `src/web/components/editor/VideoUploadPanel.tsx` with:
- a file input (`accept="video/*"`) plus a drop zone,
- an upload progress indication (bytes sent),
- on success, a `<video controls>` preview of the returned URL,
- a "Generate captions" button calling `transcribeContentVideo`,
- an editable `<textarea>` holding the SRT so the creator can correct it, and
  which is the **only** caption source when no Groq key is configured,
- errors rendered as the server's sentence, verbatim — those messages were
  written to be readable.

Follow `ManualGenerateBridge.tsx` for drop-zone conventions. **Do not reuse its
clipboard paste listener** — a browser cannot put a video on the clipboard, so
the copy must say "download it, then drop it here".

- [ ] **Step 3: Mount it on the Reel tab**

In `ContentEditor.tsx`, render `VideoUploadPanel` inside the
`previewTab === 'reel'` branch, above the reel-script section, with a heading
that distinguishes the two routes — e.g. "Use your own video" versus the
existing generated-reel flow. `draftId` is the content id.

- [ ] **Step 4: Typecheck + build + commit**

```bash
npx tsc -p tsconfig.json --noEmit
npm run build
git add -A
git commit -m "feat(media): upload-your-own-video panel in the content editor"
```

---

### Task 6: End-to-end verification + gates

**Files:** none (verification only)

- [ ] **Step 1: Full round trip on a temp instance**

```bash
npm run build
FRESH=$(mktemp -d)
CONTENTLOOP_DATA_DIR="$FRESH" PORT=4742 CONTENTLOOP_MODE=desktop \
  nohup node dist/src/desktop/main.js > "$FRESH/app.log" 2>&1 &
until curl -fsS http://localhost:4742/api/health >/dev/null 2>&1; do sleep 2; done
```
Create a niche → page → topic → content item through the API (see the Task 2
verification for the shape), then upload a real vertical clip and confirm:
- the response contains a `MediaAsset` with correct width/height/duration,
- the file exists under `data/media/<contentId>/source.mp4` — **it must be
  inside MEDIA_DIR or Remotion cannot composite it**,
- `content_items.video_url` is set.

- [ ] **Step 2: Render captions over the uploaded clip**

Write a small SRT by hand, render the `CaptionedVideo` composition, and confirm
with the bundled ffprobe (remember `DYLD_LIBRARY_PATH`) that the output is
1080×1920 h264 with a sane frame count. Extract two frames at different
timestamps and confirm they differ.

**If system ffmpeg is unavailable for frame extraction, say so** rather than
claiming visual verification you did not do.

- [ ] **Step 3: Clean up**

```bash
pkill -f "dist/src/desktop/main.js"; rm -rf "$FRESH"
rm -rf data/media/verify-* /tmp/up.mp4 /tmp/land.mp4
docker compose ps        # user's stack still healthy
```

- [ ] **Step 4: Full gates**

```bash
npx vitest run                      # 239 + ~28 new
npx tsc -p tsconfig.json --noEmit
npm run build
```

- [ ] **Step 5: Report honestly**

State plainly which of these were actually exercised and which were not:
transcription (needs a Groq key), caption rendering, upload guards, the
size-limit abort. Anything unverified must be reported as unverified — the
standard applied to the Windows launcher and Veo.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(media): bring-your-own-video verified end-to-end"
```
