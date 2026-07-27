/** Probe uploaded video with the ffprobe that ships inside
 *  @remotion/compositor-*, so no system ffmpeg is required — it cannot be
 *  assumed on a user's machine and would break the one-click bundle.
 *
 *  The binary needs its sibling dylibs on the library path; without that it
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

/** Locate the platform's compositor package (the name varies by os/arch). */
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
      // Without these the binary cannot find its own shared libraries.
      env: { ...process.env, DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir },
      timeout: 30_000,
    }
  );
  return parseProbeOutput(stdout);
}
