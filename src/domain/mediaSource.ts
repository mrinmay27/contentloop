/** The contract every media route produces, and the availability rule that
 *  keeps a missing key from looking like a broken feature.
 *
 *  Every way a creator can make content — generated stills, stock video, their
 *  own upload, AI-generated video, an external editor — converges on
 *  MediaAsset and one downstream path (captions/branding → approval →
 *  publish). Defining the contract once is what stops routes drifting apart
 *  and half-wiring, which is exactly how v0.1.0 ended up shipping controls
 *  that looked functional and weren't.
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
