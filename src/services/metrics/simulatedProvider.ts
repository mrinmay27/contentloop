import { scoreHook } from "../../domain/scoring.js";
import type { CapturePoint, MetricSnapshot, MetricsProvider, PublishedJobContext } from "./types.js";

/** Deterministic simulated metrics, shaped by content features so the
 *  learning loop is testable end-to-end before real Instagram data exists. */

const GROWTH: Record<CapturePoint, number> = { "1h": 0.15, "24h": 1.0, "7d": 1.6 };
const FORMAT_MULT: Record<string, number> = { reel: 1.6, carousel: 1.2, post: 1.0 };

/** FNV-1a 32-bit string hash. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SimulatedMetricsProvider implements MetricsProvider {
  readonly source = "simulated" as const;

  async fetchMetrics(job: PublishedJobContext, point: CapturePoint): Promise<MetricSnapshot> {
    const rand = mulberry32(hashString(`${job.jobId}:${point}`));
    const hookQuality = scoreHook(job.hook || "generic post").score; // ~0.5–0.9
    const fmt = FORMAT_MULT[job.contentType] ?? 1.0;
    const hour = job.publishedAt.getUTCHours();
    const hourMult = hour >= 17 && hour <= 22 ? 1.25 : hour >= 11 && hour <= 14 ? 1.1 : 0.9;

    const base = 400 + rand() * 1600;
    const reach = Math.max(50, Math.round(base * fmt * hourMult * GROWTH[point] * (0.6 + hookQuality)));
    const views = Math.round(reach * (1.1 + rand() * 0.5));

    // Target ER 2–8% driven mostly by hook quality, with small noise.
    const er = 0.02 + hookQuality * 0.06 + (rand() - 0.5) * 0.01;
    const interactions = Math.max(1, Math.round(reach * er));
    const likes = Math.round(interactions * 0.7);
    const comments = Math.round(interactions * 0.08);
    const saves = Math.round(interactions * 0.15);
    const shares = Math.max(0, interactions - likes - comments - saves);
    const follows = Math.round(interactions * 0.03 * rand());

    return { views, reach, likes, comments, saves, shares, follows };
  }
}
