/** Pure learning-loop math: EMA aggregation and the bounded scoring boost.
 *  DB plumbing lives in services; this file allows no service/DB imports —
 *  sibling domain imports only. */

import { MAX_KEYWORD_CHARS } from "./keywords.js";

export const EMA_ALPHA = 0.3;
export const MIN_KEYWORD_SAMPLES = 3;
export const MIN_FORMAT_SAMPLES = 5;
export const BOOST_MIN = 0.90;
export const BOOST_MAX = 1.10;

export function ema(prev: number | null, value: number, alpha = EMA_ALPHA): number {
  return prev === null ? value : alpha * value + (1 - alpha) * prev;
}

export interface SignalUpdate {
  signalType: "keyword" | "format";
  label: string;
  engagementRate: number;
}

/** Signals produced by one 24h metric snapshot. */
export function snapshotSignals(
  keywords: string[],
  contentType: string,
  engagementRate: number
): SignalUpdate[] {
  const unique = [...new Set(keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))]
    .filter((k) => k.length <= MAX_KEYWORD_CHARS);
  return [
    ...unique.map((label) => ({ signalType: "keyword" as const, label, engagementRate })),
    { signalType: "format" as const, label: contentType, engagementRate },
  ];
}

export interface LearnedSignals {
  keywordScores: Map<string, { score: number; sampleSize: number }>;
  /** Mean score across all keyword signals for the niche. */
  nicheAvg: number;
}

/** Bounded multiplier from learned keyword performance.
 *  ratio 1.0 (average) → 1.0; each 10% above/below average moves ±5%,
 *  clamped to [0.90, 1.10]. Signals need >= MIN_KEYWORD_SAMPLES to count. */
export function learnedBoost(keywords: string[], learned?: LearnedSignals): number {
  if (!learned || !Number.isFinite(learned.nicheAvg) || learned.nicheAvg <= 0) return 1.0;
  const unique = [...new Set(keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))];
  const matched = unique
    .map((k) => learned.keywordScores.get(k))
    .filter(
      (s): s is { score: number; sampleSize: number } =>
        !!s && s.sampleSize >= MIN_KEYWORD_SAMPLES && Number.isFinite(s.score)
    );
  if (matched.length === 0) return 1.0;
  const mean = matched.reduce((sum, m) => sum + m.score, 0) / matched.length;
  const ratio = mean / learned.nicheAvg;
  return Math.min(BOOST_MAX, Math.max(BOOST_MIN, 1 + (ratio - 1) * 0.5));
}
