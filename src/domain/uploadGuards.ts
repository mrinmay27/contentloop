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
