import type { CapturePoint } from "./types.js";

const HOUR = 3_600_000;
export const POINT_MS: Record<CapturePoint, number> = {
  "1h": HOUR,
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
};

/** After this age, uncaptured points are abandoned (silently). */
export const CAPTURE_CUTOFF_MS = POINT_MS["7d"] + 24 * HOUR;

const ORDER: CapturePoint[] = ["1h", "24h", "7d"];

/** Which capture points are due for a job published at `publishedAt`,
 *  given the points already captured. Past-cutoff jobs return []. */
export function dueCapturePoints(
  publishedAt: Date,
  captured: CapturePoint[],
  now: Date = new Date()
): CapturePoint[] {
  const age = now.getTime() - publishedAt.getTime();
  if (age > CAPTURE_CUTOFF_MS) return [];
  return ORDER.filter((p) => age >= POINT_MS[p] && !captured.includes(p));
}
