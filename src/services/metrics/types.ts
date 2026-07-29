export type CapturePoint = "1h" | "24h" | "7d";
export type MetricsSource = "simulated" | "instagram" | "youtube";

export interface MetricSnapshot {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  follows: number;
}

/** Everything a provider needs to know about a published job. */
export interface PublishedJobContext {
  jobId: string;
  pageId: string;
  platform: string;
  externalPostId: string | null;
  publishedAt: Date;
  dryRun: boolean;
  contentType: "post" | "carousel" | "reel";
  hook: string;
}

export interface MetricsProvider {
  readonly source: MetricsSource;
  /** Returns null when metrics are unavailable (retry next run). */
  fetchMetrics(job: PublishedJobContext, point: CapturePoint): Promise<MetricSnapshot | null>;
}

/** Engagement rate = interactions / reach. Single definition used everywhere. */
export function engagementRate(m: MetricSnapshot): number {
  return m.reach > 0 ? (m.likes + m.comments + m.saves + m.shares) / m.reach : 0;
}
