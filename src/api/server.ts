import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { nextAvailableSlot } from "../services/scheduler.js";
import {
  approveContentItem,
  dashboardStats,
  listAnalyticsForPage,
  listApprovedContentWithoutJob,
  listContentItems,
  listNiches,
  listPages,
  listScheduledPostsForMonth,
  listScheduledTimesForPage,
  listTopics,
  rejectContentItem,
  updateTopicFormat,
  cancelPublishJob,
  reschedulePublishJob,
  getTopicPreview,
  scheduleContentBatch,
  getContentItemFull,
} from "../services/repositories.js";
import { queues } from "../worker/queues.js";
import * as canva from "../services/canva.js";
import * as instagram from "../services/instagram.js";
import { configStore, CONFIG_META, type ConfigKey } from "../config/configStore.js";
import { generateImage as genImage } from "../config/generationProviders.js";
import { llmConfigStore, LLM_PROVIDERS, resolveBaseUrl } from "../config/llmConfigStore.js";
import { probeProvider, loadCapabilities } from "../config/modelDiscovery.js";
import { saveBrandImage, saveContentImage, UPLOADS_DIR } from "../services/imageStorage.js";
import { listVoices, previewVoice, VOICE_PRESETS } from "../services/tts.js";
import path from 'path';

// In-memory OAuth state store (keyed by state param for CSRF protection)
const oauthStateStore = new Map<string, { pageId: string; provider: string }>();
function storeOAuthState(state: string, pageId: string, provider: string) {
  oauthStateStore.set(state, { pageId, provider });
  setTimeout(() => oauthStateStore.delete(state), 10 * 60 * 1000); // 10-min TTL
}

const app = express();
app.use(helmet());
app.use(cors());
// Bumped to 25mb so we can accept image data URLs — a 1080×1920 PNG is ~3MB base64,
// and a carousel batch can include several of them in one request.
app.use(express.json({ limit: "25mb" }));

// Serve user-generated images: data/uploads/<pageId>/... → /uploads/<pageId>/...
app.use("/uploads", express.static(UPLOADS_DIR, {
  // Cache for an hour — every URL we hand out has ?v=<timestamp> for cache-busting,
  // so this is safe and saves repeated downloads of the same logo on each render.
  maxAge: '1h',
  fallthrough: false,
}));

// Serve generated media: data/media/<contentId>/... → /media/<contentId>/...
const MEDIA_DIR = path.resolve(process.cwd(), 'data/media');
app.use("/media", express.static(MEDIA_DIR, {
  maxAge: '1h',
  fallthrough: true,
}));

const boardServer = new ExpressAdapter();
boardServer.setBasePath("/queues");
createBullBoard({
  queues: Object.values(queues).map((queue) => new BullMQAdapter(queue)),
  serverAdapter: boardServer
});
app.use("/queues", boardServer.getRouter());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: env.NODE_ENV, approvalRequired: env.APPROVAL_REQUIRED, postingDryRun: env.POSTING_DRY_RUN });
});

// Settings: returns integration status + pipeline config derived from env
app.get("/api/settings", (_req, res) => {
  res.json({
    integrations: {
      canva:     { connected: false, label: 'Canva' },
      instagram: { connected: !!configStore.get('INSTAGRAM_ACCESS_TOKEN'), label: 'Instagram / Meta' },
      reddit:    { connected: !!(configStore.get('REDDIT_CLIENT_ID') && configStore.get('REDDIT_CLIENT_SECRET')), label: 'Reddit' },
      twitter:   { connected: !!configStore.get('TWITTER_BEARER_TOKEN'), label: 'Twitter / X' },
    },
    pipeline: {
      approvalRequired:   configStore.getBoolean('APPROVAL_REQUIRED'),
      postingDryRun:      configStore.getBoolean('POSTING_DRY_RUN'),
      maxPostsPerDay:     configStore.getNumber('MAX_POSTS_PER_PAGE_PER_DAY'),
      minPostGapHours:    configStore.getNumber('MIN_POST_GAP_HOURS'),
      defaultTimeSlots:   configStore.get('DEFAULT_TIME_SLOTS'),
      llmProvider:        configStore.get('LLM_PROVIDER'),
      llmModel:           configStore.get('LLM_MODEL'),
      llmKeySet:          !!configStore.get('LLM_API_KEY'),
    },
  });
});

// Config: returns all editable config fields (secrets masked)
app.get("/api/config", (_req, res) => {
  res.json({
    values: configStore.toApiResponse(),
    meta:   CONFIG_META,
  });
});

// Config: update one or more config values
app.patch("/api/config", (req, res, next) => {
  try {
    const updates = z.record(z.string(), z.string()).parse(req.body);
    // Only allow known keys
    const allowed = Object.keys(CONFIG_META) as ConfigKey[];
    const safe: Partial<Record<ConfigKey, string>> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k as ConfigKey)) safe[k as ConfigKey] = v as string;
    }
    configStore.set(safe);

    // Fire background probes for any API key that was saved
    const KEY_TO_PROVIDER: Partial<Record<ConfigKey, string>> = {
      LLM_API_KEY:         'openai',
      GOOGLE_AI_API_KEY:   'google',
      FAL_API_KEY:         'fal',
      STABILITY_API_KEY:   'stability',
      REPLICATE_API_TOKEN: 'replicate',
      RUNWAY_API_KEY:      'runway',
      HEYGEN_API_KEY:      'heygen',
    };
    for (const [k, providerId] of Object.entries(KEY_TO_PROVIDER)) {
      if (safe[k as ConfigKey]) {
        probeProvider(providerId!, safe[k as ConfigKey]!).catch(() => {});
      }
    }

    res.json({ ok: true, saved: Object.keys(safe) });
  } catch (error) {
    next(error);
  }
});

// ── AI Image generation ───────────────────────────────────────────────────────

app.post("/api/generate/image", async (req, res, next) => {
  try {
    const { prompt, provider, model, contentId } = req.body as {
      prompt: string; provider?: string; model?: string; contentId?: string;
    };
    if (!prompt?.trim()) return void res.status(400).json({ error: 'prompt is required' });
    const result = await genImage(prompt.trim(), provider as any, model);
    if (contentId) {
      await query(
        `UPDATE content_items
         SET payload = jsonb_set(coalesce(payload, '{}'), '{generatedImageUrl}', $1::jsonb),
             updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(result.url), contentId]
      );
    }
    res.json({ ok: true, url: result.url, provider: result.provider, model: result.model });
  } catch (err: any) {
    console.error('[generate/image]', err?.message);
    res.status(500).json({ error: err?.message ?? 'Generation failed' });
  }
});

// ── Universal provider capabilities ──────────────────────────────────────────

// GET /api/providers/capabilities — return full capabilities map from cache
app.get("/api/providers/capabilities", (_req, res) => {
  res.json({ capabilities: loadCapabilities() });
});

// Map of configStore keys → provider IDs (for image/video providers)
const IMGPROV_KEY_MAP: Partial<Record<ConfigKey, string>> = {
  LLM_API_KEY:         'openai',
  GOOGLE_AI_API_KEY:   'google',
  FAL_API_KEY:         'fal',
  STABILITY_API_KEY:   'stability',
  REPLICATE_API_TOKEN: 'replicate',
  RUNWAY_API_KEY:      'runway',
  HEYGEN_API_KEY:      'heygen',
};

// POST /api/providers/:providerId/probe — probe a provider by ID
app.post("/api/providers/:providerId/probe", async (req, res, next) => {
  try {
    const { providerId } = req.params;

    let apiKey  = '';
    let baseUrl: string | undefined;

    // Check image/video providers first
    const configKey = Object.entries(IMGPROV_KEY_MAP).find(([, id]) => id === providerId)?.[0] as ConfigKey | undefined;
    if (configKey) {
      apiKey = configStore.get(configKey);
    } else {
      // LLM provider — find in llmConfigStore
      const cfg = llmConfigStore.list().find(c => c.enabled && c.provider === (providerId as any));
      if (cfg) {
        apiKey  = cfg.apiKey;
        baseUrl = cfg.baseUrl;
      }
    }

    if (!apiKey) {
      return void res.status(400).json({ error: 'No API key configured for this provider' });
    }

    const result = await probeProvider(providerId, apiKey, baseUrl);
    res.json({ ok: true, capabilities: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/llm-configs/:id/probe — probe a specific LLM config entry
app.post("/api/llm-configs/:id/probe", async (req, res, next) => {
  try {
    const cfg = llmConfigStore.list().find(c => c.id === req.params.id);
    if (!cfg) return void res.status(404).json({ error: 'LLM config not found' });

    const result = await probeProvider(cfg.provider, cfg.apiKey, cfg.baseUrl);
    res.json({ ok: true, capabilities: result });
  } catch (err) {
    next(err);
  }
});

// ── Multi-LLM config CRUD ─────────────────────────────────────────────────────

app.get("/api/llm-configs", (_req, res) => {
  res.json({ configs: llmConfigStore.toApiList(), providers: LLM_PROVIDERS });
});

app.post("/api/llm-configs", (req, res, next) => {
  try {
    const body = z.object({
      provider: z.string(),
      model:    z.string(),
      apiKey:   z.string(),
      task:     z.enum(['scoring','generation','all','fallback']),
      enabled:  z.boolean().default(true),
      label:    z.string().optional(),
      baseUrl:  z.string().optional(),
    }).parse(req.body);
    const entry = llmConfigStore.add(body as any);
    res.json({ ok: true, config: llmConfigStore.toApiList().find(c => c.id === entry.id) });
  } catch (e) { next(e); }
});

app.patch("/api/llm-configs/:id", (req, res, next) => {
  try {
    const result = llmConfigStore.update(req.params.id, req.body as any);
    if (!result) return void res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete("/api/llm-configs/:id", (req, res) => {
  const removed = llmConfigStore.remove(req.params.id);
  res.json({ ok: removed });
});

app.post("/api/llm-configs/reorder", (req, res, next) => {
  try {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    llmConfigStore.reorder(ids);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/api/stats", async (req, res, next) => {
  try {
    const nicheId = req.query.nicheId?.toString();
    const pageId  = req.query.pageId?.toString();
    res.json(await dashboardStats(nicheId, pageId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/niches", async (_req, res, next) => {
  try {
    res.json(await listNiches());
  } catch (error) {
    next(error);
  }
});

app.get("/api/pages", async (req, res, next) => {
  try {
    res.json(await listPages(req.query.nicheId?.toString()));
  } catch (error) {
    next(error);
  }
});

// Branding: read brand JSONB for a page
app.get("/api/pages/:id/branding", async (req, res, next) => {
  try {
    const result = await query(
      "SELECT brand FROM pages WHERE id = $1",
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Page not found" });
    res.json({ brand: result.rows[0].brand ?? {} });
  } catch (error) {
    next(error);
  }
});

// Branding: update brand JSONB for a page (deep-merge)
app.patch("/api/pages/:id/branding", async (req, res, next) => {
  try {
    const updates = z.record(z.string(), z.unknown()).parse(req.body);
    await query(
      `UPDATE pages
       SET brand = brand || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(updates), req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Branding: upload a brand logo (data URL → file on disk → URL stored in pages.brand.logoUrl).
// Atomic — saves the file and updates the brand JSONB in one round-trip.
app.post("/api/pages/:id/branding/logo", async (req, res, next) => {
  try {
    const { dataUrl } = req.body as { dataUrl?: string };
    if (!dataUrl?.startsWith('data:image/')) {
      return void res.status(400).json({ error: 'dataUrl (image) is required' });
    }
    const stored = saveBrandImage(req.params.id, 'logo', dataUrl);
    await query(
      `UPDATE pages SET brand = brand || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ logoUrl: stored.url }), req.params.id]
    );
    res.json({ ok: true, url: stored.url, bytes: stored.bytes });
  } catch (err) {
    next(err);
  }
});

// Content: find or create a draft content_item for a (topic, page, type) tuple.
// Idempotent — repeated calls return the same row. Used by ContentEditor on open
// to get a stable contentId before any image uploads or saves.
app.post("/api/content/draft", async (req, res, next) => {
  try {
    const { topicId, pageId, type } = req.body as {
      topicId?: string; pageId?: string; type?: 'post' | 'carousel' | 'reel';
    };
    if (!topicId || !pageId || !type) {
      return void res.status(400).json({ error: 'topicId, pageId, type are required' });
    }

    // Find any existing content_item for this (topic, page, type) — draft OR approved.
    // Dropping the status filter means reopening after Approve still loads the same item
    // with all saved images and text, instead of silently creating a blank new draft.
    const existing = await query<{ id: string; payload: any; type: string; status: string }>(
      `SELECT id, payload, type, status FROM content_items
       WHERE topic_id = $1 AND page_id = $2 AND type = $3
       ORDER BY updated_at DESC LIMIT 1`,
      [topicId, pageId, type]
    );
    if (existing.rows[0]) return void res.json({ ok: true, content: existing.rows[0] });

    const created = await query<{ id: string; payload: any; type: string; status: string }>(
      `INSERT INTO content_items (topic_id, page_id, type, status, payload)
       VALUES ($1, $2, $3, 'draft', '{}'::jsonb)
       RETURNING id, payload, type, status`,
      [topicId, pageId, type]
    );
    res.json({ ok: true, content: created.rows[0] });
  } catch (err) {
    next(err);
  }
});

// Content: upload an image for a content_item at a specific slide index.
// payload.images is an array — index N is overwritten in place; gaps fill with null.
app.post("/api/content/:id/images", async (req, res, next) => {
  try {
    const { dataUrl, slideIndex = 0, source = 'paste', prompt } = req.body as {
      dataUrl?: string; slideIndex?: number; source?: string; prompt?: string;
    };
    if (!dataUrl?.startsWith('data:image/')) {
      return void res.status(400).json({ error: 'dataUrl (image) is required' });
    }

    const { rows } = await query<{ page_id: string; payload: any }>(
      `SELECT page_id, payload FROM content_items WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return void res.status(404).json({ error: 'Content item not found' });

    const stored = saveContentImage(rows[0].page_id, req.params.id, slideIndex, dataUrl);

    const payload = rows[0].payload ?? {};
    const images: (object | null)[] = Array.isArray(payload.images) ? [...payload.images] : [];
    while (images.length <= slideIndex) images.push(null);
    images[slideIndex] = { slideIndex, url: stored.url, source, prompt: prompt ?? null };

    await query(
      `UPDATE content_items
       SET payload = $1::jsonb, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify({ ...payload, images }), req.params.id]
    );

    res.json({ ok: true, url: stored.url, slideIndex, bytes: stored.bytes });
  } catch (err) {
    next(err);
  }
});

// Scheduler: posts for a page in a given month (year & month query params, 1-based month)
app.get("/api/pages/:id/schedule", async (req, res, next) => {
  try {
    const year  = parseInt(req.query.year?.toString()  ?? String(new Date().getFullYear()),  10);
    const month = parseInt(req.query.month?.toString() ?? String(new Date().getMonth() + 1), 10);
    res.json(await listScheduledPostsForMonth(req.params.id, year, month));
  } catch (error) {
    next(error);
  }
});

// Analytics: per-post performance + content-type breakdown for a page
app.get("/api/pages/:id/analytics", async (req, res, next) => {
  try {
    res.json(await listAnalyticsForPage(req.params.id));
  } catch (error) {
    next(error);
  }
});

// Learning: keyword/format signals learned for the page's niche
app.get("/api/pages/:id/learning", async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT niche_id FROM pages WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return void res.status(404).json({ error: "Page not found" });
    const nicheId = rows[0].niche_id;
    const signals = await query(
      `SELECT signal_type, label, score::float, sample_size, updated_at
       FROM learning_signals WHERE niche_id = $1
       ORDER BY signal_type, score DESC`,
      [nicheId]
    );
    const real = await query(
      `SELECT 1 FROM performance_metrics pm
       JOIN publish_jobs pj ON pj.id = pm.publish_job_id
       JOIN content_items c ON c.id = pj.content_item_id
       JOIN topics t ON t.id = c.topic_id
       WHERE t.niche_id = $1 AND pm.source = 'instagram' LIMIT 1`,
      [nicheId]
    );
    res.json({
      keywords: signals.rows.filter((r: any) => r.signal_type === "keyword").slice(0, 10),
      formats: signals.rows.filter((r: any) => r.signal_type === "format"),
      mode: real.rows.length > 0 ? "real" : "simulated",
    });
  } catch (err) { next(err); }
});

// Growth automation: activity feed (cross-post/fast-track/recycle/trend_alert)
app.get("/api/alerts", async (req, res, next) => {
  try {
    const { listEvents } = await import("../services/automation/eventsRepo.js");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    res.json(await listEvents(limit));
  } catch (err) { next(err); }
});

app.post("/api/alerts/seen", async (_req, res, next) => {
  try {
    const { markAllSeen } = await import("../services/automation/eventsRepo.js");
    await markAllSeen();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Sprint D-UI: aggregated inbox — needs-you (drafts + failed publishes),
// activity (events ∪ posted jobs with 24h outcome), digest, next scheduled.
app.get("/api/inbox", async (_req, res, next) => {
  try {
    const { getInboxPayload } = await import("../services/inboxRepo.js");
    res.json(await getInboxPayload());
  } catch (err) { next(err); }
});

app.get("/api/topics", async (req, res, next) => {
  try {
    const nicheId = req.query.nicheId?.toString();
    const topics = await listTopics(nicheId);
    // Enrich each topic with its latest content_item status so the UI can
    // show "approved" badge when content has been approved.
    const { rows: ciRows } = await query(
      `SELECT DISTINCT ON (topic_id) topic_id, status
       FROM content_items
       ORDER BY topic_id, updated_at DESC`
    );
    const topicContentStatus = new Map(ciRows.map((r: any) => [r.topic_id, r.status]));
    const enriched = topics.map(t => ({
      ...t,
      status: topicContentStatus.get(t.id) === 'approved' ? 'approved' : undefined,
    }));
    res.json(enriched);
  } catch (error) {
    next(error);
  }
});

// Task 1.5 / 3.3: Override or persist format decision for a topic
app.patch("/api/topics/:id/format", async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = z.object({
      suggested_format:  z.enum(['post', 'carousel', 'reel']),
      format_confidence: z.enum(['user', 'llm', 'rule', 'page_default']).default('user'),
    }).parse(req.body);
    await updateTopicFormat(id, body.suggested_format, body.format_confidence);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});


// GET topic preview — latest content_item payload for a topic+page (no editor needed)
app.get("/api/topics/:topicId/preview", async (req, res, next) => {
  try {
    const pageId = req.query.pageId?.toString();
    if (!pageId) return void res.status(400).json({ error: 'pageId required' });
    const preview = await getTopicPreview(req.params.topicId, pageId);
    res.json({ preview: preview ?? null });
  } catch (err) { next(err); }
});

// POST schedule-batch — create scheduled publish_jobs for multiple content items at once
app.post("/api/content/schedule-batch", async (req, res, next) => {
  try {
    const { jobs } = req.body as {
      jobs: Array<{ contentItemId: string; pageId: string; platform: string; scheduledAt: string }>;
    };
    if (!Array.isArray(jobs) || jobs.length === 0)
      return void res.status(400).json({ error: 'jobs[] is required' });

    const now = new Date();
    const pastJob = jobs.find(j => new Date(j.scheduledAt) <= now);
    if (pastJob)
      return void res.status(400).json({ error: `Scheduled time must be in the future (got ${pastJob.scheduledAt})` });

    const { formatCaption } = await import('../services/platformFormatter.js');
    const batchJobs: Array<{ contentItemId: string; pageId: string; platform: string; scheduledAt: Date; formattedCaption: string }> = [];

    for (const job of jobs) {
      const { rows } = await query(
        `SELECT ci.payload FROM content_items ci WHERE ci.id = $1`,
        [job.contentItemId]
      );
      const payload = rows[0]?.payload ?? {};
      const formattedCaption = formatCaption({
        platform: job.platform as any,
        hook:     payload.hook     ?? '',
        caption:  payload.caption  ?? '',
        hashtags: payload.hashtags ?? [],
      });
      batchJobs.push({ ...job, scheduledAt: new Date(job.scheduledAt), formattedCaption });
    }

    await scheduleContentBatch(batchJobs);
    res.json({ ok: true, count: batchJobs.length });
  } catch (err) { next(err); }
});

app.get("/api/content", async (req, res, next) => {
  try {
    res.json(await listContentItems(req.query.status?.toString()));
  } catch (error) {
    next(error);
  }
});

app.post("/api/content/:id/approve", async (req, res, next) => {
  try {
    await approveContentItem(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/content/:id/reject", async (req, res, next) => {
  try {
    await rejectContentItem(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Persist content editor changes (hook, caption, slides, cta, branding)
app.patch("/api/content/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = z.object({
      hook:       z.string().optional(),
      caption:    z.string().optional(),
      slides:     z.array(z.object({ id: z.number(), text: z.string() })).optional(),
      cta:        z.string().optional(),
      branding:   z.record(z.string(), z.unknown()).optional(),
      reelScript: z.string().optional(),
      reelTarget: z.enum(['instagram', 'youtube_shorts', 'both']).optional(),
    }).parse(req.body);
    const { query } = await import("../db/pool.js");
    await query(
      `UPDATE content_items SET payload = payload || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(body), id]
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/schedule/approved", async (_req, res, next) => {
  try {
    const { formatCaption } = await import("../services/platformFormatter.js");
    const approved = await listApprovedContentWithoutJob();
    const scheduled = [];
    for (const item of approved) {
      const existing = await listScheduledTimesForPage(item.page_id);
      const slot = nextAvailableSlot(existing);
      const payload = item.payload ?? {};
      const formattedCaption = formatCaption({
        platform: item.platform,
        hook: payload.hook ?? '',
        caption: payload.caption ?? '',
        hashtags: payload.hashtags ?? [],
      });
      await scheduleContentBatch([{
        contentItemId: item.id,
        pageId: item.page_id,
        platform: item.platform,
        scheduledAt: slot,
        formattedCaption,
      }]);
      scheduled.push({ contentItemId: item.id, scheduledAt: slot });
    }
    res.json({ scheduled });
  } catch (error) {
    next(error);
  }
});

// ── Task 2.0: Source map management ──────────────────────────────────────────

// GET cached source map for a page (or null if none generated yet)
app.get("/api/pages/:id/sources", async (req, res, next) => {
  try {
    const { getCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const map = getCachedSourceMap(req.params.id);
    res.json({ map: map ?? null });
  } catch (error) { next(error); }
});

// POST: trigger (re)generation of source map via LLM
app.post("/api/pages/:id/sources/refresh", async (req, res, next) => {
  try {
    const page = (await query("SELECT p.id, n.name, n.keywords FROM pages p JOIN niches n ON p.niche_id = n.id WHERE p.id = $1", [req.params.id])).rows[0];
    if (!page) return void res.status(404).json({ error: "Page not found" });
    const { generateSourceMap } = await import("../services/ingestion/tag-generator.js");
    const map = await generateSourceMap(page.id, page.name, page.keywords, true);
    res.json({ ok: true, map });
  } catch (error) { next(error); }
});

// DELETE: clear cached source map (forces regen on next ingest)
app.delete("/api/pages/:id/sources", async (req, res, next) => {
  try {
    const { clearSourceMap } = await import("../services/ingestion/tag-generator.js");
    clearSourceMap(req.params.id);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// PATCH: update per-source enable/disable toggles
app.patch("/api/pages/:id/sources/toggles", async (req, res, next) => {
  try {
    const { getCachedSourceMap, setCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const map = getCachedSourceMap(req.params.id);
    if (!map) return void res.status(404).json({ error: "No source map for this page — generate one first" });
    const toggles = z.record(z.string(), z.boolean()).parse(req.body);
    map.sourceEnabled = { ...(map.sourceEnabled ?? {}), ...toggles };
    setCachedSourceMap(req.params.id, map);
    res.json({ ok: true, sourceEnabled: map.sourceEnabled });
  } catch (error) { next(error); }
});


app.post("/api/jobs/:name", async (req, res, next) => {
  try {
    const params = z.object({ name: z.enum(["ingest", "score", "generate", "media", "render", "schedule", "post", "analyze"]) }).parse(req.params);
    await queues[params.name].add(`manual-${params.name}`, {}, { removeOnComplete: 25, removeOnFail: 25 });
    res.json({ ok: true, queued: params.name });
  } catch (error) {
    next(error);
  }
});

// ── Media Pipeline: TTS + Stock Footage + Video Rendering ─────────────────────

// GET available TTS voices
app.get("/api/tts/voices", async (req, res, next) => {
  try {
    const locale = req.query.locale?.toString();
    const voices = await listVoices(locale);
    res.json({ voices, presets: VOICE_PRESETS });
  } catch (err) { next(err); }
});

// POST preview TTS — returns audio buffer for a short text snippet
app.post("/api/tts/preview", async (req, res, next) => {
  try {
    const { text, voice } = req.body as { text?: string; voice?: string };
    if (!text?.trim()) return void res.status(400).json({ error: 'text is required' });
    if (!voice?.trim()) return void res.status(400).json({ error: 'voice is required' });

    const audioBuffer = await previewVoice(text.trim().slice(0, 500), voice.trim());
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="preview.mp3"',
      'Content-Length': String(audioBuffer.length),
    });
    res.send(audioBuffer);
  } catch (err) { next(err); }
});

// GET media info for a content item (audio, footage, video status)
app.get("/api/content/:id/media", async (req, res, next) => {
  try {
    const item = await getContentItemFull(req.params.id);
    if (!item) return void res.status(404).json({ error: 'Content item not found' });
    res.json({
      audio: item.audio_url ? { url: item.audio_url, durationSec: item.audio_duration_sec, voice: item.tts_voice } : null,
      subtitles: item.subtitle_url ? { url: item.subtitle_url } : null,
      footage: item.footage_urls ?? [],
      video: item.video_url ? { url: item.video_url, status: item.render_status } : null,
      renderStatus: item.render_status ?? 'pending',
    });
  } catch (err) { next(err); }
});

// POST trigger TTS synthesis for a specific content item
app.post("/api/content/:id/synthesize", async (req, res, next) => {
  try {
    const { voice, rate } = req.body as { voice?: string; rate?: string };
    // Enqueue media job with specific content ID
    await queues.media.add(`manual-tts-${req.params.id}`, { contentId: req.params.id, voice, rate }, {
      removeOnComplete: 25, removeOnFail: 25,
    });
    res.json({ ok: true, queued: 'media', contentId: req.params.id });
  } catch (err) { next(err); }
});

// POST trigger video render for a specific content item
app.post("/api/content/:id/render", async (req, res, next) => {
  try {
    await queues.render.add(`manual-render-${req.params.id}`, { contentId: req.params.id }, {
      removeOnComplete: 25, removeOnFail: 25,
    });
    res.json({ ok: true, queued: 'render', contentId: req.params.id });
  } catch (err) { next(err); }
});

// POST batch render — generate N video variants with different transitions
app.post("/api/content/:id/batch-render", async (req, res, next) => {
  try {
    const { transitions, aspects } = req.body as {
      transitions?: string[]; aspects?: string[];
    };
    const variantTransitions = transitions ?? ['fade', 'slide', 'zoom'];
    const variantAspects = aspects ?? ['portrait'];

    // Create variant render jobs
    const jobs: Array<{ transition: string; aspect: string }> = [];
    for (const t of variantTransitions) {
      for (const a of variantAspects) {
        jobs.push({ transition: t, aspect: a });
      }
    }

    const variantGroup = crypto.randomUUID();
    for (let i = 0; i < jobs.length; i++) {
      await queues.render.add(`batch-render-${req.params.id}-v${i}`, {
        contentId: req.params.id,
        variantIndex: i,
        variantGroup,
        transition: jobs[i].transition,
        aspect: jobs[i].aspect,
      }, { removeOnComplete: 25, removeOnFail: 25 });
    }

    res.json({
      ok: true,
      variantGroup,
      variantCount: jobs.length,
      variants: jobs.map((j, i) => ({
        index: i,
        transition: j.transition,
        aspect: j.aspect,
      })),
    });
  } catch (err) { next(err); }
});

// GET list variants for a content item
app.get("/api/content/:id/variants", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, variant_index, variant_group, aspect_ratio, transition_type,
              video_url, render_status, audio_url, created_at
       FROM content_items
       WHERE variant_group = (
         SELECT variant_group FROM content_items WHERE id = $1
       )
       ORDER BY variant_index ASC`,
      [req.params.id],
    );
    res.json({ variants: rows });
  } catch (err) { next(err); }
});

// GET available aspect ratios and transitions
app.get("/api/media/options", (_req, res) => {
  res.json({
    aspects: [
      { value: 'portrait',  label: '9:16 Portrait (Reels/Shorts)', width: 1080, height: 1920 },
      { value: 'landscape', label: '16:9 Landscape (YouTube)',      width: 1920, height: 1080 },
      { value: 'square',    label: '1:1 Square (Feed)',             width: 1080, height: 1080 },
    ],
    transitions: [
      { value: 'fade',  label: 'Fade',      description: 'Smooth opacity crossfade' },
      { value: 'slide', label: 'Slide',     description: 'Horizontal slide left' },
      { value: 'zoom',  label: 'Zoom',      description: 'Scale in/out transition' },
      { value: 'wipe',  label: 'Wipe',      description: 'Directional wipe reveal' },
      { value: 'none',  label: 'Hard Cut',  description: 'Instant cut between slides' },
    ],
  });
});

// ─── Canva OAuth ─────────────────────────────────────────────────────────────

// Step 1: Redirect user to Canva login.
// pageId is passed as a query param so we know which page to attach the token to.
app.get("/auth/canva", (req, res, next) => {
  try {
    const pageId = z.string().uuid().parse(req.query.pageId);
    const { verifier, challenge } = canva.generatePkce();
    const state = crypto.randomUUID();
    // Use the unified oauthStateStore for Canva too
    oauthStateStore.set(state, { pageId, provider: 'canva' });
    // Also keep verifier for Canva's PKCE
    oauthStateStore.set(`verifier:${state}`, { pageId, provider: verifier });
    setTimeout(() => { oauthStateStore.delete(state); oauthStateStore.delete(`verifier:${state}`); }, 10 * 60 * 1000);
    res.redirect(canva.buildAuthUrl(state, challenge));
  } catch (error) {
    next(error);
  }
});

// Step 2: Canva redirects back here with code + state.
app.get("/auth/canva/callback", async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    const entry   = oauthStateStore.get(state);
    const verEntry= oauthStateStore.get(`verifier:${state}`);
    if (!entry) return res.status(400).json({ error: "Invalid or expired OAuth state" });
    oauthStateStore.delete(state);
    oauthStateStore.delete(`verifier:${state}`);
    const token = await canva.exchangeCode(code, verEntry?.provider ?? '');
    await canva.upsertToken(entry.pageId, token);
    res.redirect(`/?canva=connected&pageId=${entry.pageId}`);
  } catch (error) {
    next(error);
  }
});

// Disconnect Canva for a page
app.delete("/api/pages/:id/canva", async (req, res, next) => {
  try {
    await canva.deleteToken(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Check if Canva is connected for a page
app.get("/api/pages/:id/canva/status", async (req, res, next) => {
  try {
    const connected = await canva.isConnected(req.params.id);
    res.json({ connected });
  } catch (error) {
    next(error);
  }
});

// ─── Instagram OAuth (Meta Business Login) ───────────────────────────────────────────

// Step 1: Redirect user to Meta Login
app.get("/auth/instagram", (req, res, next) => {
  try {
    const pageId   = z.string().uuid().parse(req.query.pageId);
    const clientId = configStore.get('INSTAGRAM_APP_ID') || process.env['INSTAGRAM_APP_ID'] || '';
    const redirect = configStore.get('INSTAGRAM_REDIRECT_URI') || process.env['INSTAGRAM_REDIRECT_URI'] || `http://localhost:${env.PORT}/auth/instagram/callback`;
    if (!clientId) return void res.status(400).json({ error: 'INSTAGRAM_APP_ID not configured. Go to Settings → Instagram and fill in your Meta App ID.' });
    const state = crypto.randomUUID();
    storeOAuthState(state, pageId, 'instagram');
    res.redirect(instagram.buildAuthUrl(state, clientId, redirect));
  } catch (error) { next(error); }
});

// Step 2: Meta redirects back
app.get("/auth/instagram/callback", async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    const entry = oauthStateStore.get(state);
    if (!entry) return res.status(400).json({ error: 'Invalid or expired OAuth state' });
    oauthStateStore.delete(state);

    const clientId     = configStore.get('INSTAGRAM_APP_ID')     || process.env['INSTAGRAM_APP_ID']     || '';
    const clientSecret = configStore.get('INSTAGRAM_APP_SECRET') || process.env['INSTAGRAM_APP_SECRET'] || '';
    const redirect     = configStore.get('INSTAGRAM_REDIRECT_URI')|| process.env['INSTAGRAM_REDIRECT_URI']|| `http://localhost:${env.PORT}/auth/instagram/callback`;

    const { accessToken, expiresIn } = await instagram.exchangeCode(code, clientId, clientSecret, redirect);
    // Try to fetch the IG business account @username
    const igUser = await instagram.fetchIgUser(accessToken);
    await instagram.upsertToken(entry.pageId, accessToken, expiresIn, igUser?.igUserId, igUser?.username);
    res.redirect(`/?instagram=connected&pageId=${entry.pageId}`);
  } catch (error) { next(error); }
});

// Status check
app.get("/api/pages/:id/instagram/status", async (req, res, next) => {
  try {
    const info = await instagram.isConnected(req.params.id);
    res.json({ connected: !!info, username: info ? info.username : null });
  } catch (error) { next(error); }
});

// Disconnect
app.delete("/api/pages/:id/instagram", async (req, res, next) => {
  try {
    await instagram.deleteToken(req.params.id);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ─── YouTube OAuth (Google OAuth 2.0) ────────────────────────────────────────────────

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

// Step 1: Redirect to Google
app.get("/auth/youtube", (req, res, next) => {
  try {
    const pageId   = z.string().uuid().parse(req.query.pageId);
    const clientId = configStore.get('YOUTUBE_CLIENT_ID') || env.YOUTUBE_CLIENT_ID || '';
    const redirect = `http://localhost:${env.PORT}/auth/youtube/callback`;
    if (!clientId) return void res.status(400).json({ error: 'YOUTUBE_CLIENT_ID not configured. Go to Settings → YouTube.' });
    const state = crypto.randomUUID();
    storeOAuthState(state, pageId, 'youtube');
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirect,
      response_type: 'code', scope: YT_SCOPES,
      access_type: 'offline', prompt: 'consent', state,
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  } catch (error) { next(error); }
});

// Step 2: Google redirects back
app.get("/auth/youtube/callback", async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    const entry = oauthStateStore.get(state);
    if (!entry) return res.status(400).json({ error: 'Invalid or expired OAuth state' });
    oauthStateStore.delete(state);

    const clientId     = configStore.get('YOUTUBE_CLIENT_ID')     || env.YOUTUBE_CLIENT_ID     || '';
    const clientSecret = configStore.get('YOUTUBE_CLIENT_SECRET') || env.YOUTUBE_CLIENT_SECRET || '';
    const redirect     = `http://localhost:${env.PORT}/auth/youtube/callback`;

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${await tokenRes.text()}`);
    const token: any = await tokenRes.json();

    // Store token in config (simple approach — could move to DB like instagram)
    configStore.set({
      YOUTUBE_ACCESS_TOKEN:  token.access_token,
      YOUTUBE_REFRESH_TOKEN: token.refresh_token ?? '',
      YOUTUBE_PAGE_ID:       entry.pageId,
    } as any);
    res.redirect(`/?youtube=connected&pageId=${entry.pageId}`);
  } catch (error) { next(error); }
});

// YouTube status (simple: check if we have an access token)
app.get("/api/pages/:id/youtube/status", (req, res) => {
  const token   = configStore.get('YOUTUBE_ACCESS_TOKEN' as any);
  const pageId  = configStore.get('YOUTUBE_PAGE_ID' as any);
  const connected = !!(token && pageId === req.params.id);
  res.json({ connected });
});

// YouTube disconnect
app.delete("/api/pages/:id/youtube", (req, res) => {
  configStore.set({ YOUTUBE_ACCESS_TOKEN: '', YOUTUBE_REFRESH_TOKEN: '', YOUTUBE_PAGE_ID: '' } as any);
  res.json({ ok: true });
});

// ─── Canva design endpoints ──────────────────────────────────────────────────

// List user's designs
app.get("/api/pages/:id/canva/designs", async (req, res, next) => {
  try {
    const designs = await canva.listDesigns(req.params.id);
    res.json({ designs });
  } catch (error) {
    next(error);
  }
});

// List brand templates
app.get("/api/pages/:id/canva/templates", async (req, res, next) => {
  try {
    const templates = await canva.listBrandTemplates(req.params.id);
    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

// Get template dataset (what fields can be autofilled)
app.get("/api/pages/:id/canva/templates/:templateId/dataset", async (req, res, next) => {
  try {
    const fields = await canva.getTemplateDataset(req.params.id, req.params.templateId);
    res.json({ fields });
  } catch (error) {
    next(error);
  }
});

// Autofill: POST body = { templateId, data: { fieldName: { type, text|asset_id } } }
// Returns { jobId, designId, editUrl } after polling completes
app.post("/api/pages/:id/canva/autofill", async (req, res, next) => {
  try {
    const { templateId, data } = z.object({
      templateId: z.string(),
      data:       z.record(z.string(), z.any()),
    }).parse(req.body);
    const jobId   = await canva.startAutofill(req.params.id, templateId, data);
    const result  = await canva.pollAutofill(req.params.id, jobId);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

// Export: POST body = { designId, format? (png|pdf|mp4) }
// Returns { urls: string[] }
app.post("/api/pages/:id/canva/export", async (req, res, next) => {
  try {
    const { designId, format } = z.object({
      designId: z.string(),
      format:   z.enum(["png","pdf","mp4"]).default("png"),
    }).parse(req.body);
    const jobId = await canva.startExport(req.params.id, designId, format);
    const urls  = await canva.pollExport(req.params.id, jobId);
    res.json({ ok: true, urls });
  } catch (error) {
    next(error);
  }
});


// ─── Reel script generation via connected LLM ────────────────────────────────
app.post("/api/generate/reel-script", async (req, res, next) => {
  try {
    const { topic, niche, handle, tone = 'educational', slideCount = 5 } = req.body as {
      topic: string; niche?: string; handle?: string; tone?: string; slideCount?: number;
    };
    if (!topic) return void res.status(400).json({ error: 'topic is required' });

    const cfg = llmConfigStore.forTask('generation') ?? llmConfigStore.forTask('all');
    if (!cfg) return void res.status(503).json({ error: 'no_llm', message: 'No LLM configured — use ChatGPT/Gemini/Claude browser option' });

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: resolveBaseUrl(cfg) });

    const bare         = handle?.replace(/^@+/, '');
    const nicheDisplay = (niche ?? 'content').replace(/^@+/, '');
    const ctaLine      = bare ? `Follow @${bare} for daily ${nicheDisplay} breakdowns.` : `Follow for more daily ${nicheDisplay} insights.`;

    const prompt = [
      `Write a ${slideCount}-slide short-form video script (Instagram Reel / YouTube Shorts) about:`,
      `"${topic}"`,
      ``,
      `Rules:`,
      `- Each slide = 1–2 short punchy sentences (text will appear large on screen)`,
      `- Slide 1: Hook — bold claim, surprising stat, or provocative question`,
      `- Slides 2-${slideCount - 1}: Key insights, tips, or steps — no filler, no fluff`,
      `- Slide ${slideCount}: CTA — "${ctaLine}"`,
      `- Tone: ${tone}, conversational, high-retention`,
      ``,
      `Output ONLY the slide text. Separate each slide with a blank line. No labels, no numbering.`,
    ].join('\n');

    const completion = await client.chat.completions.create({
      model: cfg.model,
      messages: [
        { role: 'system', content: 'You write punchy short-form video scripts. No filler words. Mobile-first. Each slide is 1-2 sentences max.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 600,
    });

    const script = completion.choices[0]?.message.content?.trim() ?? '';
    res.json({ ok: true, script, provider: cfg.provider, model: cfg.model });
  } catch (err) {
    next(err);
  }
});

// ─── Reel render (Remotion server-side MP4 export) ──────────────────────────
app.post("/api/content/:id/render-reel", async (req, res, next) => {
  try {
    const { rows } = await query<{ payload: any; page_id: string }>(
      `SELECT payload, page_id FROM content_items WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return void res.status(404).json({ error: 'Content item not found' });

    const payload  = rows[0].payload ?? {};
    const { slides, handle, accent, font, reelTarget, backgroundImages } = req.body as {
      slides: string[]; handle: string; accent: string; font: string; reelTarget: string;
      backgroundImages?: string[];
    };

    if (!slides?.length) return void res.status(400).json({ error: 'slides array is required' });

    // Lazy-import Remotion renderer (heavy — only loaded when needed)
    const { bundle }     = await import('@remotion/bundler');
    const { renderMedia, selectComposition } = await import('@remotion/renderer');
    const path  = await import('path');
    const { fileURLToPath } = await import('url');
    const fs    = await import('fs');

    const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
    const reelRootPath = path.default.resolve(__dirname, '../../src/remotion/ReelRoot.tsx');

    // Bundle the composition (cached by Remotion after first run)
    const bundleLocation = await bundle({
      entryPoint: reelRootPath,
      onProgress: () => {},
    });

    const inputProps = {
      slides,
      handle:           handle ?? '@handle',
      accent:           accent ?? '#F5A623',
      font:             font   ?? 'DM Sans',
      target:           reelTarget ?? 'both',
      backgroundImages: (backgroundImages ?? []).filter(Boolean),
    };

    const { reelDurationFrames, REEL_FPS, REEL_WIDTH, REEL_HEIGHT } =
      await import('../../src/remotion/ReelComposition.js');

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'Reel',
      inputProps,
    });

    const outDir  = path.default.join(UPLOADS_DIR, rows[0].page_id, req.params.id);
    fs.default.mkdirSync(outDir, { recursive: true });
    const outFile = path.default.join(outDir, `reel-${Date.now()}.mp4`);

    await renderMedia({
      composition: {
        ...composition,
        durationInFrames: reelDurationFrames(slides.length),
        fps:    REEL_FPS,
        width:  REEL_WIDTH,
        height: REEL_HEIGHT,
      },
      serveUrl:  bundleLocation,
      codec:     'h264',
      outputLocation: outFile,
      inputProps,
    });

    const url = `/uploads/${rows[0].page_id}/${req.params.id}/${path.default.basename(outFile)}`;
    res.json({ ok: true, url });
  } catch (err) {
    next(err);
  }
});

// ─── Phase 2: Multi-platform publishing ──────────────────────────────────────

// GET connected publish platforms for a page
app.get("/api/pages/:id/publish-platforms", async (req, res, next) => {
  try {
    const igInfo = await instagram.isConnected(req.params.id);
    const igConnected = igInfo !== false;
    res.json({
      platforms: {
        instagram: { connected: igConnected, label: 'Instagram', icon: '📸' },
        facebook:  { connected: igConnected, label: 'Facebook',  icon: '👍' },
        linkedin:  { connected: false, label: 'LinkedIn',   icon: '💼' },
        twitter:   { connected: !!(configStore.get('TWITTER_BEARER_TOKEN')), label: 'Twitter / X', icon: '𝕏' },
        reddit:    { connected: !!(configStore.get('REDDIT_CLIENT_ID') && configStore.get('REDDIT_CLIENT_SECRET')), label: 'Reddit', icon: '🤖' },
      }
    });
  } catch (err) { next(err); }
});

// GET publish jobs for a content item
app.get("/api/content/:id/publish-jobs", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, platform, status, scheduled_at, published_at, external_post_id, external_url, error, created_at, updated_at
       FROM publish_jobs WHERE content_item_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ jobs: rows });
  } catch (err) { next(err); }
});

// POST — create publish jobs and fire immediately (or schedule)
app.post("/api/content/:id/publish", async (req, res, next) => {
  try {
    const { platforms, scheduledAt } = req.body as {
      platforms: string[];
      scheduledAt?: string;   // ISO string — if omitted, publish immediately
    };
    if (!Array.isArray(platforms) || platforms.length === 0)
      return void res.status(400).json({ error: 'platforms[] is required' });

    // Load content item + page for formatting
    const { rows: ciRows } = await query(
      `SELECT c.*, p.id AS page_uuid, p.brand, p.handle FROM content_items c
       JOIN pages p ON p.id = c.page_id WHERE c.id = $1`,
      [req.params.id]
    );
    if (!ciRows[0]) return void res.status(404).json({ error: 'Content item not found' });
    const ci = ciRows[0];
    const payload = ci.payload ?? {};
    const hook    = payload.hook    ?? '';
    const caption = payload.caption ?? '';
    const images: string[] = (Array.isArray(payload.images) ? payload.images : [])
      .filter(Boolean)
      .map((img: any) => typeof img === 'object' ? img.url : img)
      .filter(Boolean);

    const { formatCaption } = await import('../services/platformFormatter.js');
    const { dispatchPublishJob } = await import('../services/platforms/publisher.js');
    const { env } = await import('../config/env.js');

    const jobs: any[] = [];

    for (const platform of platforms) {
      const formattedCaption = formatCaption({
        platform: platform as any,
        hook,
        caption,
        hashtags: payload.hashtags ?? [],
      });

      const isScheduled = !!scheduledAt;
      const { rows: jobRows } = await query(
        `INSERT INTO publish_jobs
           (content_item_id, page_id, platform, status, scheduled_at, formatted_caption)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          req.params.id,
          ci.page_id,
          platform,
          isScheduled ? 'scheduled' : 'pending',
          scheduledAt ?? null,
          formattedCaption,
        ]
      );
      jobs.push(jobRows[0]);

      // Fire immediately in background if not scheduled
      if (!isScheduled) {
        const jobInput = {
          jobId:            jobRows[0].id,
          contentItemId:    req.params.id,
          pageId:           ci.page_id,
          platform:         platform as any,
          formattedCaption,
          imageUrls:        images,
          hook,
        };
        dispatchPublishJob(jobInput, env.POSTING_DRY_RUN).catch(() => {});
      }
    }

    res.json({ ok: true, jobs });
  } catch (err) { next(err); }
});

// ── Publish job management ────────────────────────────────────────────────────

// PATCH /api/publish-jobs/:id  — cancel or reschedule a scheduled job
app.patch("/api/publish-jobs/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body as { action: 'cancel' | 'reschedule' | 'publish-now' | 'dismiss'; scheduledAt?: string };
    if (body.action === 'cancel') {
      await cancelPublishJob(id);
      return void res.json({ ok: true });
    }
    if (body.action === 'reschedule' && body.scheduledAt) {
      await reschedulePublishJob(id, new Date(body.scheduledAt));
      return void res.json({ ok: true });
    }
    if (body.action === 'dismiss') {
      const del = await query(`DELETE FROM publish_jobs WHERE id=$1 AND status='failed'`, [id]);
      if ((del.rowCount ?? 0) === 0) return void res.status(409).json({ error: 'Only failed jobs can be dismissed' });
      return void res.json({ ok: true });
    }
    if (body.action === 'publish-now') {
      const { rows } = await query<any>(
        `SELECT pj.id, pj.content_item_id, pj.page_id, pj.platform, pj.formatted_caption, pj.status, c.payload
         FROM publish_jobs pj
         JOIN content_items c ON c.id = pj.content_item_id
         WHERE pj.id = $1`,
        [id]
      );
      if (!rows[0]) return void res.status(404).json({ error: 'Job not found' });
      if (!['scheduled', 'failed', 'pending'].includes(rows[0].status))
        return void res.status(409).json({ error: 'Job already published or publishing' });
      const { dispatchPublishJob, buildPublishJobInput } = await import('../services/platforms/publisher.js');
      dispatchPublishJob(buildPublishJobInput(rows[0]), env.POSTING_DRY_RUN).catch(() => {});
      return void res.json({ ok: true });
    }
    res.status(400).json({ error: 'Invalid action' });
  } catch (err) { next(err); }
});

// ─── Phase 1.5: Manual topic creation ────────────────────────────────────────

app.post("/api/topics/extract-url", async (req, res, next) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url) return void res.status(400).json({ error: 'url is required' });

    const { extractArticle } = await import("../services/articleExtractor.js");
    const article = await extractArticle(url);

    // Optionally use LLM to extract 3-5 key points from the body text
    let keyPoints = '';
    const cfg = llmConfigStore.forTask('generation') ?? llmConfigStore.forTask('all');
    if (cfg && article.bodyText.length > 200) {
      try {
        const { OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: resolveBaseUrl(cfg) });
        const resp = await client.chat.completions.create({
          model: cfg.model,
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Extract 3-5 punchy key points from this article text as a bullet list (no intro, just the bullets):\n\n${article.bodyText}`,
          }],
        });
        keyPoints = resp.choices[0]?.message?.content?.trim() ?? '';
      } catch { /* LLM optional — silently fall back */ }
    }

    res.json({ ok: true, article: { ...article, keyPoints } });
  } catch (err: any) {
    // Surface extraction errors as 422 so the UI can show "fill in manually"
    res.status(422).json({ error: err?.message ?? 'extraction_failed' });
  }
});

app.post("/api/topics/manual", async (req, res, next) => {
  try {
    const { nicheId, title, keyPoints, sourceUrl, suggestedFormat } = req.body as {
      nicheId: string; title: string; keyPoints?: string;
      sourceUrl?: string; suggestedFormat?: string;
    };
    if (!nicheId) return void res.status(400).json({ error: 'nicheId is required' });
    if (!title?.trim()) return void res.status(400).json({ error: 'title is required' });

    const { createManualTopic } = await import("../services/repositories.js");
    const topic = await createManualTopic({
      nicheId, title, keyPoints: keyPoints ?? '',
      sourceUrl, suggestedFormat: suggestedFormat as any,
    });
    res.json({ ok: true, topic });
  } catch (err) {
    next(err);
  }
});

// ─── Pipeline reset (danger zone) ───────────────────────────────────────────
app.post("/api/reset/pipeline", async (_req, res, next) => {
  try {
    // Truncate topics → cascades to content_items → cascades to posts/performance_metrics
    await query("TRUNCATE topics CASCADE");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _nextFunction: express.NextFunction) => {
  void _nextFunction;
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ error: message });
});

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
