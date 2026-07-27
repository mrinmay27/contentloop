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
 * pattern already proven by the image bridge (Gemini/ChatGPT `?q=`). For every
 * other tool the prompt goes to the clipboard and the creator pastes it —
 * which always works, and never promises behaviour we have not verified.
 */
export const VIDEO_TOOLS: VideoTool[] = [
  { id: "gemini", label: "Gemini (Veo)", emoji: "🔵",
    url: "https://gemini.google.com/app", prefill: true,
    note: "Opens Gemini — paste the prompt into its input" },
  { id: "chatgpt", label: "ChatGPT (Sora)", emoji: "🟢",
    url: "https://chatgpt.com/", prefill: true,
    note: "Opens ChatGPT with the prompt filled in" },
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
  return tool.prefill ? `${tool.url}?q=${encodeURIComponent(prompt)}` : tool.url;
}
