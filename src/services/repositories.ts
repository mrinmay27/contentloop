import { query } from "../db/pool.js";
import { mapNiche, mapPage, mapTopic } from "../db/mappers.js";
import type { FormatConfidence, GeneratedContent, Niche, Page, QaResult, RawTrend, SuggestedFormat, Topic } from "../domain/types.js";
import { normalizeKeywords } from "../domain/keywords.js";
import { keywordize } from "./ingestion/keywordize.js";

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

/** Sprint U1 Task 5: user-defined niches (the wizard's "Custom niche" path). */
export async function createNiche(opts: {
  name: string; keywords: string[]; monetizationKeywords: string[];
  negativeKeywords: string[]; targetPersona: string;
}): Promise<Niche> {
  const result = await query(
    `INSERT INTO niches (name, keywords, monetization_keywords, negative_keywords, target_persona)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [opts.name.trim(), opts.keywords, opts.monetizationKeywords, opts.negativeKeywords, opts.targetPersona.trim()]
  );
  return mapNiche(result.rows[0]);
}

/**
 * Sprint U1 Task 5: creates a Theme Page for a niche. There was no
 * POST /api/pages route before this sprint — pages were seed-only — so this
 * repository fn + its route are a necessary addition beyond the plan's
 * literal file list (see report deviations). `platform`/`handle` aren't
 * collected by the wizard yet, so sane defaults are applied; `handle` gets a
 * random suffix to avoid colliding with the (niche_id, platform, handle)
 * unique constraint.
 */
export async function createPage(opts: {
  nicheId: string; name: string;
  platform?: "instagram" | "youtube_shorts";
  handle?: string;
  brand?: Record<string, unknown>;
}): Promise<Page> {
  const platform = opts.platform ?? "instagram";
  const slug = opts.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
  const handle = opts.handle?.trim() || `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const result = await query(
    `INSERT INTO pages (niche_id, name, platform, handle, brand)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [opts.nicheId, opts.name.trim(), platform, handle, JSON.stringify(opts.brand ?? {})]
  );
  return mapPage(result.rows[0]);
}

export async function upsertRawTrend(nicheId: string, rawTrend: RawTrend): Promise<Topic> {
  const title = rawTrend.title.trim();
  const keywords = normalizeKeywords(rawTrend.keywords);
  const velocity = Math.min(1, (rawTrend.engagementHint ?? 0.35) / 100);

  const result = await query(
    `
      INSERT INTO topics (niche_id, title, keywords, sources, source_count, first_seen_at, last_seen_at, velocity, source_url)
      VALUES ($1, $2, $3, $4, 1, COALESCE($5, now()), $6, $7, $8)
      ON CONFLICT (niche_id, title)
      DO UPDATE SET
        keywords = (
          SELECT COALESCE(array_agg(kw), '{}')
          FROM (
            SELECT DISTINCT kw
            FROM unnest(topics.keywords || EXCLUDED.keywords) AS kw
            WHERE length(kw) <= 40
            LIMIT 15
          ) merged
        ),
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
    [
      nicheId,
      title.trim(),
      normalizeKeywords([...keywordize(title), ...(keyPoints ? keywordize(keyPoints) : [])]),
      sourceUrl ?? null,
      suggestedFormat ?? null
    ]
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

/** Create draft content items for a topic.
 *
 *  When `format` is provided (the topic's locked format — see the roadmap's
 *  "format locked at copy step" decision), exactly ONE item of that format
 *  is created per page: reel → the highest-hookScore script, carousel → the
 *  carousel, post → hook+caption. Without a format (legacy/fallback), the
 *  original fan-out (2 reels + 1 carousel per page) is preserved. */
export async function createContentItems(
  topicId: string,
  pages: Page[],
  content: GeneratedContent,
  qa: QaResult,
  format?: SuggestedFormat | null
): Promise<void> {
  const status = qa.passed ? "qa_passed" : "qa_failed";

  for (const page of pages) {
    const caption = content.captions[page.platform];

    if (format === "reel") {
      const best = [...content.reelScripts].sort((a, b) => b.hookScore - a.hookScore)[0];
      if (best) {
        await query(
          "INSERT INTO content_items (topic_id, page_id, type, status, payload, qa_result) VALUES ($1, $2, 'reel', $3, $4, $5)",
          [topicId, page.id, status, { reel: best, caption, hashtags: content.hashtags }, qa]
        );
      }
      continue;
    }
    if (format === "carousel") {
      await query(
        "INSERT INTO content_items (topic_id, page_id, type, status, payload, qa_result) VALUES ($1, $2, 'carousel', $3, $4, $5)",
        [topicId, page.id, status, { carousel: content.carousel, brand: page.brand, caption, hashtags: content.hashtags }, qa]
      );
      continue;
    }
    if (format === "post") {
      await query(
        "INSERT INTO content_items (topic_id, page_id, type, status, payload, qa_result) VALUES ($1, $2, 'post', $3, $4, $5)",
        [topicId, page.id, status, { hook: content.reelScripts[0]?.hook ?? "", caption, hashtags: content.hashtags }, qa]
      );
      continue;
    }

    // Legacy fan-out: no locked format — 2 reel variants + 1 carousel.
    const reelPayloads = content.reelScripts.map((script) => ({
      reel: script,
      caption,
      hashtags: content.hashtags
    }));

    for (const payload of reelPayloads) {
      await query(
        "INSERT INTO content_items (topic_id, page_id, type, status, payload, qa_result) VALUES ($1, $2, 'reel', $3, $4, $5)",
        [topicId, page.id, status, payload, qa]
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

export async function listApprovedContentWithoutJob(): Promise<any[]> {
  const result = await query(
    `
      SELECT c.*, p.platform, p.id AS page_id
      FROM content_items c
      JOIN pages p ON p.id = c.page_id
      WHERE c.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM publish_jobs pj WHERE pj.content_item_id = c.id)
      ORDER BY c.updated_at ASC
      LIMIT 50
    `
  );
  return result.rows;
}

export async function listScheduledTimesForPage(pageId: string): Promise<Date[]> {
  const result = await query(
    `SELECT scheduled_at FROM publish_jobs
     WHERE page_id = $1 AND status = 'scheduled' AND scheduled_at IS NOT NULL`,
    [pageId]
  );
  return result.rows.map((row: any) => new Date(row.scheduled_at));
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
          FROM publish_jobs WHERE status = 'scheduled' AND ($2::uuid IS NULL OR page_id = $2)
        UNION ALL
        SELECT 'posted', count(*)::int
          FROM publish_jobs WHERE status = 'published' AND ($2::uuid IS NULL OR page_id = $2)
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
          FROM publish_jobs WHERE status = 'published' AND published_at >= current_date AND ($2::uuid IS NULL OR page_id = $2)
      `,
      [nicheId ?? null, pageId ?? null]
    ),
    query(
      `SELECT scheduled_at FROM publish_jobs
       WHERE status = 'scheduled' AND scheduled_at > now()
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
        pj.id,
        pj.published_at AS posted_at,
        pj.status,
        c.type,
        t.title AS topic_title,
        COALESCE(m24.views, m1.views, 0)::int   AS views,
        COALESCE(m24.reach, m1.reach, 0)::int   AS reach,
        COALESCE(m24.saves, m1.saves, 0)::int   AS saves,
        COALESCE(m7.views, 0)::int              AS views_7d,
        COALESCE(m24.engagement_rate, m1.engagement_rate, 0)::float8 AS engagement_rate,
        COALESCE(m24.source, m1.source)         AS metric_source
      FROM publish_jobs pj
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      LEFT JOIN performance_metrics m1  ON m1.publish_job_id  = pj.id AND m1.capture_point  = '1h'
      LEFT JOIN performance_metrics m24 ON m24.publish_job_id = pj.id AND m24.capture_point = '24h'
      LEFT JOIN performance_metrics m7  ON m7.publish_job_id  = pj.id AND m7.capture_point  = '7d'
      WHERE pj.page_id = $1 AND pj.status = 'published'
      ORDER BY pj.published_at DESC
      LIMIT 30
    `,
    [pageId]
  );

  const typeResult = await query(
    `
      SELECT c.type, count(DISTINCT pj.id)::int AS total,
             COALESCE(avg(pm.engagement_rate), 0)::float8 AS avg_engagement
      FROM publish_jobs pj
      JOIN content_items c ON c.id = pj.content_item_id
      LEFT JOIN performance_metrics pm
        ON pm.publish_job_id = pj.id AND pm.capture_point = '24h'
      WHERE pj.page_id = $1 AND pj.status = 'published'
      GROUP BY c.type
    `,
    [pageId]
  );

  const simulated = postsResult.rows.some((r: any) => r.metric_source === "simulated");
  return { posts: postsResult.rows, byType: typeResult.rows, simulated };
}

// ── Media pipeline repositories ───────────────────────────────────────────────

/** Update the TTS audio fields on a content item after synthesis. */
export async function updateContentAudio(
  contentItemId: string,
  audioUrl: string,
  audioDurationSec: number,
  subtitleUrl: string | null,
  ttsVoice: string,
  wordBoundaries: object[],
): Promise<void> {
  await query(
    `UPDATE content_items
     SET audio_url = $2,
         audio_duration_sec = $3,
         subtitle_url = $4,
         tts_voice = $5,
         word_boundaries = $6,
         updated_at = now()
     WHERE id = $1`,
    [contentItemId, audioUrl, audioDurationSec, subtitleUrl, ttsVoice, JSON.stringify(wordBoundaries)],
  );
}

/** Update the stock footage URLs on a content item. */
export async function updateContentFootage(
  contentItemId: string,
  footageUrls: object[],
): Promise<void> {
  await query(
    `UPDATE content_items SET footage_urls = $2, updated_at = now() WHERE id = $1`,
    [contentItemId, JSON.stringify(footageUrls)],
  );
}

/** Update the rendered video URL and status on a content item. */
export async function updateContentVideo(
  contentItemId: string,
  videoUrl: string | null,
  renderStatus: string,
  bgmUrl?: string | null,
): Promise<void> {
  await query(
    `UPDATE content_items
     SET video_url = $2,
         render_status = $3,
         bgm_url = COALESCE($4, bgm_url),
         updated_at = now()
     WHERE id = $1`,
    [contentItemId, videoUrl, renderStatus, bgmUrl ?? null],
  );
}

/** List reel content items that have been approved but have no audio yet. */
export async function listReelsWithoutAudio(): Promise<any[]> {
  const result = await query(
    `SELECT c.*, t.title AS topic_title, t.keywords, p.handle, p.platform, p.brand,
            n.name AS niche_name
     FROM content_items c
     JOIN topics t ON t.id = c.topic_id
     JOIN pages p ON p.id = c.page_id
     JOIN niches n ON n.id = t.niche_id
     WHERE c.type = 'reel'
       AND c.audio_url IS NULL
       AND c.status IN ('qa_passed', 'approved')
     ORDER BY c.created_at ASC
     LIMIT 20`,
  );
  return result.rows;
}

/** List reel content items that have audio but no rendered video. */
export async function listReelsWithoutVideo(): Promise<any[]> {
  const result = await query(
    `SELECT c.*, t.title AS topic_title, t.keywords, p.handle, p.platform, p.brand,
            n.name AS niche_name
     FROM content_items c
     JOIN topics t ON t.id = c.topic_id
     JOIN pages p ON p.id = c.page_id
     JOIN niches n ON n.id = t.niche_id
     WHERE c.type = 'reel'
       AND c.audio_url IS NOT NULL
       AND (c.video_url IS NULL OR c.render_status = 'pending')
       AND c.status IN ('qa_passed', 'approved')
     ORDER BY c.created_at ASC
     LIMIT 10`,
  );
  return result.rows;
}

/** Get a single content item by ID with full join data. */
export async function getContentItemFull(contentItemId: string): Promise<any | null> {
  const result = await query(
    `SELECT c.*, t.title AS topic_title, t.keywords, p.handle, p.platform, p.brand,
            n.name AS niche_name
     FROM content_items c
     JOIN topics t ON t.id = c.topic_id
     JOIN pages p ON p.id = c.page_id
     JOIN niches n ON n.id = t.niche_id
     WHERE c.id = $1`,
    [contentItemId],
  );
  return result.rows[0] ?? null;
}
