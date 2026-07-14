import type { Niche, RawTrend, Topic, TopicDecision } from "./types.js";
import { seasonalScoreMultiplier } from "./seasonal-context.js";
import { learnedBoost, type LearnedSignals } from "./learning.js";
import { normalizeCosine, SEMANTIC_RESCUE_THRESHOLD } from "./similarity.js";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// ─── Task 2.9: Source quality multipliers ────────────────────────────────────
const SOURCE_QUALITY_MULTIPLIER: Record<string, number> = {
  hacker_news:        1.30,
  hackernews:         1.30,
  arxiv:              1.25,
  pubmed:             1.25,
  substack:           1.25,
  exploding_topics:   1.20,
  medium_pub:         1.20,
  product_hunt:       1.18,
  finance_newsletter: 1.15,
  youtube_trends:     1.15,
  medium:             1.10,
  devto:              1.05,
  pinterest_trends:   1.05,
  crypto_news:        1.00,
  reddit:             1.00,
  rss:                0.95,
  google_news:        0.85,
  twitter:            0.90,
  google_trends:      0.80,
};

/** Returns a quality multiplier for a given source label (default: 1.0). */
export function sourceQualityMultiplier(source: string): number {
  const s = source.toLowerCase().replace(/[^a-z_]/g, "");
  return SOURCE_QUALITY_MULTIPLIER[s] ?? 1.0;
}

/** Apply freshness decay: >5 days → -15%; >10 days → -30%. */
export function freshnessDecay(ageHours: number): number {
  if (ageHours > 10 * 24) return 0.70;
  if (ageHours > 5 * 24) return 0.85;
  return 1.0;
}

/**
 * Applies source quality multiplier + freshness decay to a base engagement hint.
 * Used in ingestion to boost velocity for high-quality sources.
 */
export function applySourceQuality(engagementHint: number, source: string, ageHours = 0): number {
  const quality = sourceQualityMultiplier(source);
  const decay = freshnessDecay(ageHours);
  return Math.min(100, engagementHint * quality * decay);
}

export interface TopicScoreBreakdown {
  recency: number;
  crossSourceMentions: number;
  velocity: number;
  audienceRelevance: number;
  semanticRelevance: number;
  monetizationIntent: number;
  novelty: number;
  learnedBoost: number;
  score: number;
  decision: TopicDecision;
}

export interface SemanticSignals {
  /** Raw cosine: topic embedding vs niche embedding. */
  nicheSimilarity: number;
  /** Raw cosine: topic embedding vs most-similar recent topic in the niche. */
  maxRecentSimilarity: number;
}

export interface HookScoreBreakdown {
  patternStrength: number;
  clarity: number;
  curiosityGap: number;
  specificity: number;
  emotion: number;
  score: number;
}

export function scoreTopic(
  topic: Topic,
  niche: Niche,
  recentTitles: string[],
  learned?: LearnedSignals,
  semantic?: SemanticSignals
): TopicScoreBreakdown {
  const ageHours = Math.max(0, (Date.now() - topic.lastSeenAt.getTime()) / 36e5);
  const recency = clamp01(1 - ageHours / 72);

  // Cross-source: give partial credit for single source (0.35 baseline),
  // then scale up. 2 sources = 0.6, 3 = 0.85, 4+ = 1.0
  const crossSourceMentions = clamp01(0.35 + (topic.sourceCount - 1) * 0.25);

  const velocity = clamp01(topic.velocity);
  const words = `${topic.title} ${topic.keywords.join(" ")}`.toLowerCase();

  // Audience relevance — how well does this topic match the niche?
  const audienceMatches = niche.keywords.filter((keyword) => words.includes(keyword.toLowerCase())).length;
  const audienceRelevance = clamp01(audienceMatches / Math.max(1, Math.min(8, niche.keywords.length * 0.30)));

  const semanticRelevance = semantic ? normalizeCosine(semantic.nicheSimilarity) : 0;
  const blendedRelevance = Math.max(audienceRelevance, semanticRelevance);

  // Hard discard: zero keyword overlap AND low semantic relevance means this
  // topic belongs to another niche.
  if (audienceMatches === 0 && semanticRelevance < SEMANTIC_RESCUE_THRESHOLD) {
    return {
      recency: 0, crossSourceMentions: 0, velocity: 0,
      audienceRelevance: 0, semanticRelevance, monetizationIntent: 0, novelty: 0,
      learnedBoost: 1.0,
      score: 0, decision: "discarded" as TopicDecision,
    };
  }

  // Negative keyword check
  const hasNegativeMatch = niche.negativeKeywords.some((neg) => words.includes(neg.toLowerCase()));

  const monetizationMatches = niche.monetizationKeywords.filter((keyword) =>
    words.includes(keyword.toLowerCase())
  ).length;
  const monetizationIntent = clamp01(monetizationMatches / Math.max(2, niche.monetizationKeywords.length * 0.35));
  const jaccardNovelty = scoreNovelty(topic.title, recentTitles);
  const semanticNovelty = semantic ? 1 - normalizeCosine(semantic.maxRecentSimilarity) : 1;
  const novelty = clamp01(Math.min(jaccardNovelty, semanticNovelty));

  // Task 2.9: Source quality boost — best source multiplier, capped at +10% of total
  const bestSourceMultiplier = topic.sources.reduce(
    (best, src) => Math.max(best, sourceQualityMultiplier(src)),
    1.0
  );
  const sourceBoost = clamp01((bestSourceMultiplier - 1.0) * 0.5);

  const rawScore = clamp01(
    0.10 * recency +
    0.10 * crossSourceMentions +
    0.10 * velocity +
    0.28 * blendedRelevance +
    0.14 * monetizationIntent +
    0.14 * novelty +
    0.08 * (hasNegativeMatch ? 0 : 1) +
    0.06 * sourceBoost
  );

  // Task 2.5.5: Apply seasonal multiplier (+0–10% when topic matches current season)
  const seasonal = seasonalScoreMultiplier(`${topic.title} ${topic.keywords.join(" ")}`);
  const boost = learnedBoost(topic.keywords, learned);
  const score = clamp01(rawScore * seasonal * boost);

  const decision = hasNegativeMatch
    ? "discarded" as TopicDecision
    : topicDecision(score);

  return {
    recency,
    crossSourceMentions,
    velocity,
    audienceRelevance,
    semanticRelevance,
    monetizationIntent,
    novelty,
    learnedBoost: boost,
    score,
    decision
  };
}

export function topicDecision(score: number): TopicDecision {
  if (score >= 0.50) return "selected";
  if (score >= 0.35) return "backup";
  return "discarded";
}

export function scoreHook(hook: string): HookScoreBreakdown {
  const trimmed = hook.trim();
  const lower = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const hasNumber = /\d/.test(trimmed);
  const hasPattern = /mistake|secret|why|how|stop|before|after|framework|checklist|truth|myth/.test(lower);
  const hasCuriosity = /\?|nobody|hidden|surprising|actually|instead|costing|missing/.test(lower);
  const hasEmotion = /fear|save|avoid|waste|win|fail|growth|profit|stress|easy|hard|shock/.test(lower);

  const patternStrength = hasPattern ? 0.9 : 0.55;
  const clarity = wordCount >= 5 && wordCount <= 16 ? 0.9 : wordCount <= 22 ? 0.7 : 0.45;
  const curiosityGap = hasCuriosity ? 0.9 : lower.includes("you") ? 0.7 : 0.5;
  const specificity = hasNumber || /for \w+|in \d+|without|with/.test(lower) ? 0.9 : 0.55;
  const emotion = hasEmotion ? 0.85 : lower.includes("never") || lower.includes("best") ? 0.7 : 0.5;
  const score = 0.25 * patternStrength + 0.2 * clarity + 0.2 * curiosityGap + 0.2 * specificity + 0.15 * emotion;

  return { patternStrength, clarity, curiosityGap, specificity, emotion, score };
}

function scoreNovelty(title: string, recentTitles: string[]): number {
  if (recentTitles.length === 0) return 1;
  const titleTokens = tokenize(title);
  const maxSimilarity = Math.max(
    ...recentTitles.map((recent) => {
      const recentTokens = tokenize(recent);
      const intersection = [...titleTokens].filter((token) => recentTokens.has(token)).length;
      const union = new Set([...titleTokens, ...recentTokens]).size || 1;
      return intersection / union;
    })
  );
  return clamp01(1 - maxSimilarity);
}

function tokenize(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

// Dummy reference to keep RawTrend import used (future ingestion-level source diversity cap)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RawTrendRef = RawTrend;
