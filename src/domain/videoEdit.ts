/** Trim and crop rules for uploaded footage. Pure — no I/O.
 *
 *  Uses only what the bundled Remotion ffmpeg actually provides: crop, scale,
 *  libx264 and aac, plus -ss/-to seeking. It has no setpts, so filter-based
 *  trimming is off the table — input seeking does the job and is faster.
 */

/** Centre-crop to 9:16 from any source, then normalise to 1080x1920.
 *  min() picks whichever dimension is the limiting one, so this works whether
 *  the source is landscape, square, or already vertical but the wrong ratio. */
export const VERTICAL_FILTER =
  "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920";

/** Shortest clip worth producing. Below this the output is unusable. */
const MIN_CLIP_SECONDS = 1;

export function validateTrim(input: {
  start: number;
  end: number | null;
  durationSec: number | null;
}): string | null {
  const { start, end, durationSec } = input;

  if (start < 0 || (end !== null && end < 0)) {
    return "Trim points cannot be negative.";
  }
  if (durationSec !== null && start >= durationSec) {
    return `The start point is beyond the end of this ${Math.round(durationSec)}s clip.`;
  }
  if (end !== null) {
    if (end < start) return "The end point must come after the start point.";
    if (end - start < MIN_CLIP_SECONDS) {
      return `Keep at least ${MIN_CLIP_SECONDS} second of video.`;
    }
  }
  return null;
}

export function buildEditArgs(input: {
  inputPath: string;
  outputPath: string;
  start: number;
  end: number | null;
  toVertical: boolean;
}): string[] {
  const args: string[] = ["-y"];

  // -ss BEFORE -i seeks by keyframe without decoding everything first. That
  // makes -to relative to the seek point, hence the subtraction below.
  if (input.start > 0) args.push("-ss", String(input.start));
  args.push("-i", input.inputPath);
  if (input.end !== null) args.push("-to", String(input.end - input.start));

  if (input.toVertical) args.push("-vf", VERTICAL_FILTER);

  // Re-encode rather than stream-copy: a keyframe-aligned copy would ignore
  // the exact trim points and cropping needs a re-encode regardless.
  args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p");
  args.push("-c:a", "aac");
  args.push(input.outputPath);
  return args;
}
