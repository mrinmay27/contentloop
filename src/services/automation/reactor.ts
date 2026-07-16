import { query } from "../../db/pool.js";
import { isOverperforming } from "../../domain/automation.js";
import { nextAvailableSlot } from "../scheduler.js";
import { formatCaption, type PublishPlatform } from "../platformFormatter.js";
import {
  approveContentItem,
  listScheduledTimesForPage,
  scheduleContentBatch,
} from "../repositories.js";
import { claimEvent } from "./eventsRepo.js";

interface FreshWinnerRow {
  publish_job_id: string;
  content_item_id: string;
  topic_id: string;
  niche_id: string;
  page_id: string;
  topic_title: string;
  content_type: string;
  engagement_rate: number;
  payload: any;
}

/** Fresh (last 2h) 1h snapshots joined to their content/topic/niche, with the
 *  niche's 1h engagement average + sample count computed alongside.
 *  Source discipline (spec §2, same as the learning loop): per niche, use real
 *  ('instagram') rows exclusively once any exist, else simulated — never mixed.
 *  Both the average AND the candidate's own snapshot must be in-mode. */
async function listFreshWinnerCandidates(): Promise<Array<FreshWinnerRow & { niche_avg: number; sample_size: number }>> {
  const r = await query<FreshWinnerRow & { niche_avg: number; sample_size: number }>(
    `
    WITH niche_mode AS (
      SELECT t.niche_id,
             CASE WHEN bool_or(pm.source = 'instagram') THEN 'instagram' ELSE 'simulated' END AS mode
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE pm.capture_point = '1h'
      GROUP BY t.niche_id
    ),
    niche_avg AS (
      SELECT t.niche_id,
             avg(pm.engagement_rate)::float8 AS avg_1h,
             count(*)::int AS samples
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      JOIN niche_mode nm ON nm.niche_id = t.niche_id AND pm.source = nm.mode
      WHERE pm.capture_point = '1h'
      GROUP BY t.niche_id
    )
    SELECT pj.id AS publish_job_id, c.id AS content_item_id, t.id AS topic_id,
           t.niche_id, pj.page_id, t.title AS topic_title, c.type AS content_type,
           pm.engagement_rate::float8 AS engagement_rate, c.payload,
           na.avg_1h AS niche_avg, na.samples AS sample_size
    FROM performance_metrics pm
    JOIN publish_jobs pj ON pj.id = pm.publish_job_id
    JOIN content_items c ON c.id = pj.content_item_id
    JOIN topics t ON t.id = c.topic_id
    JOIN niche_avg na ON na.niche_id = t.niche_id
    JOIN niche_mode nm ON nm.niche_id = t.niche_id AND pm.source = nm.mode
    WHERE pm.capture_point = '1h' AND pm.captured_at > now() - interval '2 hours'
    `
  );
  return r.rows;
}

/** Sibling page in the same niche (different page) that can host this content
 *  type: reels go anywhere; posts/carousels can't go to youtube_shorts
 *  (video-only platform). */
async function findSiblingPage(nicheId: string, pageId: string, contentType: string): Promise<{ id: string; platform: string } | null> {
  const r = await query<{ id: string; platform: string }>(
    `SELECT id, platform FROM pages
     WHERE niche_id = $1 AND id <> $2
       AND (platform <> 'youtube_shorts' OR $3 = 'reel')
     LIMIT 1`,
    [nicheId, pageId, contentType]
  );
  return r.rows[0] ?? null;
}

async function contentHasJobOnPage(contentItemId: string, pageId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM publish_jobs WHERE content_item_id = $1 AND page_id = $2 LIMIT 1`,
    [contentItemId, pageId]
  );
  return r.rows.length > 0;
}

/** The topic's other qa_passed content items (any page). */
async function listSiblingDrafts(topicId: string, excludeContentId: string): Promise<Array<{ id: string; page_id: string; platform: string; payload: any; type: string }>> {
  const r = await query<{ id: string; page_id: string; platform: string; payload: any; type: string }>(
    `SELECT c.id, c.page_id, p.platform, c.payload, c.type
     FROM content_items c JOIN pages p ON p.id = c.page_id
     WHERE c.topic_id = $1 AND c.id <> $2 AND c.status = 'qa_passed'`,
    [topicId, excludeContentId]
  );
  return r.rows;
}

async function scheduleOnPage(contentItemId: string, pageId: string, platform: string, payload: any): Promise<Date> {
  const existing = await listScheduledTimesForPage(pageId);
  const slot = nextAvailableSlot(existing);
  const formattedCaption = formatCaption({
    platform: platform as PublishPlatform,
    hook: payload?.hook ?? "",
    caption: payload?.caption ?? "",
    hashtags: payload?.hashtags ?? [],
  });
  await scheduleContentBatch([{ contentItemId, pageId, platform, scheduledAt: slot, formattedCaption }]);
  return slot;
}

/** Evaluate fresh 1h snapshots; fire cross-post + fast-track for winners.
 *  Every action is claim-first (idempotent) and individually error-isolated. */
export async function runReactor(): Promise<number> {
  let fired = 0;
  const candidates = await listFreshWinnerCandidates();
  for (const row of candidates) {
    if (!isOverperforming(row.engagement_rate, row.niche_avg, row.sample_size)) continue;

    // Action 1: cross-post to the niche's sibling page.
    try {
      const sibling = await findSiblingPage(row.niche_id, row.page_id, row.content_type);
      if (sibling && !(await contentHasJobOnPage(row.content_item_id, sibling.id))) {
        const claimed = await claimEvent({
          kind: "cross_post", subjectId: row.publish_job_id,
          nicheId: row.niche_id, pageId: sibling.id,
          title: `↗ Cross-posted "${row.topic_title}"`,
          payload: { engagementRate: row.engagement_rate, nicheAvg: row.niche_avg, toPage: sibling.id },
        });
        if (claimed) {
          await scheduleOnPage(row.content_item_id, sibling.id, sibling.platform, row.payload);
          fired += 1;
        }
      }
    } catch (err: any) {
      console.warn(`[reactor] cross_post failed for job ${row.publish_job_id}: ${err?.message}`);
    }

    // Action 2: fast-track the topic's other qa_passed drafts.
    try {
      const drafts = await listSiblingDrafts(row.topic_id, row.content_item_id);
      for (const draft of drafts) {
        const claimed = await claimEvent({
          kind: "fast_track", subjectId: draft.id,
          nicheId: row.niche_id, pageId: draft.page_id,
          title: `⚡ Fast-tracked ${draft.type} for "${row.topic_title}"`,
          payload: { triggeredBy: row.publish_job_id },
        });
        if (!claimed) continue;
        // Ordering is load-bearing: create the publish_job BEFORE flipping the
        // item to 'approved'. The independent schedule worker picks up items
        // with status='approved' AND no publish_job — approving first would
        // open a race window where it double-schedules this draft.
        await scheduleOnPage(draft.id, draft.page_id, draft.platform, draft.payload);
        await approveContentItem(draft.id);
        fired += 1;
      }
    } catch (err: any) {
      console.warn(`[reactor] fast_track failed for topic ${row.topic_id}: ${err?.message}`);
    }
  }
  return fired;
}
