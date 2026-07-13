import { dueCapturePoints, POINT_MS } from "./capture.js";
import { InstagramInsightsProvider } from "./instagramProvider.js";
import { listCaptureCandidates, insertMetricSnapshot, type CaptureCandidate } from "./metricsRepo.js";
import { SimulatedMetricsProvider } from "./simulatedProvider.js";
import type { MetricsProvider, PublishedJobContext } from "./types.js";

const simulated = new SimulatedMetricsProvider();
const instagram = new InstagramInsightsProvider();

/** Real insights only for live (non-dry-run) Instagram posts with an external id. */
export function selectProvider(job: CaptureCandidate): MetricsProvider {
  if (job.platform === "instagram" && !job.dryRun && job.externalPostId) return instagram;
  return simulated;
}

/** Instagram insights are cumulative-lifetime values: a stale catch-up capture
 *  (e.g. grabbing the "24h" point 6 days late) would record near-7d numbers as
 *  a 24h snapshot and pollute the learning EMA. Real-source captures are only
 *  taken while the job's age is within 2x the point's nominal age; the
 *  simulated provider is synthetic per-point, so staleness doesn't apply. */
export function isTooStaleForRealCapture(publishedAt: Date, point: keyof typeof POINT_MS, now: Date): boolean {
  return now.getTime() - publishedAt.getTime() > POINT_MS[point] * 2;
}

/** One capture pass: insert every due snapshot. Returns count inserted. */
export async function runMetricsCapture(now = new Date()): Promise<number> {
  const candidates = await listCaptureCandidates();
  let captured = 0;
  for (const job of candidates) {
    const due = dueCapturePoints(job.publishedAt, job.captured, now);
    if (due.length === 0) continue;
    const provider = selectProvider(job);
    const ctx: PublishedJobContext = {
      jobId: job.jobId,
      pageId: job.pageId,
      platform: job.platform,
      externalPostId: job.externalPostId,
      publishedAt: job.publishedAt,
      dryRun: job.dryRun,
      contentType: job.contentType,
      hook: job.hook,
    };
    for (const point of due) {
      if (provider.source === "instagram" && isTooStaleForRealCapture(job.publishedAt, point, now)) continue;
      const snap = await provider.fetchMetrics(ctx, point);
      if (!snap) continue; // unavailable → retried next run until cutoff
      await insertMetricSnapshot(job.jobId, point, provider.source, snap);
      captured += 1;
    }
  }
  return captured;
}
