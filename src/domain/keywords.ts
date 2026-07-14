/** Keyword hygiene for every topic write path. Sentence-length "keywords"
 *  (from manual key-points entry) pollute scoring and learning_signals. */

export const MAX_KEYWORD_CHARS = 40;
export const MAX_KEYWORD_WORDS = 4;
export const MAX_KEYWORDS = 10;

export function normalizeKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const cleaned = entry
      .toLowerCase()
      .trim()
      .replace(/^[^\p{L}\p{N}#@]+|[^\p{L}\p{N}]+$/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;
    if (cleaned.length > MAX_KEYWORD_CHARS) continue;
    if (cleaned.split(" ").length > MAX_KEYWORD_WORDS) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}
