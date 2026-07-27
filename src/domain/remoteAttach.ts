/** Rules for pulling a finished asset from an external editor (Canva) back
 *  into ContentLoop.
 *
 *  Export already worked — it produced download links and stopped there, so
 *  the file had to be saved manually and re-uploaded. These helpers decide
 *  what a given export can be used as, so the server can fetch it directly.
 *
 *  Pure — no I/O.
 */

export type RemoteKind = "image" | "video";

/** What a Canva export format can be used as, or null when it cannot be
 *  composited at all (PDF is a legitimate export but not a background). */
export function kindForFormat(format: string | undefined): RemoteKind | null {
  const f = (format ?? "").trim().toLowerCase().replace(/^\./, "");
  if (f === "mp4" || f === "mov" || f === "webm") return "video";
  if (f === "png" || f === "jpg" || f === "jpeg" || f === "webp") return "image";
  return null;
}

/** Where the fetched file lands. Mirrors the naming the upload and stock
 *  paths already use, so the renderer needs no special case. */
export function filenameFor(kind: RemoteKind, slideIndex: number | null): string {
  if (kind === "video") return slideIndex === null ? "source.mp4" : `slide_${slideIndex}.mp4`;
  return `slide_${slideIndex ?? 0}.png`;
}
