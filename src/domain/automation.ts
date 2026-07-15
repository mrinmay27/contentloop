/** Pure predicates for growth automation. Thresholds are code-level config
 *  (spec: per-rule UI is out of scope). Sample-size gating mirrors the
 *  learning loop's discipline — never act on noise. */

export const REACT_ENGAGEMENT_MULTIPLIER = 1.5;
export const REACT_MIN_SAMPLES = 3;
export const RECYCLE_COOLDOWN_DAYS = 30;
export const RECYCLE_MIN_MULTIPLIER = 1.5;
export const TREND_SPIKE_SOURCES = 2;
export const TREND_WINDOW_HOURS = 6;
export const TREND_VELOCITY_FLOOR = 0.8;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** A 1h snapshot beats the niche's 1h average decisively. */
export function isOverperforming(
  engagementRate: number,
  nicheAvg1h: number,
  sampleSize: number
): boolean {
  if (sampleSize < REACT_MIN_SAMPLES) return false;
  if (!Number.isFinite(nicheAvg1h) || nicheAvg1h <= 0) return false;
  if (!Number.isFinite(engagementRate)) return false;
  return engagementRate >= REACT_ENGAGEMENT_MULTIPLIER * nicheAvg1h;
}

/** A published winner past its cooldown, judged on 24h engagement. */
export function isRecyclable(
  publishedAt: Date,
  engagementRate24h: number,
  nicheAvg24h: number,
  sampleSize: number,
  now: Date = new Date()
): boolean {
  if (now.getTime() - publishedAt.getTime() < RECYCLE_COOLDOWN_DAYS * DAY_MS) return false;
  if (sampleSize < REACT_MIN_SAMPLES) return false;
  if (!Number.isFinite(nicheAvg24h) || nicheAvg24h <= 0) return false;
  if (!Number.isFinite(engagementRate24h)) return false;
  return engagementRate24h >= RECYCLE_MIN_MULTIPLIER * nicheAvg24h;
}

/** Source-velocity spike: accumulated 1+TREND_SPIKE_SOURCES sources within the
 *  topic's first TREND_WINDOW_HOURS, or high raw velocity while fresh. */
export function isTrendSpike(
  sourceCount: number,
  firstSeenAt: Date,
  lastSeenAt: Date,
  velocity: number,
  now: Date = new Date()
): boolean {
  // Inverted or future timestamps are data-integrity violations, not spikes —
  // a negative duration would trivially satisfy the window checks below.
  if (lastSeenAt.getTime() < firstSeenAt.getTime()) return false;
  if (firstSeenAt.getTime() > now.getTime()) return false;
  const window = TREND_WINDOW_HOURS * HOUR_MS;
  const accumulatedFast =
    sourceCount >= 1 + TREND_SPIKE_SOURCES &&
    lastSeenAt.getTime() - firstSeenAt.getTime() <= window;
  const hotAndFresh =
    velocity >= TREND_VELOCITY_FLOOR &&
    now.getTime() - firstSeenAt.getTime() <= window;
  return accumulatedFast || hotAndFresh;
}
