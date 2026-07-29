import { dueCapturePoints, POINT_MS } from "./capture.js";
import { InstagramInsightsProvider } from "./instagramProvider.js";
import { listCaptureCandidates, insertMetricSnapshot, type CaptureCandidate } from "./metricsRepo.js";
import { SimulatedMetricsProvider } from "./simulatedProvider.js";
import { YouTubeStatsProvider } from "./youtubeProvider.js";
import type { MetricsProvider, PublishedJobContext } from "./types.js";

const simulated = new SimulatedMetricsProvider();
const instagram = new InstagramInsightsProvider();
const youtube = new YouTubeStatsProvider();

/**
 * Which provider, if any, may report on this job.
 *
 * Returns null when a post is real but no provider can measure it — currently
 * anything that is not Instagram, YouTube included. Previously such a post
 * fell through to the simulated provider, so a genuine upload was given
 * invented view and engagement numbers, stored with no marking to say they
 * were fiction, shown on Performance as fact, and fed into the learning EMA
 * that decides what to make next. Recording nothing is the honest outcome:
 * the UI can say metrics are unavailable, and the learning loop stays
 * uncontaminated.
 *
 * Dry runs keep the simulated provider — nothing was published, so there is
 * nothing to misrepresent, and demo installs still show a populated view.
 */
export function selectProvider(job: CaptureCandidate): MetricsProvider | null {
  if (job.dryRun) return simulated;
  if (job.platform === "instagram" && job.externalPostId) return instagram;
  if (job.platform === "youtube_shorts" && job.externalPostId) return youtube;
  return null;
}

/** Real insights are cumulative-lifetime values on both Instagram and
 *  YouTube: a stale catch-up capture
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
    if (!provider) continue;   // real post, no way to measure it — record nothing
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
      if (provider.source !== "simulated" && isTooStaleForRealCapture(job.publishedAt, point, now)) continue;
      const snap = await provider.fetchMetrics(ctx, point);
      if (!snap) continue; // unavailable → retried next run until cutoff
      await insertMetricSnapshot(job.jobId, point, provider.source, snap);
      captured += 1;
    }
  }
  return captured;
}
