/** Trim and crop uploaded footage in place, using the ffmpeg bundled with
 *  Remotion so no system install is needed.
 *
 *  Writes to a temp file and renames on success: an interrupted edit must not
 *  leave the creator with a half-written file where their footage was.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { buildEditArgs } from "../domain/videoEdit.js";
import { resolveCompositorDir, probeVideo, type ProbeResult } from "./mediaProbe.js";

const execFileAsync = promisify(execFile);

export async function editVideo(opts: {
  absPath: string;
  start: number;
  end: number | null;
  toVertical: boolean;
}): Promise<ProbeResult | null> {
  const dir = resolveCompositorDir();
  if (!dir) throw new Error("Could not locate the bundled ffmpeg (@remotion/compositor-*).");

  const tmpPath = `${opts.absPath}.editing.mp4`;
  const args = buildEditArgs({
    inputPath: opts.absPath,
    outputPath: tmpPath,
    start: opts.start,
    end: opts.end,
    toVertical: opts.toVertical,
  });

  try {
    await execFileAsync(path.join(dir, "ffmpeg"), args, {
      // The binary cannot find its own dylibs without this.
      env: { ...process.env, DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir },
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (err: any) {
    fs.rmSync(tmpPath, { force: true });
    // ffmpeg's stderr is long and technical; the tail is the useful part.
    const detail = String(err?.stderr ?? err?.message ?? "").trim().split("\n").slice(-1)[0];
    throw new Error(`Could not edit the video${detail ? `: ${detail}` : "."}`);
  }

  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
    fs.rmSync(tmpPath, { force: true });
    throw new Error("The edit produced an empty file — try a different trim range.");
  }

  // Only now replace the original.
  fs.renameSync(tmpPath, opts.absPath);
  return probeVideo(opts.absPath);
}
