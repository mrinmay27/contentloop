/** Pure predicates for growth automation. Thresholds are code-level config
 *  (spec: per-rule UI is out of scope). Sample-size gating mirrors the
 *  learning loop's discipline — never act on noise.
 *
 *  Sprint U1 Task 6: thresholds are now user-tunable via
 *  applyAutomationOverrides() (fed from configStore at boot — see
 *  worker/index.ts and api/server.ts). The individual constants below are
 *  kept exported (Sprint C tests + potential external importers use them) as
 *  DEFAULT values only — they do NOT reflect live overrides. Use
 *  getAutomationThresholds() for the effective values; the predicates below
 *  read the live `T` object internally.
 */

const DEFAULTS = {
  reactEngagementMultiplier: 1.5,
  reactMinSamples: 3,
  recycleCooldownDays: 30,
  recycleMinMultiplier: 1.5,
  trendSpikeSources: 2,
  trendWindowHours: 6,
  trendVelocityFloor: 0.8,
} as const;

export type AutomationThresholds = { -readonly [K in keyof typeof DEFAULTS]: number };

/** Default values, see getAutomationThresholds() for effective (overridable) values. */
export const REACT_ENGAGEMENT_MULTIPLIER = DEFAULTS.reactEngagementMultiplier;
export const REACT_MIN_SAMPLES = DEFAULTS.reactMinSamples;
export const RECYCLE_COOLDOWN_DAYS = DEFAULTS.recycleCooldownDays;
export const RECYCLE_MIN_MULTIPLIER = DEFAULTS.recycleMinMultiplier;
export const TREND_SPIKE_SOURCES = DEFAULTS.trendSpikeSources;
export const TREND_WINDOW_HOURS = DEFAULTS.trendWindowHours;
export const TREND_VELOCITY_FLOOR = DEFAULTS.trendVelocityFloor;

let T: AutomationThresholds = { ...DEFAULTS };

const CLAMPS: Record<keyof AutomationThresholds, [number, number]> = {
  reactEngagementMultiplier: [1, 10],
  reactMinSamples: [1, 100],
  recycleCooldownDays: [1, 365],
  recycleMinMultiplier: [1, 10],
  trendSpikeSources: [1, 20],
  trendWindowHours: [1, 72],
  trendVelocityFloor: [0, 1],
};

/** Apply partial overrides (clamped per CLAMPS); null resets all to defaults. */
export function applyAutomationOverrides(partial: Partial<AutomationThresholds> | null): void {
  if (partial === null) { T = { ...DEFAULTS }; return; }
  for (const [key, value] of Object.entries(partial) as Array<[keyof AutomationThresholds, number]>) {
    if (!(key in DEFAULTS) || !Number.isFinite(value)) continue;
    const [lo, hi] = CLAMPS[key];
    T[key] = Math.min(hi, Math.max(lo, value));
  }
}

/** Effective (possibly overridden) thresholds — a copy, safe to read freely. */
export function getAutomationThresholds(): AutomationThresholds { return { ...T }; }

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** A 1h snapshot beats the niche's 1h average decisively. */
export function isOverperforming(
  engagementRate: number,
  nicheAvg1h: number,
  sampleSize: number
): boolean {
  if (sampleSize < T.reactMinSamples) return false;
  if (!Number.isFinite(nicheAvg1h) || nicheAvg1h <= 0) return false;
  if (!Number.isFinite(engagementRate)) return false;
  return engagementRate >= T.reactEngagementMultiplier * nicheAvg1h;
}

/** A published winner past its cooldown, judged on 24h engagement. */
export function isRecyclable(
  publishedAt: Date,
  engagementRate24h: number,
  nicheAvg24h: number,
  sampleSize: number,
  now: Date = new Date()
): boolean {
  if (now.getTime() - publishedAt.getTime() < T.recycleCooldownDays * DAY_MS) return false;
  if (sampleSize < T.reactMinSamples) return false;
  if (!Number.isFinite(nicheAvg24h) || nicheAvg24h <= 0) return false;
  if (!Number.isFinite(engagementRate24h)) return false;
  return engagementRate24h >= T.recycleMinMultiplier * nicheAvg24h;
}

/** Source-velocity spike: accumulated 1+trendSpikeSources sources within the
 *  topic's first trendWindowHours, or high raw velocity while fresh. */
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
  const window = T.trendWindowHours * HOUR_MS;
  const accumulatedFast =
    sourceCount >= 1 + T.trendSpikeSources &&
    lastSeenAt.getTime() - firstSeenAt.getTime() <= window;
  const hotAndFresh =
    velocity >= T.trendVelocityFloor &&
    now.getTime() - firstSeenAt.getTime() <= window;
  return accumulatedFast || hotAndFresh;
}
