import type { RawTrend, SuggestedFormat } from "./types.js";

/** Tier-2: Rule-based format suggestion + LLM sanity check.
 *  Returns a format and whether it was a sanity override of the LLM result.
 */
export function suggestFormatByRules(
  title: string,
  source: string,
  score: number,
  bodyWordCount = 0
): { format: SuggestedFormat; overrideReason?: string } {
  const t = title.toLowerCase();
  const src = source.toLowerCase();

  // ── Breaking news / single-insight patterns → post ──────────────────────
  if (/breaking|just happened|update|announces|announced|launches|launching|recall|warning|alert/i.test(t)) {
    return { format: "post" };
  }

  // ── How-to / educational patterns → carousel ────────────────────────────
  if (/\bhow to\b|ways to|\d+\s+tips|\d+\s+steps|guide to|breakdown|secrets|deep.?dive|step.by.step|beginner|explained|differences between|vs\b/i.test(t)) {
    return { format: "carousel" };
  }

  // ── Source-driven → reel (viral/social high-signal) ─────────────────────
  if ((src.includes("reddit") || src.includes("twitter") || src.includes("x.com")) && score >= 0.7) {
    return { format: "reel" };
  }

  // ── Early/trend signal sources → always reel ─────────────────────────────
  if (src.includes("exploding_topics") || src.includes("youtube_trends") || src.includes("pinterest_trends")) {
    return { format: "reel" };
  }

  // ── Product launches → post (announcement format) ────────────────────────
  if (src.includes("product_hunt")) {
    return { format: "post" };
  }

  // ── Long-form / research sources → carousel ──────────────────────────────
  if (
    src.includes("medium") ||
    src.includes("substack") ||
    src.includes("hackernews") ||
    src.includes("hacker_news") ||
    src.includes("arxiv") ||
    src.includes("pubmed") ||
    src.includes("devto") ||
    src.includes("finance_newsletter") ||
    src.includes("crypto_news") ||
    bodyWordCount > 300
  ) {
    return { format: "carousel" };
  }

  // ── Default ──────────────────────────────────────────────────────────────
  return { format: "post" };
}

/** Sanity-check LLM format against rule decision.
 *  Returns the corrected format + reason if overridden.
 */
export function sanitizeLlmFormat(
  llmFormat: SuggestedFormat,
  title: string,
  source: string,
  score: number,
  bodyWordCount = 0
): { format: SuggestedFormat; confidence: "llm" | "rule"; overrideReason?: string } {
  const { format: ruleFormat, overrideReason } = suggestFormatByRules(title, source, score, bodyWordCount);

  // Only hard-override if LLM says carousel but we detect breaking-news pattern
  // (that's the most dangerous mismatch — breaking news as a carousel loses urgency)
  const isBreakingNewsTitle = /breaking|just happened|announces|alert|warning|recall/i.test(title);
  if (isBreakingNewsTitle && llmFormat === "carousel") {
    return {
      format: "post",
      confidence: "rule",
      overrideReason: `Breaking-news title detected — overriding LLM "${llmFormat}" → "post"`,
    };
  }

  // LLM wins in all other cases
  return { format: llmFormat, confidence: "llm" };
}

/** Tier-3 page-level default fallback. */
export function applyPageDefault(
  pageDefaultFormat: SuggestedFormat | "auto"
): SuggestedFormat {
  if (pageDefaultFormat === "auto" || !pageDefaultFormat) return "post";
  return pageDefaultFormat;
}

/** Derive source label from RawTrend source for rule matching. */
export function trendSourceLabel(trend: Pick<RawTrend, "source">): string {
  return trend.source;
}
