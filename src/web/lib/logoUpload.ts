/**
 * Client-side validation for the brand logo picked in the create-page wizard.
 *
 * The logo travels to POST /api/pages/:id/branding/logo as a base64 data URL
 * inside a JSON body, so it must be checked before upload: base64 inflates a
 * file by roughly 4/3, and the server's JSON body limit is 25mb. Catching it
 * here produces a sentence the user can act on instead of a failed request.
 */

/** Max accepted source-file size. Stays well under the 25mb body limit once
 *  base64 expansion is accounted for, and is far larger than any real logo. */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const ACCEPTED = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp", "image/gif"];

/** Anything with the File fields we care about (keeps this testable without a DOM). */
export type LogoFileLike = { type: string; size: number; name?: string };

/** Returns an error message, or null when the file is acceptable. */
export function validateLogoFile(file: LogoFileLike): string | null {
  if (!ACCEPTED.includes(file.type.toLowerCase())) {
    return "That file isn’t an image. Pick a PNG, JPG, SVG or WebP.";
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_LOGO_BYTES) {
    return `That image is too large (max ${Math.floor(MAX_LOGO_BYTES / (1024 * 1024))} MB). Pick a smaller one.`;
  }
  return null;
}

/** Decoded byte size of a base64 data URL, or 0 if it isn't one. */
export function approxDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}
