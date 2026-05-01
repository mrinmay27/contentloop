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
  createPost,
  dashboardStats,
  listAnalyticsForPage,
  listApprovedContentWithoutPost,
  listContentItems,
  listNiches,
  listPages,
  listPosts,
  listScheduledPostsForMonth,
  listScheduledTimesForPage,
  listTopics,
  rejectContentItem,
  updateTopicFormat
} from "../services/repositories.js";
import { queues } from "../worker/queues.js";
import * as canva from "../services/canva.js";
import * as instagram from "../services/instagram.js";
import { configStore, CONFIG_META, type ConfigKey } from "../config/configStore.js";
import { llmConfigStore, LLM_PROVIDERS } from "../config/llmConfigStore.js";

// In-memory OAuth state store (keyed by state param for CSRF protection)
const oauthStateStore = new Map<string, { pageId: string; provider: string }>();
function storeOAuthState(state: string, pageId: string, provider: string) {
  oauthStateStore.set(state, { pageId, provider });
  setTimeout(() => oauthStateStore.delete(state), 10 * 60 * 1000); // 10-min TTL
}

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

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
    res.json({ ok: true, saved: Object.keys(safe) });
  } catch (error) {
    next(error);
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

app.get("/api/topics", async (req, res, next) => {
  try {
    const nicheId = req.query.nicheId?.toString();
    res.json(await listTopics(nicheId));
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


app.get("/api/content", async (req, res, next) => {
  try {
    res.json(await listContentItems(req.query.status?.toString()));
  } catch (error) {
    next(error);
  }
});

app.get("/api/posts", async (req, res, next) => {
  try {
    res.json(await listPosts(req.query.state?.toString()));
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
      hook:     z.string().optional(),
      caption:  z.string().optional(),
      slides:   z.array(z.object({ id: z.number(), text: z.string() })).optional(),
      cta:      z.string().optional(),
      branding: z.record(z.string(), z.unknown()).optional(),
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
    const approved = await listApprovedContentWithoutPost();
    const scheduled = [];
    for (const item of approved) {
      const existing = await listScheduledTimesForPage(item.page_id);
      const slot = nextAvailableSlot(existing);
      const postId = await createPost(item.id, item.page_id, item.platform, slot, env.POSTING_DRY_RUN);
      scheduled.push({ postId, contentItemId: item.id, scheduledAt: slot });
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


app.post("/api/jobs/:name", async (req, res, next) => {
  try {
    const params = z.object({ name: z.enum(["ingest", "score", "generate", "post", "analyze"]) }).parse(req.params);
    await queues[params.name].add(`manual-${params.name}`, {}, { removeOnComplete: 25, removeOnFail: 25 });
    res.json({ ok: true, queued: params.name });
  } catch (error) {
    next(error);
  }
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


app.use((error: unknown, _req: express.Request, res: express.Response, _nextFunction: express.NextFunction) => {
  void _nextFunction;
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ error: message });
});

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
