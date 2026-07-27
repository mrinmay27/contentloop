/** Minimal SRT parsing for caption rendering. Pure — no I/O.
 *
 *  Captions are composited by Remotion rather than burned in with ffmpeg,
 *  because neither the bundled build nor a typical system ffmpeg has the
 *  `subtitles` filter (both lack libass) — which is why captions have never
 *  actually appeared on a rendered reel.
 */

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
