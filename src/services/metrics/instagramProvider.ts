import { getToken } from "../instagram.js";
import type { CapturePoint, MetricSnapshot, MetricsProvider, PublishedJobContext } from "./types.js";

const GRAPH = "https://graph.instagram.com/v21.0";
// Primary uses `views` (current consumption metric); fallback covers older
// API versions that only know `impressions`.
const PRIMARY_METRICS = ["views", "reach", "likes", "comments", "saved", "shares", "follows"];
const FALLBACK_METRICS = ["impressions", "reach", "likes", "comments", "saved", "shares"];

interface InsightEntry { name: string; values: Array<{ value: number }> }

export function parseInsightsResponse(data: InsightEntry[]): MetricSnapshot {
  const get = (name: string) => data.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
  return {
    views: get("views") || get("impressions"),
    reach: get("reach"),
    likes: get("likes"),
    comments: get("comments"),
    saves: get("saved"),
    shares: get("shares"),
    follows: get("follows"),
  };
}

export class InstagramInsightsProvider implements MetricsProvider {
  readonly source = "instagram" as const;

  async fetchMetrics(job: PublishedJobContext, _point: CapturePoint): Promise<MetricSnapshot | null> {
    if (!job.externalPostId) return null;
    const token = await getToken(job.pageId);
    if (!token?.access_token) return null;

    const fetchWith = (metrics: string[]) =>
      fetch(`${GRAPH}/${job.externalPostId}/insights?metric=${metrics.join(",")}&access_token=${token.access_token}`);

    try {
      let res = await fetchWith(PRIMARY_METRICS);
      if (!res.ok) {
        const body = await res.text();
        // Unknown-metric error (code 100) → retry with legacy metric names.
        if (/#100|does not support|invalid metric|must be one of/i.test(body)) {
          res = await fetchWith(FALLBACK_METRICS);
        } else {
          console.warn(`[metrics] IG insights ${res.status} for job ${job.jobId}: ${body.slice(0, 200)}`);
          return null;
        }
      }
      if (!res.ok) {
        console.warn(`[metrics] IG insights fallback failed for job ${job.jobId}: ${await res.text().then((t) => t.slice(0, 200))}`);
        return null;
      }
      const json = (await res.json()) as { data?: InsightEntry[] };
      if (!json.data) return null;
      return parseInsightsResponse(json.data);
    } catch (err: any) {
      console.warn(`[metrics] IG insights fetch error for job ${job.jobId}: ${err?.message}`);
      return null;
    }
  }
}
