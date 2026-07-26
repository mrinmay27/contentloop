/**
 * Caption tone — the voice the LLM writes a page's captions and scripts in.
 *
 * Stored per page in the existing `pages.brand` JSONB (no migration needed)
 * and folded into the generation prompt by content-generator.ts.
 *
 * The wizard offered these four choices long before anything consumed them;
 * this module is what makes the selection actually change generated output.
 */

export type CaptionTone = "educational" | "bold" | "casual" | "professional";

export const DEFAULT_TONE: CaptionTone = "educational";

export const CAPTION_TONES: { id: CaptionTone; label: string; prompt: string }[] = [
  {
    id: "educational",
    label: "Educational",
    // Verbatim the string that used to be hardcoded in buildPrompt, so pages
    // created before tone existed keep generating identically.
    prompt: "clear, useful, specific, not spammy",
  },
  {
    id: "bold",
    label: "Bold & Direct",
    prompt: "punchy and confident; short declarative sentences, a strong opinion, no hedging",
  },
  {
    id: "casual",
    label: "Casual",
    prompt: "conversational and warm, like explaining it to a friend; contractions welcome, no jargon",
  },
  {
    id: "professional",
    label: "Professional",
    prompt: "polished and authoritative; precise wording, no slang, no hype",
  },
];

export function isCaptionTone(value: unknown): value is CaptionTone {
  return typeof value === "string" && CAPTION_TONES.some((t) => t.id === value);
}

/** Prompt fragment for a tone, falling back to the default for unset/unknown. */
export function tonePromptFor(tone: unknown): string {
  const match = CAPTION_TONES.find((t) => t.id === tone);
  return (match ?? CAPTION_TONES.find((t) => t.id === DEFAULT_TONE)!).prompt;
}
