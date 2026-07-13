import { query } from "../../db/pool.js";
import type { CapturePoint, MetricSnapshot, MetricsSource } from "./types.js";
import { engagementRate } from "./types.js";
import { CAPTURE_CUTOFF_MS } from "./capture.js";

export interface CaptureCandidate {
  jobId: string;
  pageId: string;
  platform: string;
  externalPostId: string | null;
  publishedAt: Date;
  dryRun: boolean;
  contentType: "post" | "carousel" | "reel";
  hook: string;
  captured: CapturePoint[];
}

/** Published jobs still inside the capture window, with their captured points. */
export async function listCaptureCandidates(): Promise<CaptureCandidate[]> {
  const result = await query(
    `
      SELECT pj.id, pj.page_id, pj.platform, pj.external_post_id, pj.published_at,
             pj.dry_run, c.type, c.payload->>'hook' AS hook,
             COALESCE(array_agg(pm.capture_point) FILTER (WHERE pm.capture_point IS NOT NULL), '{}') AS captured
      FROM publish_jobs pj
      JOIN content_items c ON c.id = pj.content_item_id
      LEFT JOIN performance_metrics pm ON pm.publish_job_id = pj.id
      WHERE pj.status = 'published'
        AND pj.published_at > now() - ($1 || ' milliseconds')::interval
      GROUP BY pj.id, c.type, c.payload
    `,
    [String(CAPTURE_CUTOFF_MS)]
  );
  return result.rows.map((row: any) => ({
    jobId: row.id,
    pageId: row.page_id,
    platform: row.platform,
    externalPostId: row.external_post_id,
    publishedAt: new Date(row.published_at),
    dryRun: row.dry_run,
    contentType: row.type,
    hook: row.hook ?? "",
    captured: row.captured as CapturePoint[],
  }));
}

/** Idempotent snapshot insert (UNIQUE(publish_job_id, capture_point)). */
export async function insertMetricSnapshot(
  publishJobId: string,
  point: CapturePoint,
  source: MetricsSource,
  snap: MetricSnapshot
): Promise<void> {
  await query(
    `
      INSERT INTO performance_metrics
        (publish_job_id, capture_point, source, views, reach, likes, comments, saves, shares, follows, engagement_rate)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (publish_job_id, capture_point) DO NOTHING
    `,
    [publishJobId, point, source, snap.views, snap.reach, snap.likes, snap.comments,
     snap.saves, snap.shares, snap.follows, engagementRate(snap)]
  );
}
