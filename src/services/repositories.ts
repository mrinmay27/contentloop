import { query } from "../db/pool.js";
import { mapNiche, mapPage, mapTopic } from "../db/mappers.js";
import type { FormatConfidence, GeneratedContent, Niche, Page, QaResult, RawTrend, SuggestedFormat, Topic } from "../domain/types.js";

export async function listNiches(): Promise<Niche[]> {
  const result = await query("SELECT * FROM niches ORDER BY name");
  return result.rows.map(mapNiche);
}

export async function getNiche(id: string): Promise<Niche | null> {
  const result = await query("SELECT * FROM niches WHERE id = $1", [id]);
  return result.rows[0] ? mapNiche(result.rows[0]) : null;
}

export async function listPages(nicheId?: string): Promise<Page[]> {
  const result = await query("SELECT * FROM pages WHERE ($1::uuid IS NULL OR niche_id = $1) ORDER BY name", [
    nicheId ?? null
  ]);
  return result.rows.map(mapPage);
}

export async function getPage(id: string): Promise<Page | null> {
  const result = await query("SELECT * FROM pages WHERE id = $1", [id]);
  return result.rows[0] ? mapPage(result.rows[0]) : null;
}

export async function upsertRawTrend(nicheId: string, rawTrend: RawTrend): Promise<Topic> {
  const title = rawTrend.title.trim();
  const keywords = [...new Set(rawTrend.keywords.map((keyword) => keyword.toLowerCase().trim()).filter(Boolean))];
  const velocity = Math.min(1, (rawTrend.engagementHint ?? 0.35) / 100);

  const result = await query(
    `
      INSERT INTO topics (niche_id, title, keywords, sources, source_count, first_seen_at, last_seen_at, velocity, source_url)
      VALUES ($1, $2, $3, $4, 1, COALESCE($5, now()), $6, $7, $8)
      ON CONFLICT (niche_id, title)
      DO UPDATE SET
        keywords = (SELECT ARRAY(SELECT DISTINCT unnest(topics.keywords || EXCLUDED.keywords))),
        sources = (SELECT ARRAY(SELECT DISTINCT unnest(topics.sources || EXCLUDED.sources))),
        source_count = cardinality((SELECT ARRAY(SELECT DISTINCT unnest(topics.sources || EXCLUDED.sources)))),
        last_seen_at = GREATEST(topics.last_seen_at, EXCLUDED.last_seen_at),
        velocity = GREATEST(topics.velocity, EXCLUDED.velocity),
        source_url = COALESCE(topics.source_url, EXCLUDED.source_url)
      RETURNING *
    `,
    [nicheId, title, keywords, [rawTrend.source], rawTrend.sourcePublishedAt ?? null, rawTrend.observedAt, velocity, rawTrend.url ?? null]
  );
  return mapTopic(result.rows[0]);
}

export async function listTopics(nicheId?: string, limit = 200): Promise<Topic[]> {
  const result = await query(
    `SELECT * FROM topics
     WHERE ($1::uuid IS NULL OR niche_id = $1)
     ORDER BY created_at DESC LIMIT $2`,
    [nicheId ?? null, limit]
  );
  return result.rows.map(mapTopic);
}

export async function listScorableTopics(): Promise<Topic[]> {
  const result = await query("SELECT * FROM topics WHERE state = 'IDEA' ORDER BY last_seen_at DESC LIMIT 100");
  return result.rows.map(mapTopic);
}

export async function listRecentTopicTitles(nicheId: string, excludeId?: string): Promise<string[]> {
  const result = await query(
    "SELECT title FROM topics WHERE niche_id = $1 AND ($2::uuid IS NULL OR id <> $2) ORDER BY created_at DESC LIMIT 50",
    [nicheId, excludeId ?? null]
  );
  return result.rows.map((row: any) => row.title);
}

export async function updateTopicScore(topicId: string, score: number, decision: string, breakdown: object): Promise<void> {
  await query(
    "UPDATE topics SET score = $2, decision = $3, score_breakdown = $4, state = 'SCORED' WHERE id = $1",
    [topicId, score, decision, breakdown]
  );
}

/** Persist format decision (Task 1.2 / 1.3). Called after generate step. */
export async function updateTopicFormat(
  topicId: string,
  suggestedFormat: SuggestedFormat,
  formatConfidence: FormatConfidence
): Promise<void> {
  await query(
    "UPDATE topics SET suggested_format = $2, format_confidence = $3 WHERE id = $1",
    [topicId, suggestedFormat, formatConfidence]
  );
}

export async function createManualTopic(opts: {
  nicheId:         string;
  title:           string;
  keyPoints:       string;
  sourceUrl?:      string;
  suggestedFormat?: SuggestedFormat;
}): Promise<Topic> {
  const { nicheId, title, keyPoints, sourceUrl, suggestedFormat } = opts;
  const result = await query(
    `INSERT INTO topics
       (niche_id, title, keywords, sources, source_count, first_seen_at, last_seen_at,
        velocity, score, state, decision, source_url, suggested_format, format_confidence)
     VALUES
       ($1, $2, $3, ARRAY['manual'], 1, now(), now(),
        1.0, 1.0, 'CONTENT_READY', 'selected', $4, $5, 'user')
     RETURNING *`,
    [nicheId, title.trim(), keyPoints ? [keyPoints.trim()] : [], sourceUrl ?? null, suggestedFormat ?? null]
  );
  return mapTopic(result.rows[0]);
}

export async function listSelectedTopicsWithoutContent(): Promise<Topic[]> {
  const result = await query(
    `
      SELECT t.*
      FROM topics t
      WHERE t.state = 'SCORED'
        AND t.decision = 'selected'
        AND NOT EXISTS (SELECT 1 FROM content_items c WHERE c.topic_id = t.id)
      ORDER BY t.score DESC, t.last_seen_at DESC
      LIMIT 25
    `
  );
  return result.rows.map(mapTopic);
}

export async function createContentItems(topicId: string, pages: Page[], content: GeneratedContent, qa: QaResult): Promise<void> {
  const client = await query("SELECT 1");
  void client;
  for (const page of pages) {
    const reelPayloads = content.reelScripts.map((script) => ({
      reel: script,
      caption: content.captions[page.platform],
      hashtags: content.hashtags
    }));

    for (const payload of reelPayloads) {
      await query(
        "INSERT INTO content_items (topic_id, page_id, type, status, payload, qa_result) VALUES ($1, $2, 'reel', $3, $4, $5)",
        [topicId, page.id, qa.passed ? "qa_passed" : "qa_failed", payload, qa]
      );
    }

    await query(
      "INSERT INTO content_items (topic_id, page_id, type, status, payload, qa_result) VALUES ($1, $2, 'carousel', $3, $4, $5)",
      [
        topicId,
        page.id,
        qa.passed ? "qa_passed" : "qa_failed",
        {
          carousel: content.carousel,
          brand: page.brand,
          caption: content.captions[page.platform],
          hashtags: content.hashtags
        },
        qa
      ]
    );
  }
  await query("UPDATE topics SET state = $2 WHERE id = $1", [topicId, qa.passed ? "QA_PASSED" : "CONTENT_READY"]);
}

export async function listContentItems(status?: string): Promise<any[]> {
  const result = await query(
    `
      SELECT c.*, t.title AS topic_title, p.name AS page_name, p.platform, p.handle
      FROM content_items c
      JOIN topics t ON t.id = c.topic_id
      JOIN pages p ON p.id = c.page_id
      WHERE ($1::text IS NULL OR c.status = $1)
      ORDER BY c.created_at DESC
      LIMIT 100
    `,
    [status ?? null]
  );
  return result.rows;
}

export async function approveContentItem(contentItemId: string): Promise<void> {
  await query("UPDATE content_items SET status = 'approved', updated_at = now() WHERE id = $1", [contentItemId]);
}

export async function rejectContentItem(contentItemId: string): Promise<void> {
  await query("UPDATE content_items SET status = 'rejected', updated_at = now() WHERE id = $1", [contentItemId]);
}

export async function listApprovedContentWithoutPost(): Promise<any[]> {
  const result = await query(
    `
      SELECT c.*, p.platform, p.id AS page_id
      FROM content_items c
      JOIN pages p ON p.id = c.page_id
      WHERE c.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM posts posts WHERE posts.content_item_id = c.id)
      ORDER BY c.updated_at ASC
      LIMIT 50
    `
  );
  return result.rows;
}

export async function listScheduledTimesForPage(pageId: string): Promise<Date[]> {
  const result = await query(
    "SELECT scheduled_at FROM posts WHERE page_id = $1 AND state = 'SCHEDULED' AND scheduled_at IS NOT NULL",
    [pageId]
  );
  return result.rows.map((row: any) => new Date(row.scheduled_at));
}

export async function createPost(contentItemId: string, pageId: string, platform: string, scheduledAt: Date, dryRun: boolean): Promise<string> {
  const result = await query<{ id: string }>(
    `
      INSERT INTO posts (content_item_id, page_id, platform, state, scheduled_at, approval_required, approved_at, dry_run)
      VALUES ($1, $2, $3, 'SCHEDULED', $4, true, now(), $5)
      RETURNING id
    `,
    [contentItemId, pageId, platform, scheduledAt, dryRun]
  );
  return result.rows[0].id;
}

export async function listPosts(state?: string): Promise<any[]> {
  const result = await query(
    `
      SELECT posts.*, c.type, c.payload, p.name AS page_name, p.handle, t.title AS topic_title
      FROM posts
      JOIN content_items c ON c.id = posts.content_item_id
      JOIN pages p ON p.id = posts.page_id
      JOIN topics t ON t.id = c.topic_id
      WHERE ($1::text IS NULL OR posts.state = $1)
      ORDER BY posts.scheduled_at ASC NULLS LAST, posts.created_at DESC
      LIMIT 100
    `,
    [state ?? null]
  );
  return result.rows;
}

export async function markPostPosted(postId: string, externalPostId: string): Promise<void> {
  await query("UPDATE posts SET state = 'POSTED', posted_at = now(), external_post_id = $2 WHERE id = $1", [
    postId,
    externalPostId
  ]);
}

export async function insertMetric(postId: string, metric: { views1h: number; views24h: number; saves: number; followsGained: number }): Promise<void> {
  const engagementRate = metric.views24h > 0 ? (metric.saves + metric.followsGained) / metric.views24h : 0;
  await query(
    `
      INSERT INTO performance_metrics (post_id, views_1h, views_24h, saves, follows_gained, engagement_rate)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [postId, metric.views1h, metric.views24h, metric.saves, metric.followsGained, engagementRate]
  );
  await query("UPDATE posts SET state = 'ANALYZED' WHERE id = $1", [postId]);
}

export async function dashboardStats(nicheId?: string, pageId?: string): Promise<Record<string, number | string | null>> {
  const [counts, nextPost] = await Promise.all([
    query(
      `
        SELECT 'topics' AS key, count(*)::int AS value
          FROM topics WHERE ($1::uuid IS NULL OR niche_id = $1)
        UNION ALL
        SELECT 'selected_topics', count(*)::int
          FROM topics WHERE decision = 'selected' AND ($1::uuid IS NULL OR niche_id = $1)
        UNION ALL
        SELECT 'qa_ready', count(*)::int
          FROM content_items WHERE status = 'qa_passed' AND ($2::uuid IS NULL OR page_id = $2)
        UNION ALL
        SELECT 'approved', count(*)::int
          FROM content_items WHERE status = 'approved' AND ($2::uuid IS NULL OR page_id = $2)
        UNION ALL
        SELECT 'scheduled', count(*)::int
          FROM posts WHERE state = 'SCHEDULED' AND ($2::uuid IS NULL OR page_id = $2)
        UNION ALL
        SELECT 'posted', count(*)::int
          FROM posts WHERE state = 'POSTED' AND ($2::uuid IS NULL OR page_id = $2)
        UNION ALL
        SELECT 'topics_today', count(*)::int
          FROM topics WHERE created_at >= current_date AND ($1::uuid IS NULL OR niche_id = $1)
        UNION ALL
        SELECT 'selected_today', count(*)::int
          FROM topics WHERE decision = 'selected' AND last_seen_at >= current_date AND ($1::uuid IS NULL OR niche_id = $1)
        UNION ALL
        SELECT 'qa_ready_today', count(*)::int
          FROM content_items WHERE status = 'qa_passed' AND created_at >= current_date AND ($2::uuid IS NULL OR page_id = $2)
        UNION ALL
        SELECT 'approved_today', count(*)::int
          FROM content_items WHERE status = 'approved' AND updated_at >= current_date AND ($2::uuid IS NULL OR page_id = $2)
        UNION ALL
        SELECT 'posted_today', count(*)::int
          FROM posts WHERE state = 'POSTED' AND posted_at >= current_date AND ($2::uuid IS NULL OR page_id = $2)
      `,
      [nicheId ?? null, pageId ?? null]
    ),
    query(
      `SELECT scheduled_at FROM posts
       WHERE state = 'SCHEDULED' AND scheduled_at > now()
         AND ($1::uuid IS NULL OR page_id = $1)
       ORDER BY scheduled_at ASC LIMIT 1`,
      [pageId ?? null]
    ),
  ]);

  const stats: Record<string, number | string | null> =
    Object.fromEntries(counts.rows.map((row: any) => [row.key, Number(row.value)]));

  const nextAt: Date | null = nextPost.rows[0]?.scheduled_at ?? null;
  stats.next_post_at = nextAt ? nextAt.toISOString() : null;

  return stats;
}

/**
 * Returns all posts for a given page in a given month.
 * Used by the Scheduler calendar view.
 */
export async function listScheduledPostsForMonth(
  pageId: string,
  year: number,
  month: number   // 1-based
): Promise<any[]> {
  const start = new Date(year, month - 1, 1);
  const end   = new Date(year, month, 1);   // exclusive
  // Use the canonical date for each job: scheduled_at for scheduled/pending,
  // published_at for published, created_at as fallback.
  const result = await query(
    `
      SELECT
        pj.id,
        pj.status,
        pj.platform,
        pj.scheduled_at,
        pj.published_at,
        pj.external_url,
        pj.error,
        c.type,
        t.title AS topic_title,
        COALESCE(pj.scheduled_at, pj.published_at, pj.created_at) AS display_at
      FROM publish_jobs pj
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics        t ON t.id = c.topic_id
      WHERE pj.page_id = $1
        AND COALESCE(pj.scheduled_at, pj.published_at, pj.created_at) >= $2
        AND COALESCE(pj.scheduled_at, pj.published_at, pj.created_at) <  $3
      ORDER BY display_at ASC
    `,
    [pageId, start, end]
  );
  return result.rows;
}

export async function cancelPublishJob(jobId: string): Promise<void> {
  await query(`DELETE FROM publish_jobs WHERE id=$1 AND status='scheduled'`, [jobId]);
}

export async function reschedulePublishJob(jobId: string, scheduledAt: Date): Promise<void> {
  await query(
    `UPDATE publish_jobs SET scheduled_at=$2, status='scheduled', updated_at=now() WHERE id=$1`,
    [jobId, scheduledAt]
  );
}

export async function getTopicPreview(topicId: string, pageId: string): Promise<any | null> {
  const { rows } = await query(
    `SELECT id, status, type, payload
     FROM content_items
     WHERE topic_id = $1 AND page_id = $2
     ORDER BY updated_at DESC LIMIT 1`,
    [topicId, pageId]
  );
  return rows[0] ?? null;
}

export async function scheduleContentBatch(
  jobs: Array<{ contentItemId: string; pageId: string; platform: string; scheduledAt: Date; formattedCaption: string }>
): Promise<void> {
  for (const job of jobs) {
    await query(
      `INSERT INTO publish_jobs (content_item_id, page_id, platform, status, scheduled_at, formatted_caption)
       VALUES ($1, $2, $3, 'scheduled', $4, $5)`,
      [job.contentItemId, job.pageId, job.platform, job.scheduledAt, job.formattedCaption]
    );
  }
}

/**
 * Returns analytics data for a page: per-post performance + content-type breakdown.
 * Used by the Analytics view.
 */
export async function listAnalyticsForPage(pageId: string): Promise<any> {
  const postsResult = await query(
    `
      SELECT
        posts.id,
        posts.posted_at,
        posts.state,
        c.type,
        t.title AS topic_title,
        COALESCE(pm.views_24h, 0)       AS views,
        COALESCE(pm.saves, 0)           AS saves,
        COALESCE(pm.engagement_rate, 0) AS engagement_rate
      FROM posts
      JOIN content_items c ON c.id = posts.content_item_id
      JOIN topics t ON t.id = c.topic_id
      LEFT JOIN performance_metrics pm ON pm.post_id = posts.id
      WHERE posts.page_id = $1
        AND posts.state IN ('POSTED','ANALYZED')
      ORDER BY posts.posted_at DESC
      LIMIT 30
    `,
    [pageId]
  );

  // Content-type breakdown
  const typeResult = await query(
    `
      SELECT c.type, count(*)::int AS total,
             COALESCE(avg(pm.engagement_rate),0)::numeric(5,4) AS avg_engagement
      FROM posts
      JOIN content_items c ON c.id = posts.content_item_id
      LEFT JOIN performance_metrics pm ON pm.post_id = posts.id
      WHERE posts.page_id = $1
      GROUP BY c.type
    `,
    [pageId]
  );

  return { posts: postsResult.rows, byType: typeResult.rows };
}
