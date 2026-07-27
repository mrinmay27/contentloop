# Media Spine Phase A — Contract + Real Stock Video: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reels stop being slideshows — real moving stock footage renders behind the captions — and the `MediaAsset` contract every later route depends on exists and is tested.

**Architecture:** Introduce a pure `MediaAsset`/availability module (Task 1), then use it to wire the already-written-but-never-called `searchVideos()` into `sourceReelBackgrounds()` (Task 3), and teach `ReelComposition` to render `<OffthreadVideo>` for video assets while keeping `<Img>` for stills (Task 4). Spec: `docs/superpowers/specs/2026-07-27-media-source-spine-design.md`.

**Tech Stack:** TypeScript ESM (`.js` import suffixes mandatory in `src/`), Remotion (`OffthreadVideo`), Pexels video API, vitest.

**Conventions:** gates = `npx vitest run` (222 currently) + `npx tsc -p tsconfig.json --noEmit` + `npm run build`. READ every file before modifying. Commit per task. Never bind port 4000 (the user's dev server) — test on a spare port with a temp `CONTENTLOOP_DATA_DIR`.

**Phase B (upload + captions/edits) is a separate plan** — do not start it here.

---

### Task 1: MediaAsset contract + availability (TDD)

The contract every later route returns, and the rule that a source with no key
reports "needs a key" instead of failing.

**Files:**
- Create: `src/domain/mediaSource.ts`
- Test: `tests/mediaSource.test.ts`

> **Deliberate:** `MediaAsset`, `classifyAspect` and `isPublishableVertical`
> are not consumed until Phase B (upload needs to reject non-vertical footage
> with a real message). They are defined now because the whole point of the
> spine is that every route shares one contract — defining it per-route is how
> routes drift and half-wire. Do not delete them as unused.

- [ ] **Step 1: Write the failing test**

Create `tests/mediaSource.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  resolveAvailability, classifyAspect, isPublishableVertical,
  type MediaSourceDef,
} from "../src/domain/mediaSource.js";

const def = (over: Partial<MediaSourceDef> = {}): MediaSourceDef => ({
  id: "pexels_video", name: "Pexels Video", icon: "🎬", kind: "video",
  docsUrl: "https://www.pexels.com/api/", ...over,
});

describe("resolveAvailability", () => {
  it("is available when the source needs no key", () => {
    expect(resolveAvailability(def({ keyName: undefined }), {})).toBe("available");
  });
  it("is available when the required key is present and non-empty", () => {
    expect(resolveAvailability(def({ keyName: "PEXELS_API_KEY" }),
      { PEXELS_API_KEY: "abc" })).toBe("available");
  });
  it("reports needs_key rather than failing when the key is missing", () => {
    // The whole point: a missing key is a Connect affordance, never a dead end.
    expect(resolveAvailability(def({ keyName: "PEXELS_API_KEY" }), {})).toBe("needs_key");
  });
  it("treats an empty or whitespace key as missing", () => {
    expect(resolveAvailability(def({ keyName: "K" }), { K: "" })).toBe("needs_key");
    expect(resolveAvailability(def({ keyName: "K" }), { K: "   " })).toBe("needs_key");
  });
  it("reports unsupported when the source is explicitly disabled", () => {
    expect(resolveAvailability(def({ supported: false }), {})).toBe("unsupported");
  });
});

describe("classifyAspect", () => {
  it("classifies the three shapes we publish", () => {
    expect(classifyAspect(1080, 1920)).toBe("portrait");
    expect(classifyAspect(1920, 1080)).toBe("landscape");
    expect(classifyAspect(1080, 1080)).toBe("square");
  });
  it("tolerates near-square and near-9:16 rather than demanding exact ratios", () => {
    expect(classifyAspect(1080, 1084)).toBe("square");
    expect(classifyAspect(1078, 1920)).toBe("portrait");
  });
  it("returns null for nonsense dimensions instead of guessing", () => {
    expect(classifyAspect(0, 100)).toBeNull();
    expect(classifyAspect(100, 0)).toBeNull();
    expect(classifyAspect(-5, 10)).toBeNull();
  });
});

describe("isPublishableVertical", () => {
  it("accepts portrait", () => {
    expect(isPublishableVertical(1080, 1920)).toBe(true);
  });
  it("rejects landscape and square — Reels and Shorts need 9:16", () => {
    expect(isPublishableVertical(1920, 1080)).toBe(false);
    expect(isPublishableVertical(1080, 1080)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mediaSource.test.ts`
Expected: FAIL — cannot resolve `../src/domain/mediaSource.js`.

- [ ] **Step 3: Implement**

Create `src/domain/mediaSource.ts`:

```ts
/** The contract every media route produces, and the availability rule that
 *  keeps a missing key from looking like a broken feature.
 *
 *  Pure — no service or DB imports, sibling domain imports only.
 */

export type MediaKind = "image" | "video";

export type MediaOrigin =
  | "generated_image"
  | "stock_video"
  | "user_upload"
  | "ai_video"
  | "external_editor";

export interface MediaAsset {
  kind: MediaKind;
  /** Public URL served by express (e.g. /media/<contentId>/footage/bg_0.mp4). */
  url: string;
  /** Absolute path on disk, for ffprobe / Remotion. */
  absPath: string;
  /** Null for stills. */
  durationSec: number | null;
  width: number;
  height: number;
  bytes: number;
  origin: MediaOrigin;
}

export type Availability = "available" | "needs_key" | "unsupported";

export interface MediaSourceDef {
  id: string;
  name: string;
  icon: string;
  kind: MediaKind;
  docsUrl: string;
  /** Absent ⇒ no key required. */
  keyName?: string;
  /** Set false for a route deliberately not offered on this build. */
  supported?: boolean;
  note?: string;
}

/** A source is never "broken": it is available, needs a key, or unsupported. */
export function resolveAvailability(
  def: MediaSourceDef,
  keys: Record<string, string | undefined>
): Availability {
  if (def.supported === false) return "unsupported";
  if (!def.keyName) return "available";
  return (keys[def.keyName] ?? "").trim().length > 0 ? "available" : "needs_key";
}

export type Aspect = "portrait" | "landscape" | "square";

/** 5% tolerance: real footage is rarely exactly 1080x1920. */
const SQUARE_TOLERANCE = 0.05;

export function classifyAspect(width: number, height: number): Aspect | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= SQUARE_TOLERANCE) return "square";
  return ratio < 1 ? "portrait" : "landscape";
}

/** Reels and Shorts require vertical; anything else needs cropping first. */
export function isPublishableVertical(width: number, height: number): boolean {
  return classifyAspect(width, height) === "portrait";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mediaSource.test.ts` → 12 passed.
Run: `npx tsc -p tsconfig.json --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/domain/mediaSource.ts tests/mediaSource.test.ts
git commit -m "feat(media): MediaAsset contract + availability model"
```

---

### Task 2: Prefer real video in stock sourcing

`searchVideos()` is fully implemented and called from nowhere — this is why
every reel is a slideshow.

**Files:**
- Modify: `src/services/stockFootage.ts` (`sourceReelBackgrounds`, ~line 238)
- Test: `tests/stockFootagePreference.test.ts`

- [ ] **Step 1: Write the failing test**

`sourceReelBackgrounds` does network + disk I/O, so extract and test the pure
decision instead. Create `tests/stockFootagePreference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickBackgroundPlan } from "../src/services/stockFootage.js";

describe("pickBackgroundPlan", () => {
  it("uses video for every slide when enough clips exist", () => {
    const plan = pickBackgroundPlan(3, 5, 10);
    expect(plan).toEqual(["video", "video", "video"]);
  });

  it("falls back to images for slides beyond the available clips", () => {
    // Mixing is correct: two good clips beat two clips plus a black gap.
    expect(pickBackgroundPlan(4, 2, 10)).toEqual(["video", "video", "image", "image"]);
  });

  it("uses images throughout when no clips are available", () => {
    expect(pickBackgroundPlan(3, 0, 10)).toEqual(["image", "image", "image"]);
  });

  it("returns nothing to source when there is no media at all", () => {
    // Composition falls back to gradient backgrounds, which already works.
    expect(pickBackgroundPlan(3, 0, 0)).toEqual([]);
  });

  it("never plans more slots than slides", () => {
    expect(pickBackgroundPlan(2, 99, 99)).toHaveLength(2);
  });

  it("handles a zero-slide reel without throwing", () => {
    expect(pickBackgroundPlan(0, 5, 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stockFootagePreference.test.ts`
Expected: FAIL — `pickBackgroundPlan` is not exported.

- [ ] **Step 3: Add the pure planner**

READ `src/services/stockFootage.ts` first. Add above `sourceReelBackgrounds`:

```ts
/** Decide, per slide, whether to use a video clip or a still.
 *  Video is preferred — stills are the fallback that made reels look like
 *  slideshows. Returns [] when neither is available so the composition uses
 *  its existing gradient backgrounds. */
export function pickBackgroundPlan(
  slideCount: number,
  videosAvailable: number,
  imagesAvailable: number,
): Array<'video' | 'image'> {
  const plan: Array<'video' | 'image'> = [];
  for (let i = 0; i < slideCount; i++) {
    if (i < videosAvailable) plan.push('video');
    else if (imagesAvailable > 0) plan.push('image');
    else break;
  }
  return plan;
}
```

- [ ] **Step 4: Use it in sourceReelBackgrounds**

Replace the body of `sourceReelBackgrounds` (currently images-only) with:

```ts
export async function sourceReelBackgrounds(
  contentId: string,
  keywords: string[],
  slideCount: number,
  aspect: VideoAspect = 'portrait',
): Promise<DownloadedMedia[]> {
  const searchTerm = keywords.slice(0, 3).join(' ');

  // Video first — this is what stops reels being slideshows. searchVideos()
  // already existed and was never called.
  const [videos, images] = await Promise.all([
    searchVideos(searchTerm, aspect, slideCount + 3),
    searchImages(searchTerm, aspect, slideCount + 5),
  ]);

  const plan = pickBackgroundPlan(slideCount, videos.length, images.length);
  if (plan.length === 0) {
    console.log('[stockFootage] No footage found — Reel will use gradient backgrounds');
    return [];
  }

  const results: DownloadedMedia[] = [];
  let videoIdx = 0;
  let imageIdx = 0;

  for (let i = 0; i < plan.length; i++) {
    try {
      if (plan[i] === 'video') {
        const v = videos[videoIdx++];
        const filename = `bg_${i}.mp4`;
        const localPath = await downloadMedia(v.downloadUrl, contentId, filename);
        results.push({
          localPath,
          publicUrl: `/media/${contentId}/footage/${filename}`,
          type: 'video',
          width: v.width, height: v.height, durationSec: v.duration,
        });
      } else {
        const img = images[imageIdx++];
        const ext = img.downloadUrl.match(/\.(\w+)\?/)?.[1] ?? 'jpg';
        const filename = `bg_${i}.${ext}`;
        const localPath = await downloadMedia(img.downloadUrl, contentId, filename);
        results.push({
          localPath,
          publicUrl: `/media/${contentId}/footage/${filename}`,
          type: 'image',
          width: img.width, height: img.height,
        });
      }
    } catch (err: any) {
      // One bad download must not sink the whole reel.
      console.error(`[stockFootage] Failed to download background ${i}: ${err.message}`);
    }
  }

  const videoCount = results.filter(r => r.type === 'video').length;
  console.log(`[stockFootage] Sourced ${results.length}/${slideCount} backgrounds (${videoCount} video, ${results.length - videoCount} image)`);
  return results;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/stockFootagePreference.test.ts` → 6 passed.
Run: `npx tsc -p tsconfig.json --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/stockFootage.ts tests/stockFootagePreference.test.ts
git commit -m "feat(media): prefer real stock video over stills for reel backgrounds"
```

---

### Task 3: Render video backgrounds in Remotion

`ReelComposition` only ever renders `<Img>`. The prop must carry the kind.

**Files:**
- Modify: `src/remotion/ReelComposition.tsx`
- Modify: `src/services/videoRenderer.ts`
- Modify: `src/worker/jobs.ts` (render job — passes footage to the renderer)

- [ ] **Step 1: Add a kind-carrying prop**

READ `src/remotion/ReelComposition.tsx` first. At the props interface
(~line 34) add alongside the existing `backgroundImages`:

```tsx
  /** Preferred over backgroundImages. Carries the kind so video renders as
   *  video; backgroundImages is kept so existing callers keep working. */
  backgroundMedia?: Array<{ url: string; kind: 'image' | 'video' }>;
```

In the component that destructures props (~line 329), derive one list:

```tsx
  // backgroundMedia wins; fall back to treating backgroundImages as stills.
  const media = backgroundMedia ?? backgroundImages.map(url => ({ url, kind: 'image' as const }));
```

Then replace the two use sites:
- `imageUrl={backgroundImages[slideIndex] || undefined}` (~line 371) becomes
  `media={media[slideIndex]}`
- `hasImage={!!backgroundImages[slideIndex]}` (~line 451) becomes
  `hasImage={!!media[slideIndex]}`

- [ ] **Step 2: Render OffthreadVideo for video**

In the slide component that currently renders `<Img>` (~line 262), change the
prop from `imageUrl?: string` to `media?: { url: string; kind: 'image' | 'video' }`
and replace the `<Img>` block with:

```tsx
      {media ? (
        <>
          <AbsoluteFill style={{ overflow: 'hidden' }}>
            {media.kind === 'video' ? (
              // muted: the reel's own TTS track is the audio. Looping covers
              // clips shorter than their slide — a black gap would be worse.
              <OffthreadVideo
                src={media.url}
                muted
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${imgScale})`,
                  transformOrigin: 'center center',
                }}
              />
            ) : (
              <Img
                src={media.url}
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${imgScale})`,
                  transformOrigin: 'center center',
                }}
              />
            )}
```

Add `OffthreadVideo` to the existing `remotion` import at the top of the file
(it already imports `Img`, `AbsoluteFill`, `useVideoConfig`).

Rename the local `imageUrl`-derived variable usage: `const imgScale = media ? …`
(it currently reads `const imgScale = imageUrl ? …` at ~line 255).

- [ ] **Step 3: Pass the kind through the renderer**

READ `src/services/videoRenderer.ts`. Add to its options interface (~line 57),
beside `backgroundImages`:

```ts
  backgroundMedia?: Array<{ url: string; kind: 'image' | 'video' }>;
```

and to BOTH `inputProps` objects (~line 225 and ~line 243 — there are two, one
for `selectComposition` and one for `renderMedia`; missing either makes the
preview and the render disagree):

```ts
        backgroundMedia: options.backgroundMedia,
```

- [ ] **Step 4: Pass footage kinds from the render job**

READ `src/worker/jobs.ts`. At **line 246-249** it currently builds:

```ts
      // Resolve background images from footage_urls
      const footageUrls: string[] = (reel.footage_urls ?? [])
        .map((f: any) => f.localPath)
        .filter(Boolean);
```

This drops `f.type`, which is why the kind never reached the composition.
Replace it with:

```ts
      // Resolve background media from footage_urls, keeping the kind so video
      // renders as video instead of being treated as a still.
      // NOTE: localPath (absolute), not publicUrl — Remotion renders
      // server-side from the filesystem, not over HTTP.
      const backgroundMedia = (reel.footage_urls ?? [])
        .filter((f: any) => f.localPath)
        .map((f: any) => ({
          url: f.localPath,
          kind: f.type === 'video' ? 'video' as const : 'image' as const,
        }));
```

Then at **line 276** replace `backgroundImages: footageUrls,` with
`backgroundMedia,`.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(media): render stock video backgrounds via OffthreadVideo"
```

---

### Task 4: Verify a real reel renders with video

**Files:** none (verification only)

- [ ] **Step 1: Confirm a Pexels key is available**

```bash
grep -c PEXELS_API_KEY .env 2>/dev/null || echo "not in .env"
node -e "console.log('key set:', !!process.env.PEXELS_API_KEY)"
```
If absent, STOP and tell the user this task needs a free Pexels key
(https://www.pexels.com/api/), and that Tasks 1–3 are still complete and
committed. Do not fake it.

- [ ] **Step 2: Source real footage**

```bash
node -e "
import('./dist/src/services/stockFootage.js').then(async m => {
  const out = await m.sourceReelBackgrounds('verify-'+Date.now(), ['ocean','sunset'], 3, 'portrait');
  console.log(out.map(o => o.type + ' ' + o.width + 'x' + o.height + ' ' + o.publicUrl).join('\n'));
  console.log('videos:', out.filter(o=>o.type==='video').length, '/', out.length);
});
"
```
Expected: at least one row of `video …`. **Report the actual output** — this is
the sprint's headline claim.

- [ ] **Step 3: Confirm the file is a real video**

```bash
FF=$(ls -d node_modules/@remotion/compositor-*/ffprobe | head -1)
"$FF" -v error -select_streams v:0 -show_entries stream=codec_name,width,height,duration \
  -of default=noprint_wrappers=1 data/media/verify-*/footage/bg_0.mp4
```
Expected: a codec (e.g. `h264`), real dimensions, and a duration.

- [ ] **Step 4: Clean up**

```bash
rm -rf data/media/verify-*
```

- [ ] **Step 5: Full gates**

```bash
npx vitest run                      # 240 (222 + 18 new)
npx tsc -p tsconfig.json --noEmit   # clean
npm run build                       # succeeds
docker compose ps                   # user's stack untouched
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(media): stock video backgrounds verified end-to-end"
```
