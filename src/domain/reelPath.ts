/** Which route a reel is being made by.
 *
 *  This is not only a UI concern. The render job previously could not tell the
 *  paths apart: `listReelsWithoutVideo` selects on
 *  `video_url IS NULL OR render_status = 'pending'`, and uploading a video sets
 *  BOTH — so a reel built from uploaded footage was eligible to be re-rendered
 *  as a slideshow, overwriting the creator's own video. It only failed to fire
 *  because uploads have no audio_url, which is accidental protection rather
 *  than design.
 *
 *  Storing the chosen path makes the routing explicit and lets the editor show
 *  one route at a time instead of every route at once.
 *
 *  Pure — no I/O.
 */

export type ReelPath = "upload" | "ai" | "slideshow";

export interface ReelPathDef {
  id: ReelPath;
  label: string;
  blurb: string;
  emoji: string;
}

export const REEL_PATHS: ReelPathDef[] = [
  { id: "upload", emoji: "🎥", label: "Use my own video",
    blurb: "Upload footage you filmed. ContentLoop adds captions." },
  { id: "ai", emoji: "✨", label: "Generate with AI",
    blurb: "Make a clip in Veo, Canva or Runway on your own subscription, then bring it back." },
  { id: "slideshow", emoji: "🎞️", label: "Build from a script",
    blurb: "Write a script and ContentLoop assembles it over stock video or images, with a voiceover." },
];

const VALID = new Set<string>(REEL_PATHS.map((p) => p.id));

/** Stored choice wins; otherwise infer from what already exists so content
 *  created before this field existed is not mis-rendered. */
export function resolveReelPath(payload: {
  reelPath?: string;
  videoUrl?: string | null;
} | undefined): ReelPath {
  const stored = payload?.reelPath;
  if (stored && VALID.has(stored)) return stored as ReelPath;
  if (payload?.videoUrl) return "upload";
  return "slideshow";
}

/** Which renderer a path needs. 'ai' clips arrive through the same upload
 *  endpoint as filmed footage, so they render identically. */
export function rendererFor(path: ReelPath): "captioned" | "slides" {
  return path === "slideshow" ? "slides" : "captioned";
}
