/** Real view/like/comment counts for a published Short.
 *
 *  Uses the Data API's videos.list?part=statistics, which the youtube.readonly
 *  scope already granted at connect time — so this needs no new permission and
 *  nobody has to reconnect. The Analytics API would give richer figures
 *  (impressions, watch time) but requires yt-analytics.readonly and fresh
 *  consent; that is a worthwhile upgrade later, not a reason to ship nothing
 *  now.
 *
 *  Costs 1 quota unit per call against 10,000/day, next to the 1,600 an upload
 *  costs.
 */
import { ensureFreshToken } from "../youtubeTokens.js";
import type { CapturePoint, MetricSnapshot, MetricsProvider, PublishedJobContext } from "./types.js";

const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Split out from the fetch so the mapping is testable without a network or a
 *  token — the shape of this response is the whole risk. */
export function parseVideoStatistics(stats: unknown): MetricSnapshot | null {
  if (!stats || typeof stats !== "object") return null;
  const s = stats as Record<string, unknown>;
  const views = count(s.viewCount);
  return {
    views,
    // The Data API reports no impressions or reach, and engagementRate divides
    // by reach. Views is the honest stand-in: likes+comments over views is the
    // ratio YouTube creators actually work in, and using 0 would silently make
    // every Short score zero engagement.
    reach: views,
    likes: count(s.likeCount),
    comments: count(s.commentCount),
    // No equivalent is exposed per video: saves and shares are Analytics-API
    // figures, and follows cannot be attributed to one video here. Left at 0
    // rather than guessed.
    saves: 0,
    shares: 0,
    follows: 0,
  };
}

export class YouTubeStatsProvider implements MetricsProvider {
  readonly source = "youtube" as const;

  async fetchMetrics(job: PublishedJobContext, _point: CapturePoint): Promise<MetricSnapshot | null> {
    if (!job.externalPostId) return null;
    try {
      const token = await ensureFreshToken(job.pageId);
      const res = await fetch(
        `${VIDEOS_URL}?part=statistics&id=${encodeURIComponent(job.externalPostId)}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) {
        console.warn(`[metrics] YouTube stats ${res.status} for job ${job.jobId}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const body: any = await res.json();
      const item = body?.items?.[0];
      // A deleted video returns 200 with no items. Returning null retries until
      // the capture cutoff rather than recording zeros as a real result.
      if (!item) return null;
      return parseVideoStatistics(item.statistics);
    } catch (err: any) {
      console.warn(`[metrics] YouTube stats error for job ${job.jobId}: ${err?.message}`);
      return null;
    }
  }
}
