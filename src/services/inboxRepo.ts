import { query } from "../db/pool.js";
import { mapTopic } from "../db/mappers.js";
import { formatCaption, type PublishPlatform } from "./platformFormatter.js";
import type { Topic } from "../domain/types.js";

export interface InboxDraft {
  kind: "draft";
  contentItemId: string;
  type: "post" | "carousel" | "reel";
  pageId: string;
  pageName: string;
  platform: string;
  topic: Topic;
  hook: string;
  formattedCaption: string;
  imageUrl: string | null;
  createdAt: string;
}

export interface InboxFailedPublish {
  kind: "failed_publish";
  publishJobId: string;
  contentItemId: string;
  pageId: string;
  pageName: string;
  platform: string;
  topicTitle: string;
  error: string | null;
  scheduledAt: string | null;
}

export interface InboxActivityItem {
  id: string;
  kind: "cross_post" | "fast_track" | "recycle" | "trend_alert" | "posted";
  title: string;
  createdAt: string;
  pageName: string | null;
  outcome?: { engagementRate: number; nicheAvg: number };
}

export interface InboxPayload {
  needsYou: Array<InboxDraft | InboxFailedPublish>;
  activity: InboxActivityItem[];
  digest: {
    postedSinceYesterday: number;
    automationSinceYesterday: number;
    topicsScoredSinceYesterday: number;
  };
  nextScheduled: Array<{
    publishJobId: string;
    topicTitle: string;
    pageName: string;
    platform: string;
    scheduledAt: string;
  }>;
}

function firstImageUrl(payload: any): string | null {
  const images = payload?.images ?? [];
  const first = images[0];
  const url = first?.url ?? first;
  return typeof url === "string" && url.length > 0 ? url : null;
}

// NOTE on the SELECT below: `t.*` is included so mapTopic(row) has every
// topic column available. node-postgres builds each result row as a plain
// object by assigning columns in SELECT-list order, so if two columns share
// a name, the LAST one in the list wins on the row object (this is standard
// pg driver behavior — the query itself has no ambiguity, only the JS row
// projection does). `c.id`/`p.id` are aliased to content_item_id/page_id so
// they never collide with `t.id` (topic's id correctly wins — verified live
// against a real qa_passed row, see task report). However `c.created_at` is
// NOT aliased, and `t.*` also carries a `created_at` column (topic's
// first-created timestamp) — that DOES collide, and since `t.*` is expanded
// last, row.created_at resolves to the TOPIC's created_at, not the content
// item's. mapTopic() never reads row.created_at so it is unaffected, but the
// InboxDraft.createdAt field (meant to reflect draft/content-item recency)
// would silently pick up the wrong timestamp. Fixed by aliasing
// `c.created_at AS content_created_at` and reading that explicit column for
// the draft's createdAt instead of the folded `row.created_at`.
async function listDrafts(): Promise<InboxDraft[]> {
  const r = await query(
    `SELECT c.id AS content_item_id, c.type, c.payload, c.created_at AS content_created_at,
            p.id AS page_id, p.name AS page_name, p.platform,
            t.*
     FROM content_items c
     JOIN pages p ON p.id = c.page_id
     JOIN topics t ON t.id = c.topic_id
     -- 'draft' as well as 'qa_passed': qa_passed is set by the generate job,
     -- which never runs for a manual page, so a hand-added topic would never
     -- reach the one screen meant to show what needs you. A draft someone
     -- opened and has not approved genuinely needs them in both modes.
     WHERE c.status IN ('qa_passed', 'draft')
       -- The editor keeps a separate content_item per format, so opening a
       -- topic as a Post leaves a post draft behind next to the reel you
       -- actually approved. Without this the Inbox went on asking you to
       -- approve a topic you had already approved and published, offering an
       -- Approve button for a second copy of the same idea.
       AND NOT EXISTS (
         SELECT 1 FROM content_items sibling
         WHERE sibling.topic_id = c.topic_id
           AND sibling.status = 'approved'
       )
     ORDER BY c.created_at ASC
     LIMIT 25`
  );
  return r.rows.map((row: any) => {
    const payload = row.payload ?? {};
    return {
      kind: "draft" as const,
      contentItemId: row.content_item_id,
      type: row.type,
      pageId: row.page_id,
      pageName: row.page_name,
      platform: row.platform,
      topic: mapTopic(row),
      hook: payload.hook ?? "",
      formattedCaption: formatCaption({
        platform: row.platform as PublishPlatform,
        hook: payload.hook ?? "",
        caption: payload.caption ?? "",
        hashtags: payload.hashtags ?? [],
      }),
      imageUrl: firstImageUrl(payload),
      createdAt: new Date(row.content_created_at).toISOString(),
    };
  });
}

async function listFailedPublishes(): Promise<InboxFailedPublish[]> {
  const r = await query(
    `SELECT pj.id, pj.content_item_id, pj.page_id, pj.platform, pj.error,
            pj.scheduled_at, p.name AS page_name, t.title AS topic_title
     FROM publish_jobs pj
     JOIN pages p ON p.id = pj.page_id
     JOIN content_items c ON c.id = pj.content_item_id
     JOIN topics t ON t.id = c.topic_id
     WHERE pj.status = 'failed'
     ORDER BY pj.updated_at DESC
     LIMIT 10`
  );
  return r.rows.map((row: any) => ({
    kind: "failed_publish" as const,
    publishJobId: row.id,
    contentItemId: row.content_item_id,
    pageId: row.page_id,
    pageName: row.page_name,
    platform: row.platform,
    topicTitle: row.topic_title,
    error: row.error,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
  }));
}

/** Activity = automation_events ∪ posted publish_jobs, newest first.
 *  Posted items carry a 24h outcome vs the niche's source-disciplined
 *  average (same definition as the recycler — spec §1). */
async function listActivity(limit = 30): Promise<InboxActivityItem[]> {
  const r = await query(
    `
    WITH niche_mode AS (
      SELECT t.niche_id,
             CASE WHEN bool_or(pm.source = 'instagram') THEN 'instagram' ELSE 'simulated' END AS mode
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE pm.capture_point = '24h'
      GROUP BY t.niche_id
    ),
    niche_avg AS (
      SELECT t.niche_id, avg(pm.engagement_rate)::float8 AS avg_24h
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      JOIN niche_mode nm ON nm.niche_id = t.niche_id AND pm.source = nm.mode
      WHERE pm.capture_point = '24h'
      GROUP BY t.niche_id
    ),
    events AS (
      SELECT ae.id::text AS id, ae.kind, ae.title, ae.created_at,
             p.name AS page_name,
             NULL::float8 AS engagement_rate, NULL::float8 AS niche_avg
      FROM automation_events ae
      LEFT JOIN pages p ON p.id = ae.page_id
    ),
    posted AS (
      SELECT pj.id::text AS id, 'posted' AS kind,
             -- No tick here: the view already renders one from its icon map
             -- for kind='posted', so baking one into the text produced
             -- "✓ ✓ Posted ...".
             'Posted "' || t.title || '"' AS title,
             pj.published_at AS created_at,
             p.name AS page_name,
             pm.engagement_rate::float8 AS engagement_rate,
             na.avg_24h AS niche_avg
      FROM publish_jobs pj
      JOIN pages p ON p.id = pj.page_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      LEFT JOIN niche_mode nm ON nm.niche_id = t.niche_id
      LEFT JOIN performance_metrics pm
        ON pm.publish_job_id = pj.id AND pm.capture_point = '24h' AND pm.source = nm.mode
      LEFT JOIN niche_avg na ON na.niche_id = t.niche_id
      -- A dry run published nothing, so it does not belong in a feed of
      -- things that happened. It also made this list disagree with the digest
      -- directly above it, which already excludes dry runs: '1 posted' over
      -- two Posted entries.
      WHERE pj.status = 'published' AND pj.published_at IS NOT NULL
        AND pj.dry_run IS NOT TRUE
    )
    SELECT * FROM (SELECT * FROM events UNION ALL SELECT * FROM posted) all_items
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    pageName: row.page_name,
    ...(row.engagement_rate != null && row.niche_avg != null
      ? { outcome: { engagementRate: Number(row.engagement_rate), nicheAvg: Number(row.niche_avg) } }
      : {}),
  }));
}

async function getDigest(): Promise<InboxPayload["digest"]> {
  const r = await query(
    `SELECT
       (SELECT count(*)::int FROM publish_jobs
          WHERE published_at > now() - interval '24 hours' AND dry_run IS NOT TRUE) AS posted,
       (SELECT count(*)::int FROM automation_events WHERE created_at > now() - interval '24 hours') AS automation,
       (SELECT count(*)::int FROM topics WHERE decision IS NOT NULL AND created_at > now() - interval '24 hours') AS scored`
  );
  const row = r.rows[0];
  return {
    postedSinceYesterday: row.posted,
    automationSinceYesterday: row.automation,
    topicsScoredSinceYesterday: row.scored,
  };
}

async function listNextScheduled(): Promise<InboxPayload["nextScheduled"]> {
  const r = await query(
    `SELECT pj.id, pj.platform, pj.scheduled_at, p.name AS page_name, t.title AS topic_title
     FROM publish_jobs pj
     JOIN pages p ON p.id = pj.page_id
     JOIN content_items c ON c.id = pj.content_item_id
     JOIN topics t ON t.id = c.topic_id
     WHERE pj.status = 'scheduled' AND pj.scheduled_at > now()
     ORDER BY pj.scheduled_at ASC
     LIMIT 3`
  );
  return r.rows.map((row: any) => ({
    publishJobId: row.id,
    topicTitle: row.topic_title,
    pageName: row.page_name,
    platform: row.platform,
    scheduledAt: new Date(row.scheduled_at).toISOString(),
  }));
}

export async function getInboxPayload(): Promise<InboxPayload> {
  const [drafts, failed, activity, digest, nextScheduled] = await Promise.all([
    listDrafts(),
    listFailedPublishes(),
    listActivity(),
    getDigest(),
    listNextScheduled(),
  ]);
  return { needsYou: [...failed, ...drafts], activity, digest, nextScheduled };
}
