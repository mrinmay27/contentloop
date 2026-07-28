/** Pure rules for publishing to YouTube Shorts. No I/O.
 *
 *  These are the parts that can be wrong without a network call: title limits,
 *  Shorts eligibility, and when an access token must be refreshed.
 */

/** YouTube rejects titles longer than this. */
export const MAX_TITLE = 100;

/** Longer than this and YouTube treats the upload as a normal video, not a
 *  Short — the same 3-minute ceiling Reels uses. */
export const MAX_SHORT_SECONDS = 180;

/** Refresh this far ahead of expiry so a token cannot die mid-upload. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export function buildTitle(hook: string): string {
  const clean = (hook ?? "").replace(/\s+/g, " ").trim();
  // The API rejects an empty title, which would fail the entire publish.
  if (!clean) return "New Short";
  if (clean.length <= MAX_TITLE) return clean;

  const cut = clean.slice(0, MAX_TITLE);
  const lastSpace = cut.lastIndexOf(" ");
  // Prefer a word boundary, but not one so early it mangles the hook.
  return (lastSpace > MAX_TITLE * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** A sentence the user can act on, or null when the clip is publishable. */
export function describeShortRejection(probe: {
  width: number; height: number; durationSec: number | null;
}): string | null {
  if (probe.height <= probe.width) {
    return "This video is landscape or square — Shorts need vertical (9:16).";
  }
  if (probe.durationSec !== null && probe.durationSec > MAX_SHORT_SECONDS) {
    return `This video is ${Math.round(probe.durationSec)}s — too long for a Short (max 3 min).`;
  }
  return null;
}

/** Unknown expiry refreshes: needlessly refreshing costs one cheap call,
 *  while uploading with a dead token wastes the upload. */
export function needsRefresh(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() <= REFRESH_WINDOW_MS;
}
