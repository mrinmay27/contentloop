/** Route 4a — generate video on a subscription you already pay for.
 *
 *  Mirrors ManualGenerateBridge's approach for images: build an enriched
 *  prompt, copy it, open the tool. The difference is the return path — a
 *  browser can put an IMAGE on the clipboard but not a VIDEO, so the clip must
 *  be downloaded and dropped into the uploader. The UI must say so rather than
 *  implying paste works.
 *
 *  Pure — no I/O, no React.
 */

export interface VideoPromptInput {
  topic: string;
  /** Target clip length in seconds. */
  durationSec: number;
  niche?: string;
  /** A specific shot the creator wants, e.g. "hands typing on a laptop". */
  sceneHint?: string;
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function buildVideoPrompt(input: VideoPromptInput): string {
  return [
    `Create a ${input.durationSec}-second vertical 9:16 video for a short-form social post about "${clean(input.topic)}".`,
    clean(input.niche) && `Audience: ${clean(input.niche)}.`,
    clean(input.sceneHint) && `Scene: ${clean(input.sceneHint)}.`,
    "Cinematic, high contrast, with visible camera motion — not a static shot.",
    // ContentLoop burns its own captions in afterwards; generated lettering
    // would collide with them and cannot be edited.
    "No on-screen text, no captions, no watermark, no logos.",
  ].filter(Boolean).join(" ");
}

export interface VideoTool {
  id: string;
  label: string;
  emoji: string;
  url: string;
  /** True only where a prompt query parameter is known to work. */
  prefill: boolean;
  note: string;
}

/**
 * Order is a suggestion; all are optional. `prefill` is claimed ONLY for the
 * `?q=` pattern already proven by the image bridge. Every other tool copies the
 * prompt and opens — which always works, and never promises behaviour we have
 * not verified.
 *
 * The AI Studio link goes straight to the Veo 3.1 video prompt page with the
 * model preselected; whether it accepts a prompt parameter is unverified, so it
 * is copy-and-paste.
 *
 * ChatGPT/Sora was removed on the user's report that the Sora project was
 * discontinued.
 */
export const VIDEO_TOOLS: VideoTool[] = [
  { id: "veo", label: "Google AI Studio (Veo 3.1)", emoji: "🔵",
    url: "https://aistudio.google.com/prompts/new_video?model=veo-3.1-fast-generate-preview",
    prefill: false,
    note: "Opens AI Studio with Veo 3.1 selected — paste the prompt" },
  { id: "gemini", label: "Gemini", emoji: "✨",
    url: "https://gemini.google.com/app", prefill: true,
    note: "Opens Gemini — paste the prompt into its input" },
  { id: "canva", label: "Canva", emoji: "🟣",
    url: "https://www.canva.com/create/videos/", prefill: false,
    note: "Prompt copied — paste it into Canva" },
  { id: "higgsfield", label: "Higgsfield", emoji: "🟠",
    url: "https://higgsfield.ai/", prefill: false,
    note: "Prompt copied — paste it into Higgsfield" },
  { id: "runway", label: "Runway", emoji: "⚫",
    url: "https://runwayml.com/", prefill: false,
    note: "Prompt copied — paste it into Runway" },
  { id: "luma", label: "Luma Dream Machine", emoji: "🔷",
    url: "https://lumalabs.ai/dream-machine", prefill: false,
    note: "Prompt copied — paste it into Luma" },
];

export function toolUrl(tool: VideoTool, prompt: string): string {
  if (!tool.prefill) return tool.url;
  // Some tool URLs already carry a query string (the AI Studio link pins the
  // Veo model), so the separator has to be chosen, not assumed — appending a
  // second "?" would silently drop the existing parameters.
  const sep = tool.url.includes("?") ? "&" : "?";
  return `${tool.url}${sep}q=${encodeURIComponent(prompt)}`;
}
