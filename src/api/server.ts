import cors from "cors";
import { resolveMediaDir } from "../config/paths.js";
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
  createNiche,
  createPage,
  ensureNiche,
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
import * as canva from "../services/canva.js";
import * as instagram from "../services/instagram.js";
import { configStore, isPostingDryRun, CONFIG_META, type ConfigKey } from "../config/configStore.js";
import { isDesktop } from "../config/mode.js";
import { generateImage as genImage } from "../config/generationProviders.js";
import { llmConfigStore, LLM_PROVIDERS, resolveBaseUrl } from "../config/llmConfigStore.js";
import { probeProvider, loadCapabilities } from "../config/modelDiscovery.js";
import { saveBrandImage, saveContentImage, UPLOADS_DIR } from "../services/imageStorage.js";
import { listVoices, previewVoice, VOICE_PRESETS } from "../services/tts.js";
import { applyAutomationOverrides } from "../domain/automation.js";
import { applySourceQualityOverrides } from "../domain/scoring.js";
import path from 'path';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';

// Sprint U1 Task 6: apply user tuning overrides from the config store (JSON
// strings) at boot — mirrors worker/index.ts so the API process (which also
// runs the scoring predicates via any inline paths) picks up the same
// effective thresholds/multipliers.
try {
  const at = configStore.get("AUTOMATION_THRESHOLDS");
  if (at) {
    applyAutomationOverrides(JSON.parse(at));
    console.log(`[config] automation overrides active: ${at}`);
  }
  const sq = configStore.get("SOURCE_QUALITY_OVERRIDES");
  if (sq) applySourceQualityOverrides(JSON.parse(sq));
} catch (err) { console.warn(`[config] invalid tuning overrides ignored: ${err}`); }

// In-memory OAuth state store (keyed by state param for CSRF protection)
const oauthStateStore = new Map<string, { pageId: string; provider: string }>();
function storeOAuthState(state: string, pageId: string, provider: string) {
  oauthStateStore.set(state, { pageId, provider });
  setTimeout(() => oauthStateStore.delete(state), 10 * 60 * 1000); // 10-min TTL
}

const app = express();
// helmet's default CSP is img-src 'self' data:, which silently broke every
// remote thumbnail: Pexels stock-video previews and Canva template/design
// thumbnails all rendered as broken images.
//
// Widened to https: for images only. The real protection — script-src 'self'
// — is untouched, and there is no dangerouslySetInnerHTML anywhere in the web
// bundle, so LLM output and topic titles cannot inject markup to abuse it.
// Specific hosts would be tighter, but Canva's CDN hostnames are neither
// documented nor stable, and a broken allowlist fails as a broken image with
// no error a user could act on.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "blob:", "https:"],
      // Remote video thumbnails/previews come from the same providers.
      "media-src": ["'self'", "data:", "blob:", "https:"],
    },
  },
}));
app.use(cors());
// Bumped to 25mb so we can accept image data URLs — a 1080×1920 PNG is ~3MB base64,
// and a carousel batch can include several of them in one request.
app.use(express.json({ limit: "25mb" }));

// Sprint U1 Task 7: optional single-user API token for self-hosted deploys.
// Unset (the default, e.g. local dev) = open, matching today's behavior.
// /api/health stays exempt so uptime checks / compose healthchecks don't
// need the token. Positioned after helmet/cors/json, before every route.
const API_TOKEN = process.env.API_TOKEN;
if (API_TOKEN) {
  // Guards the API and the Bull Board queue dashboard. /queues is a browser
  // UI, so it additionally accepts ?token= (headers can't be set from the
  // address bar); the API accepts the Bearer header only.
  // /queues only exists in server mode; guarding a non-existent path would
  // turn desktop's honest 404 into a misleading 401.
  app.use(isDesktop() ? ["/api"] : ["/api", "/queues"], (req, res, next) => {
    if (req.baseUrl === "/api" && req.path === "/health") return next();
    const auth = req.headers.authorization;
    if (auth === `Bearer ${API_TOKEN}`) return next();
    if (req.baseUrl === "/queues" && req.query.token === API_TOKEN) return next();
    res.status(401).json({ error: "unauthorized" });
  });
}

// Serve user-generated images: data/uploads/<pageId>/... → /uploads/<pageId>/...
app.use("/uploads", express.static(UPLOADS_DIR, {
  // Cache for an hour — every URL we hand out has ?v=<timestamp> for cache-busting,
  // so this is safe and saves repeated downloads of the same logo on each render.
  maxAge: '1h',
  fallthrough: false,
}));

// Serve generated media: data/media/<contentId>/... → /media/<contentId>/...
const MEDIA_DIR = resolveMediaDir();
app.use("/media", express.static(MEDIA_DIR, {
  maxAge: '1h',
  fallthrough: true,
}));

// Bull Board is server-mode only: desktop has no Redis/queues. Mounted here
// (before the SPA fallback) but the fallback's negative lookahead already
// excludes /queues, so ordering is not load-bearing.
if (!isDesktop()) {
  const [{ ExpressAdapter }, { createBullBoard }, { BullMQAdapter }, { queues }] = await Promise.all([
    import("@bull-board/express"),
    import("@bull-board/api"),
    import("@bull-board/api/bullMQAdapter"),
    import("../worker/queues.js"),
  ]);
  const boardServer = new ExpressAdapter();
  boardServer.setBasePath("/queues");
  createBullBoard({
    queues: Object.values(queues).map((queue) => new BullMQAdapter(queue)),
    serverAdapter: boardServer,
  });
  app.use("/queues", boardServer.getRouter());
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: env.NODE_ENV, approvalRequired: env.APPROVAL_REQUIRED, postingDryRun: isPostingDryRun() });
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

// Sprint U1 Task 5: custom-niche creation (wizard "Custom niche" path).
app.post("/api/niches", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(2),
      keywords: z.array(z.string().min(1)).min(2),
      monetizationKeywords: z.array(z.string()).default([]),
      negativeKeywords: z.array(z.string()).default([]),
      targetPersona: z.string().min(3),
    }).parse(req.body);
    const { normalizeKeywords } = await import("../domain/keywords.js");
    const niche = await createNiche({
      ...body,
      keywords: normalizeKeywords(body.keywords),
      monetizationKeywords: normalizeKeywords(body.monetizationKeywords),
      negativeKeywords: normalizeKeywords(body.negativeKeywords),
    });
    res.json({ ok: true, niche });
  } catch (err: any) {
    // The generic error middleware always answers 500 (no ZodError special-
    // casing exists in this codebase yet) — this route explicitly maps
    // validation failures to 400 per the plan's live-check contract.
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    // Unique violation on niches.name → friendly 409 instead of raw pg text.
    if (err?.code === '23505') return void res.status(409).json({ error: 'A niche with that name already exists' });
    next(err);
  }
});

/**
 * Built-in niche selection (wizard step 1, non-custom path).
 *
 * Takes a preset id rather than keywords: the presets are defined server-side
 * so a client cannot smuggle in arbitrary niche definitions through this
 * route, and every user picking "AI Tools" gets the same real niche. Idempotent
 * — the second person to pick a preset reuses the existing row instead of
 * colliding with the UNIQUE constraint on niches.name.
 */
app.post("/api/niches/preset", async (req, res, next) => {
  try {
    const { presetId, keywords } = z.object({
      presetId: z.string().min(1),
      // Edits from the wizard's Keywords step. Only applied when the niche is
      // new — ON CONFLICT leaves an existing niche's keywords alone, so one
      // user's edits never silently rewrite a niche someone else is using.
      keywords: z.array(z.string().min(1)).min(2).optional(),
    }).parse(req.body);
    const { findNichePreset } = await import("../domain/nichePresets.js");
    const preset = findNichePreset(presetId);
    if (!preset) return void res.status(404).json({ error: "Unknown niche preset" });

    const { normalizeKeywords } = await import("../domain/keywords.js");
    const niche = await ensureNiche({
      name: preset.name,
      keywords: normalizeKeywords(keywords ?? preset.keywords),
      monetizationKeywords: normalizeKeywords(preset.monetizationKeywords),
      negativeKeywords: [],
      targetPersona: preset.targetPersona,
    });
    res.json({ ok: true, niche });
  } catch (err: any) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    next(err);
  }
});

app.get("/api/pages", async (req, res, next) => {
  try {
    res.json(await listPages(req.query.nicheId?.toString()));
  } catch (error) {
    next(error);
  }
});

// Sprint U1 Task 5: no POST /api/pages existed before this sprint (pages were
// seed-only); added so the custom-niche wizard path can create a real page
// and fire regenerateSources against a real id.
app.post("/api/pages", async (req, res, next) => {
  try {
    const body = z.object({
      nicheId: z.string().uuid(),
      name: z.string().min(2),
      platform: z.enum(["instagram", "youtube_shorts"]).optional(),
      handle: z.string().optional(),
      brand: z.record(z.string(), z.unknown()).optional(),
    }).parse(req.body);
    const page = await createPage(body);
    res.json({ ok: true, page });
  } catch (err: any) {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues });
    // FK violation (bad nicheId) / unique violation (handle) → friendly errors.
    if (err?.code === '23503') return void res.status(400).json({ error: 'Unknown niche' });
    if (err?.code === '23505') return void res.status(409).json({ error: 'A page with that handle already exists for this niche' });
    next(err);
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

// Route 2 — bring your own footage.
//
// The browser POSTs the File as a RAW body (fetch(url, { body: file })), so no
// multipart library is needed: we stream req straight to disk. express.json()
// ignores this route because the content-type is video/*, leaving the stream
// intact. The size guard aborts MID-stream rather than after a 500 MB file has
// already landed — desktop mode runs on a laptop.
//
// The file must land inside MEDIA_DIR: Remotion refuses absolute and file://
// asset paths and only serves from its publicDir, which is MEDIA_DIR.
app.post("/api/content/:id/video", async (req, res, next) => {
  const { isAcceptedVideoType, resolveMaxUploadBytes } = await import("../domain/uploadGuards.js");
  const maxBytes = resolveMaxUploadBytes(configStore.get("MAX_UPLOAD_MB"));
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  if (!isAcceptedVideoType(req.headers["content-type"])) {
    return void res.status(415).json({ error: "Upload an MP4, MOV or WebM video." });
  }

  // ?slideIndex=N stores the clip as that slide's background instead of the
  // whole reel. The render job already maps footage_urls[N] -> slide N and
  // renders video entries with OffthreadVideo, so this completes the route
  // rather than adding a parallel one.
  const rawSlide = req.query.slideIndex;
  const slideIndex = rawSlide === undefined ? null : Number(rawSlide);
  if (slideIndex !== null && (!Number.isInteger(slideIndex) || slideIndex < 0)) {
    return void res.status(400).json({ error: "slideIndex must be a non-negative integer." });
  }

  const dir = slideIndex === null
    ? path.join(MEDIA_DIR, req.params.id)
    : path.join(MEDIA_DIR, req.params.id, "footage");
  const absPath = slideIndex === null
    ? path.join(dir, "source.mp4")
    : path.join(dir, `slide_${slideIndex}.mp4`);

  try {
    fsSync.mkdirSync(dir, { recursive: true });

    let bytes = 0;
    let tooLarge = false;
    await new Promise<void>((resolve, reject) => {
      const out = fsSync.createWriteStream(absPath);
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes && !tooLarge) {
          tooLarge = true;
          // Stop writing, but do NOT destroy the request socket here: killing
          // it prevents the 413 from ever reaching the browser, which then
          // shows a generic network error instead of a message the user can
          // act on. Drain and discard instead; the socket is closed after the
          // response has been sent.
          req.unpipe(out);
          out.destroy();
          req.resume();
          reject(new Error("TOO_LARGE"));
        }
      });
      req.on("error", reject);
      out.on("error", (err) => { if (!tooLarge) reject(err); });
      out.on("finish", resolve);
      req.pipe(out);
    });

    const { probeVideo, describeRejection } = await import("../services/mediaProbe.js");
    const probe = await probeVideo(absPath);
    if (!probe) {
      fsSync.rmSync(absPath, { force: true });
      return void res.status(400).json({ error: "That file has no video track we can read." });
    }
    // Accept non-vertical / over-long footage rather than refusing it: trim and
    // crop can now fix both in place, and refusing the upload would mean the
    // creator could never reach the tool that fixes it. The problem is returned
    // as a WARNING so the UI can offer the fix instead of a dead end.
    const warning = describeRejection(probe);

    const publicUrl = slideIndex === null
      ? `/media/${req.params.id}/source.mp4`
      : `/media/${req.params.id}/footage/slide_${slideIndex}.mp4`;

    let rowCount: number | null = 0;
    if (slideIndex === null) {
      ({ rowCount } = await query(
        `UPDATE content_items
         SET video_url = $2, render_status = 'pending', updated_at = now()
         WHERE id = $1`,
        [req.params.id, publicUrl]
      ));
    } else {
      // Merge into footage_urls at the slide's index, padding gaps with null so
      // slide N always maps to entry N.
      const { rows } = await query<{ footage_urls: any }>(
        `SELECT footage_urls FROM content_items WHERE id = $1`, [req.params.id]
      );
      if (!rows[0]) {
        fsSync.rmSync(absPath, { force: true });
        return void res.status(404).json({ error: "Content item not found" });
      }
      const footage: any[] = Array.isArray(rows[0].footage_urls) ? [...rows[0].footage_urls] : [];
      while (footage.length <= slideIndex) footage.push(null);
      footage[slideIndex] = {
        localPath: absPath, publicUrl, type: "video",
        width: probe.width, height: probe.height, durationSec: probe.durationSec,
      };
      ({ rowCount } = await query(
        `UPDATE content_items
         SET footage_urls = $2, render_status = 'pending', updated_at = now()
         WHERE id = $1`,
        [req.params.id, JSON.stringify(footage)]
      ));
    }
    if (!rowCount) {
      fsSync.rmSync(absPath, { force: true });
      return void res.status(404).json({ error: "Content item not found" });
    }

    res.json({
      ok: true,
      warning,
      asset: {
        kind: "video", url: publicUrl, absPath,
        durationSec: probe.durationSec, width: probe.width, height: probe.height,
        bytes, origin: "user_upload", slideIndex,
      },
    });
  } catch (err: any) {
    fsSync.rmSync(absPath, { force: true });
    if (err?.message === "TOO_LARGE") {
      res.status(413).json({
        error: `That video is larger than ${maxMb} MB. Trim it or export at a lower bitrate.`,
      });
      // Only now stop the client wasting bandwidth on the rest of the file.
      res.on("finish", () => req.destroy());
      return;
    }
    next(err);
  }
});

// Route 3 — captions for an uploaded video. Returns srt:null (not an error)
// when no Groq key is configured, so the UI can fall back to manual captions
// instead of pretending it produced a transcript.
app.post("/api/content/:id/transcribe", async (req, res, next) => {
  try {
    const { rows } = await query<{ video_url: string | null }>(
      `SELECT video_url FROM content_items WHERE id = $1`, [req.params.id]
    );
    if (!rows[0]) return void res.status(404).json({ error: "Content item not found" });
    if (!rows[0].video_url) {
      return void res.status(400).json({ error: "Upload a video first." });
    }

    const absPath = path.join(MEDIA_DIR, req.params.id, "source.mp4");
    if (!fsSync.existsSync(absPath)) {
      return void res.status(400).json({ error: "The uploaded video file is missing — upload it again." });
    }

    const { transcribeVideo, segmentsToSrt } = await import("../services/transcribe.js");
    const segments = await transcribeVideo(absPath);
    if (segments === null) {
      return void res.json({
        ok: true, srt: null,
        note: "No Groq key configured — add one in Settings, or type captions yourself.",
      });
    }

    const srt = segmentsToSrt(segments);
    fsSync.writeFileSync(path.join(MEDIA_DIR, req.params.id, "captions.srt"), srt, "utf-8");
    await query(
      `UPDATE content_items SET subtitle_url = $2, updated_at = now() WHERE id = $1`,
      [req.params.id, `/media/${req.params.id}/captions.srt`]
    );
    res.json({ ok: true, srt, segments: segments.length });
  } catch (err) { next(err); }
});

// Stock footage search. Returns needsKey:true rather than an error when no
// Pexels key is configured, so the UI can point at Settings instead of showing
// a dead end.
app.get("/api/stock/videos", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return void res.status(400).json({ error: "A search term is required." });
    if (!(configStore.get("PEXELS_API_KEY") || process.env.PEXELS_API_KEY)) {
      return void res.json({ needsKey: true, videos: [] });
    }
    const { searchVideos } = await import("../services/stockFootage.js");
    const videos = await searchVideos(q, "portrait", 12);
    res.json({ needsKey: false, videos });
  } catch (err) { next(err); }
});

// Attach a chosen stock clip to a slide. Downloads server-side into MEDIA_DIR
// (Remotion can only composite assets under its publicDir) and writes
// footage_urls[slideIndex], the same slot a manual upload uses.
app.post("/api/content/:id/stock-video", async (req, res, next) => {
  try {
    const { downloadUrl, slideIndex, width, height, durationSec, author, sourceUrl } = req.body as {
      downloadUrl?: string; slideIndex?: number;
      width?: number; height?: number; durationSec?: number;
      author?: string; sourceUrl?: string;
    };
    if (!downloadUrl || !/^https:\/\//.test(downloadUrl)) {
      return void res.status(400).json({ error: "A stock clip must be chosen first." });
    }
    if (!Number.isInteger(slideIndex) || (slideIndex as number) < 0) {
      return void res.status(400).json({ error: "slideIndex must be a non-negative integer." });
    }

    const { rows } = await query<{ footage_urls: any }>(
      `SELECT footage_urls FROM content_items WHERE id = $1`, [req.params.id]
    );
    if (!rows[0]) return void res.status(404).json({ error: "Content item not found" });

    const { downloadMedia } = await import("../services/stockFootage.js");
    const filename = `slide_${slideIndex}.mp4`;
    const localPath = await downloadMedia(downloadUrl, req.params.id, filename);
    const publicUrl = `/media/${req.params.id}/footage/${filename}`;

    const footage: any[] = Array.isArray(rows[0].footage_urls) ? [...rows[0].footage_urls] : [];
    while (footage.length <= (slideIndex as number)) footage.push(null);
    footage[slideIndex as number] = {
      localPath, publicUrl, type: "video",
      width: width ?? 1080, height: height ?? 1920, durationSec: durationSec ?? null,
      // Captured here because it is unrecoverable once the clip is on disk.
      attribution: { provider: "pexels", author, sourceUrl },
    };
    await query(
      `UPDATE content_items SET footage_urls = $2, render_status = 'pending', updated_at = now() WHERE id = $1`,
      [req.params.id, JSON.stringify(footage)]
    );
    res.json({ ok: true, url: publicUrl });
  } catch (err) { next(err); }
});

// Route 5 — bring a finished Canva export back in.
//
// Export already produced download links and stopped there, so the file had to
// be saved by hand and re-uploaded. The server already holds the URL, so it
// fetches it directly and stores it in exactly the slots the upload and stock
// paths use — no special case in the renderer.
app.post("/api/content/:id/canva-media", async (req, res, next) => {
  try {
    const { url, format, slideIndex } = req.body as {
      url?: string; format?: string; slideIndex?: number | null;
    };
    if (!url || !/^https:\/\//.test(url)) {
      return void res.status(400).json({ error: "Export the design first." });
    }

    const { kindForFormat, filenameFor } = await import("../domain/remoteAttach.js");
    const kind = kindForFormat(format);
    if (!kind) {
      return void res.status(400).json({
        error: "PDF exports can't be used as slide media. Export as MP4 or PNG instead.",
      });
    }

    const slot = Number.isInteger(slideIndex) ? (slideIndex as number) : null;
    const { rows } = await query<{ footage_urls: any; payload: any }>(
      `SELECT footage_urls, payload FROM content_items WHERE id = $1`, [req.params.id]
    );
    if (!rows[0]) return void res.status(404).json({ error: "Content item not found" });

    const dir = kind === "video" && slot === null
      ? path.join(MEDIA_DIR, req.params.id)
      : path.join(MEDIA_DIR, req.params.id, "footage");
    fsSync.mkdirSync(dir, { recursive: true });

    const filename = filenameFor(kind, slot);
    const absPath = path.join(dir, filename);
    const publicUrl = kind === "video" && slot === null
      ? `/media/${req.params.id}/${filename}`
      : `/media/${req.params.id}/footage/${filename}`;

    const fetched = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!fetched.ok) {
      return void res.status(502).json({ error: `Canva returned ${fetched.status} for that export.` });
    }
    fsSync.writeFileSync(absPath, Buffer.from(await fetched.arrayBuffer()));

    if (kind === "video") {
      const { probeVideo } = await import("../services/mediaProbe.js");
      const probe = await probeVideo(absPath);
      const entry = {
        localPath: absPath, publicUrl, type: "video",
        width: probe?.width ?? 1080, height: probe?.height ?? 1920,
        durationSec: probe?.durationSec ?? null,
        attribution: { provider: "canva" },
      };
      if (slot === null) {
        await query(
          `UPDATE content_items SET video_url = $2, render_status = 'pending', updated_at = now() WHERE id = $1`,
          [req.params.id, publicUrl]
        );
      } else {
        const footage: any[] = Array.isArray(rows[0].footage_urls) ? [...rows[0].footage_urls] : [];
        while (footage.length <= slot) footage.push(null);
        footage[slot] = entry;
        await query(
          `UPDATE content_items SET footage_urls = $2, render_status = 'pending', updated_at = now() WHERE id = $1`,
          [req.params.id, JSON.stringify(footage)]
        );
      }
    } else {
      // Images live in payload.images, the same slot the generator writes.
      const payload = rows[0].payload ?? {};
      const images: any[] = Array.isArray(payload.images) ? [...payload.images] : [];
      const idx = slot ?? 0;
      while (images.length <= idx) images.push(null);
      images[idx] = { slideIndex: idx, url: publicUrl, source: "canva" };
      await query(
        `UPDATE content_items SET payload = $2, updated_at = now() WHERE id = $1`,
        [req.params.id, JSON.stringify({ ...payload, images })]
      );
    }

    res.json({ ok: true, kind, url: publicUrl });
  } catch (err) { next(err); }
});

// Route 3 — trim and crop uploaded footage in place.
//
// Previously a non-vertical clip was simply refused ('crop it or pick another
// file'), sending the creator off to another app for something the bundled
// ffmpeg can do here.
app.post("/api/content/:id/video/edit", async (req, res, next) => {
  try {
    const { start = 0, end = null, toVertical = false, slideIndex = null } = req.body as {
      start?: number; end?: number | null; toVertical?: boolean; slideIndex?: number | null;
    };

    const slot = Number.isInteger(slideIndex) ? (slideIndex as number) : null;
    const absPath = slot === null
      ? path.join(MEDIA_DIR, req.params.id, "source.mp4")
      : path.join(MEDIA_DIR, req.params.id, "footage", `slide_${slot}.mp4`);
    if (!fsSync.existsSync(absPath)) {
      return void res.status(404).json({ error: "No uploaded video found for this content." });
    }

    const { probeVideo } = await import("../services/mediaProbe.js");
    const before = await probeVideo(absPath);

    const { validateTrim } = await import("../domain/videoEdit.js");
    const problem = validateTrim({
      start: Number(start) || 0,
      end: end === null ? null : Number(end),
      durationSec: before?.durationSec ?? null,
    });
    if (problem) return void res.status(400).json({ error: problem });

    if (!toVertical && !(Number(start) > 0) && end === null) {
      return void res.status(400).json({ error: "Nothing to change — set a trim range or turn on vertical crop." });
    }

    const { editVideo } = await import("../services/videoEditor.js");
    const after = await editVideo({
      absPath,
      start: Number(start) || 0,
      end: end === null ? null : Number(end),
      toVertical: !!toVertical,
    });

    // Keep the stored dimensions honest after a crop, and re-render since the
    // source changed.
    const publicUrl = slot === null
      ? `/media/${req.params.id}/source.mp4`
      : `/media/${req.params.id}/footage/slide_${slot}.mp4`;

    if (slot === null) {
      await query(
        `UPDATE content_items SET render_status = 'pending', updated_at = now() WHERE id = $1`,
        [req.params.id]
      );
    } else {
      const { rows } = await query<{ footage_urls: any }>(
        `SELECT footage_urls FROM content_items WHERE id = $1`, [req.params.id]
      );
      const footage: any[] = Array.isArray(rows[0]?.footage_urls) ? [...rows[0].footage_urls] : [];
      if (footage[slot]) {
        footage[slot] = {
          ...footage[slot],
          width: after?.width ?? footage[slot].width,
          height: after?.height ?? footage[slot].height,
          durationSec: after?.durationSec ?? footage[slot].durationSec,
        };
        await query(
          `UPDATE content_items SET footage_urls = $2, render_status = 'pending', updated_at = now() WHERE id = $1`,
          [req.params.id, JSON.stringify(footage)]
        );
      }
    }

    res.json({
      ok: true,
      // Cache-bust so the browser shows the edited clip, not the old one.
      url: `${publicUrl}?v=${Date.now()}`,
      width: after?.width, height: after?.height, durationSec: after?.durationSec,
    });
  } catch (err: any) {
    if (/Could not edit|empty file|bundled ffmpeg/.test(err?.message ?? "")) {
      return void res.status(422).json({ error: err.message });
    }
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

// ── Sprint U1: Sources API — registry-driven GET, validated PUT, regenerate ──
// (Supersedes the earlier Task 2.0 GET/refresh/DELETE/toggles routes — the
// only caller, SettingsView's ContentSourcesSection, was rewritten to the
// registry-driven SourcesPanel in the same sprint; see Task 4.)

app.get("/api/pages/:id/sources", async (req, res, next) => {
  try {
    const { getCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const { SOURCE_REGISTRY } = await import("../services/ingestion/sourceRegistry.js");
    const map = await getCachedSourceMap(req.params.id);
    const keys: Record<string, boolean> = {};
    for (const s of SOURCE_REGISTRY) if (s.needsKey) keys[s.id] = Boolean(process.env[s.needsKey.env]);

    // Effective values: what ingestion ACTUALLY uses for each field — the
    // user's override when set, otherwise the category/adapter default. The
    // UI dims the defaults so empty fields aren't mistaken for "nothing".
    const { buildEffectiveSources } = await import("../services/ingestion/effectiveSources.js");
    const nicheRow = await query(
      `SELECT n.name, n.keywords FROM pages p JOIN niches n ON n.id = p.niche_id WHERE p.id = $1`,
      [req.params.id]
    );
    let effective: Record<string, { values: string[]; isDefault: boolean }> = {};
    if (nicheRow.rows[0]) {
      const { FINANCE_RSS_FEEDS, GENERAL_BUSINESS_RSS_FEEDS } = await import("../services/ingestion/finance-newsletters.js");
      const { CRYPTO_FEEDS } = await import("../services/ingestion/crypto-news.js");
      effective = buildEffectiveSources(
        nicheRow.rows[0].name,
        nicheRow.rows[0].keywords ?? [],
        map,
        [...FINANCE_RSS_FEEDS, ...GENERAL_BUSINESS_RSS_FEEDS],
        CRYPTO_FEEDS.map((f) => f.url)
      );
    }
    res.json({ registry: SOURCE_REGISTRY, map, keyPresent: keys, effective });
  } catch (error) { next(error); }
});

app.put("/api/pages/:id/sources", async (req, res, next) => {
  try {
    const { getCachedSourceMap, setCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const { validateSourcePatch } = await import("../services/ingestion/sourceMapValidation.js");
    const result = validateSourcePatch(req.body ?? {});
    if (!result.ok) return void res.status(400).json({ error: result.error });
    const existing = await getCachedSourceMap(req.params.id);
    if (!existing) return void res.status(404).json({ error: "No source map yet — regenerate first" });
    const merged = { ...existing, ...result.patch };
    await setCachedSourceMap(req.params.id, merged);
    res.json({ ok: true, map: merged });
  } catch (error) { next(error); }
});

app.post("/api/pages/:id/sources/regenerate", async (req, res, next) => {
  try {
    const { generateSourceMap, getCachedSourceMap, setCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const page = await query(`SELECT p.id, n.name, n.keywords FROM pages p JOIN niches n ON n.id = p.niche_id WHERE p.id = $1`, [req.params.id]);
    if (!page.rows[0]) return void res.status(404).json({ error: "Page not found" });
    // Preserve user config across regeneration — generation itself stays pure
    // (no awareness of prior state); the route merges. sourceEnabled toggles
    // are the user's explicit intent and always win over a fresh map (which
    // has none). googleNewsQueries/financeFeeds/cryptoFeeds are carried over
    // only when the fresh map didn't supply its own (LLM doesn't produce
    // these fields, so they'd otherwise be silently dropped every regen).
    const prior = await getCachedSourceMap(req.params.id);
    await generateSourceMap(req.params.id, page.rows[0].name, page.rows[0].keywords, true);
    let fresh = await getCachedSourceMap(req.params.id);
    if (prior && fresh) {
      fresh = {
        ...fresh,
        sourceEnabled: { ...(fresh.sourceEnabled ?? {}), ...(prior.sourceEnabled ?? {}) },
        googleNewsQueries: fresh.googleNewsQueries?.length ? fresh.googleNewsQueries : prior.googleNewsQueries,
        financeFeeds: fresh.financeFeeds?.length ? fresh.financeFeeds : prior.financeFeeds,
        cryptoFeeds: fresh.cryptoFeeds?.length ? fresh.cryptoFeeds : prior.cryptoFeeds,
      };
      await setCachedSourceMap(req.params.id, fresh);
    }
    res.json({ ok: true, map: fresh });
  } catch (error) { next(error); }
});


app.post("/api/jobs/:name", async (req, res, next) => {
  try {
    // Deliberately duplicated instead of derived from JOB_NAMES: a static
    // import of jobs.ts would drag content-generator/videoRenderer/remotion
    // into the API process. tests/jobs.test.ts asserts the two stay in sync.
    const params = z.object({ name: z.enum(["ingest", "score", "generate", "media", "render", "schedule", "post", "analyze"]) }).parse(req.params);
    if (isDesktop()) {
      // No queue in desktop mode — run the job in-process, fire-and-forget so
      // the request returns immediately (same contract as enqueueing). Uses
      // the shared guard so this can't race the runner's own tick.
      const { runJobGuarded } = await import("../worker/inProcessRunner.js");
      runJobGuarded(params.name).catch((err: any) =>
        console.warn(`[jobs] ${params.name} failed: ${err?.message ?? err}`)
      );
    } else {
      const { queues } = await import("../worker/queues.js");
      await queues[params.name].add(`manual-${params.name}`, {}, { removeOnComplete: 25, removeOnFail: 25 });
    }
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
    if (isDesktop()) {
      // No queue in desktop mode — run the batch media job in-process via the
      // shared guard so it can't race the runner's own tick.
      const { runJobGuarded } = await import("../worker/inProcessRunner.js");
      void runJobGuarded("media").catch((err: any) =>
        console.warn(`[jobs] media failed: ${err?.message ?? err}`)
      );
      return void res.json({ ok: true, queued: 'media', contentId: req.params.id });
    }
    // Enqueue media job with specific content ID
    const { queues } = await import("../worker/queues.js");
    await queues.media.add(`manual-tts-${req.params.id}`, { contentId: req.params.id, voice, rate }, {
      removeOnComplete: 25, removeOnFail: 25,
    });
    res.json({ ok: true, queued: 'media', contentId: req.params.id });
  } catch (err) { next(err); }
});

// POST trigger video render for a specific content item
app.post("/api/content/:id/render", async (req, res, next) => {
  try {
    if (isDesktop()) {
      const { runJobGuarded } = await import("../worker/inProcessRunner.js");
      void runJobGuarded("render").catch((err: any) =>
        console.warn(`[jobs] render failed: ${err?.message ?? err}`)
      );
      return void res.json({ ok: true, queued: 'render', contentId: req.params.id });
    }
    const { queues } = await import("../worker/queues.js");
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
    if (isDesktop()) {
      // No queue in desktop mode — one guarded in-process render pass covers
      // all variants (the render job itself renders everything pending).
      const { runJobGuarded } = await import("../worker/inProcessRunner.js");
      void runJobGuarded("render").catch((err: any) =>
        console.warn(`[jobs] render failed: ${err?.message ?? err}`)
      );
    } else {
      const { queues } = await import("../worker/queues.js");
      for (let i = 0; i < jobs.length; i++) {
        await queues.render.add(`batch-render-${req.params.id}-v${i}`, {
          contentId: req.params.id,
          variantIndex: i,
          variantGroup,
          transition: jobs[i].transition,
          aspect: jobs[i].aspect,
        }, { removeOnComplete: 25, removeOnFail: 25 });
      }
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
    const pageId = parsePageIdParam(req.query.pageId);
    if (!pageId) return void res.status(400).send('Open Settings and pick a page first, then click Connect.');
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
    const pageId   = parsePageIdParam(req.query.pageId);
    if (!pageId) return void res.status(400).send('Open Settings and pick a page first, then click Connect.');
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

// A browser lands on these routes directly, so a schema failure here surfaces
// as a raw 500 stack in the address bar rather than anything a user can act on.
function parsePageIdParam(raw: unknown): string | null {
  const parsed = z.string().uuid().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

// Step 1: Redirect to Google
app.get("/auth/youtube", (req, res, next) => {
  try {
    const pageId   = parsePageIdParam(req.query.pageId);
    if (!pageId) return void res.status(400).send('Open Settings and pick a page first, then click Connect.');
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

    // Per page, like instagram and canva. A single global slot meant a second
    // page silently overwrote the first page's channel.
    const { saveToken, fetchChannel } = await import("../services/youtubeTokens.js");
    // Which channel did they just authorise? Asked once, here, so the Settings
    // card can name it instead of saying only "Connected".
    const channel = await fetchChannel(token.access_token);
    await saveToken(entry.pageId, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      scope: token.scope ?? null,
      channelId: channel.status === "ok" ? channel.id : null,
      channelTitle: channel.status === "ok" ? channel.title : null,
    });
    // Say so now, not at publish time.
    const outcome = channel.status === "no_channel" ? "nochannel" : "connected";
    res.redirect(`/?youtube=${outcome}&pageId=${entry.pageId}`);
  } catch (error) { next(error); }
});

// YouTube status — per page, so two pages report independently.
app.get("/api/pages/:id/youtube/status", async (req, res, next) => {
  try {
    const { getToken, saveToken, fetchChannel, ensureFreshToken } =
      await import("../services/youtubeTokens.js");
    const row = await getToken(req.params.id);
    if (!row) return void res.json({ connected: false, username: null });

    // Connections made before the channel was recorded would show a blank
    // name forever. Fill it in on first sight instead of asking the user to
    // disconnect and reconnect for a cosmetic field.
    let title = row.channelTitle;
    let noChannel = false;
    if (!title) {
      try {
        // Must write back the token ensureFreshToken returned, not row's:
        // it may have just refreshed and stored a new one, and passing the
        // stale value here would overwrite the fresh token with an expired one.
        const access = await ensureFreshToken(req.params.id);
        const channel = await fetchChannel(access);
        if (channel.status === "ok") {
          await saveToken(req.params.id, {
            accessToken: access,
            channelId: channel.id, channelTitle: channel.title,
          });
          title = channel.title;
        } else if (channel.status === "no_channel") {
          noChannel = true;
        }
      } catch { /* still connected; the name is the only thing missing */ }
    }
    // username is what OAuthConnectCard renders beside "Connected"; for
    // YouTube the meaningful identity is the channel, not the Google account.
    // noChannel is the one that matters: authorised, but nothing to upload to.
    res.json({ connected: true, username: title, noChannel });
  } catch (err) { next(err); }
});

// YouTube disconnect — this page only, never every page at once.
app.delete("/api/pages/:id/youtube", async (req, res, next) => {
  try {
    const { deleteToken } = await import("../services/youtubeTokens.js");
    await deleteToken(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
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

    // YouTube was missing from this list entirely, which made the whole
    // YouTube publishing path unreachable: a user could connect a channel in
    // Settings, see "Connected", and then find no YouTube checkbox to tick.
    // The key must be youtube_shorts — that is what the formatter, the
    // publisher's switch and publish_jobs.platform all use.
    const { getToken } = await import("../services/youtubeTokens.js");
    const ytConnected = !!(await getToken(req.params.id));

    res.json({
      platforms: {
        instagram: { connected: igConnected, label: 'Instagram', icon: '📸' },
        youtube_shorts: { connected: ytConnected, label: 'YouTube Shorts', icon: '▶️' },
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
      `SELECT id, platform, status, scheduled_at, published_at, external_post_id, external_url, error,
              dry_run, created_at, updated_at
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

    const { PLATFORM_META } = await import('../services/platformFormatter.js');
    const unknown = platforms.filter(p => !(p in PLATFORM_META));
    if (unknown.length)
      return void res.status(400).json({
        error: `Unknown platform${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. `
             + `Valid: ${Object.keys(PLATFORM_META).join(', ')}`,
      });

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
          // ci is SELECT c.*, so video_url is already loaded — it just was
          // never passed on. This is a THIRD publish path, built inline rather
          // than through buildPublishJobInput, so grepping for that helper
          // would have missed it. The compiler caught it.
          videoUrl:         ci.video_url ?? null,
          hook,
        };
        dispatchPublishJob(jobInput, isPostingDryRun()).catch(() => {});
      }
    }

    // Scheduling is a state change too. Without this a topic queued for
    // Friday sat in Selected looking unhandled, and the Scheduled tab — which
    // reads topics.state — stayed empty however many jobs were queued.
    if (scheduledAt && jobs.length) {
      await query(
        `UPDATE topics SET state='SCHEDULED'
         WHERE id = (SELECT topic_id FROM content_items WHERE id = $1)
           AND state <> 'POSTED'`,
        [req.params.id]
      );
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
      const { rows } = await query<any>(`SELECT status FROM publish_jobs WHERE id = $1`, [id]);
      if (!rows[0]) return void res.status(404).json({ error: 'Job not found' });
      if (rows[0].status !== 'failed')
        return void res.status(409).json({ error: 'Only failed jobs can be dismissed' });
      await query(`DELETE FROM publish_jobs WHERE id=$1`, [id]);
      return void res.json({ ok: true });
    }
    if (body.action === 'publish-now') {
      const { rows } = await query<any>(
        `SELECT pj.id, pj.content_item_id, pj.page_id, pj.platform, pj.formatted_caption, pj.status,
                c.payload, c.video_url
         FROM publish_jobs pj
         JOIN content_items c ON c.id = pj.content_item_id
         WHERE pj.id = $1`,
        [id]
      );
      if (!rows[0]) return void res.status(404).json({ error: 'Job not found' });
      if (!['scheduled', 'failed', 'pending'].includes(rows[0].status))
        return void res.status(409).json({ error: 'Job already published or publishing' });
      const { dispatchPublishJob, buildPublishJobInput } = await import('../services/platforms/publisher.js');
      dispatchPublishJob(buildPublishJobInput(rows[0]), isPostingDryRun()).catch(() => {});
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

// Sprint U1 Task 7: prod static serving of the built SPA (dist-web), for
// the single-container self-host deploy where the API also serves the UI.
// Must come AFTER every /api, /uploads, /media, /queues route (those are
// the prefixes excluded below) and BEFORE the error handler. Path
// resolution is dist-aware: this file runs compiled from
// dist/src/api/server.js in production, so ../../../dist-web resolves to
// <repo-root>/dist-web (Docker COPYs both dist/ and dist-web/ as siblings
// under /app). WEB_DIST overrides for non-standard layouts.
if (env.NODE_ENV === "production") {
  // Resolve dist-web for BOTH layouts: compiled (dist/src/api/server.js →
  // ../../../dist-web = repo root) and source-via-tsx (src/api/server.ts →
  // ../../dist-web). Desktop mode runs from source, so a single hardcoded
  // depth silently resolves outside the repo and every page 500s.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST
    ?? [path.join(here, "../../../dist-web"), path.join(here, "../../dist-web")]
         .find((candidate) => fsSync.existsSync(path.join(candidate, "index.html")))
    ?? path.join(here, "../../../dist-web");
  app.use(express.static(webDist));
  app.get(/^\/(?!api|uploads|media|queues).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.use((error: unknown, _req: express.Request, res: express.Response, _nextFunction: express.NextFunction) => {
  void _nextFunction;
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ error: message });
});

// Desktop mode is a single-user app on a personal machine with no proxy and
// usually no API_TOKEN — binding all interfaces would expose the API (and the
// config routes that hold LLM keys) to the whole LAN. Server mode keeps
// 0.0.0.0 because Docker/reverse-proxy owns that boundary.
// Move any pre-existing global YouTube token into the per-page table. Runs
// after migrations (desktop imports this module only once they have applied)
// and must never stop boot — an install that had YouTube connected should not
// be silently disconnected, but a failure here is not fatal either.
import("../services/youtubeTokens.js")
  .then(({ adoptLegacyToken }) => adoptLegacyToken())
  .catch((err) => console.warn(`[youtube] token adoption skipped: ${err?.message}`));

app.listen(env.PORT, isDesktop() ? "127.0.0.1" : "0.0.0.0", () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
