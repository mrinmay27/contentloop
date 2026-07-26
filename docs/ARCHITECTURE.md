# Architecture

## Modules

1. Trend ingestion
   - Google Trends adapter
   - Reddit hot-post adapter
   - RSS adapter
   - Twitter/X recent-search adapter with credential-free fallback
   - 21 total sources: HackerNews, arXiv, PubMed, Product Hunt, YouTube Trends, etc.

2. Topic scoring
   - Multi-factor scoring: recency, cross-source, velocity, audience relevance, monetization, novelty
   - Source quality multipliers (HN: 1.30, arXiv: 1.25, Google Trends: 0.80)
   - Seasonal context adjustment
   - **Semantic relevance** *(Sprint B)*: Gemini `gemini-embedding-001` vectors
     (cached in `topics.embedding`/`niches.embedding` JSONB) blend with keyword
     relevance via `max()` — paraphrased on-niche topics with zero keyword
     overlap are rescued instead of hard-discarded. A separate near-duplicate
     band drives paraphrase-aware novelty. Keyword-only when no gemini key or
     on any embedding/DB failure (the semantic layer can never block scoring).
     Cosine bands are empirically calibrated — see `src/domain/similarity.ts`.
   - Keyword hygiene: `normalizeKeywords` (≤40 chars, ≤4 words, ≤10 per topic)
     guards every topic write path; learned signals skip long legacy labels.
   - `>= 0.50`: selected, `0.35-0.49`: backup, `< 0.35`: discarded

3. Content generation
   - Multi-LLM support (Groq, OpenRouter, OpenAI, or any OpenAI-compatible endpoint)
   - deterministic fallback for local dry runs
   - outputs 2 Reel scripts, 8-slide carousel, captions, and hashtags
   - Format suggestion AI (post vs. carousel vs. reel)

4. QA gate
   - hook clarity, non-generic language, readability, CTA presence, carousel structure
   - Niche-specific gates: health (no miracle claims), finance (no guaranteed returns), food (allergen caution)

5. **Media pipeline** *(new — inspired by MoneyPrinterTurbo)*
   - **TTS voice synthesis**: Azure Edge TTS (free, no API key) with niche-aware voice presets
   - **Stock footage sourcing**: Pexels API for auto-downloading royalty-free B-roll by keyword
   - **Subtitle generation**: Word-boundary SRT from TTS timing
   - **Background music**: Random or specified BGM from `data/bgm/` library

6. **Video rendering** *(new — inspired by MoneyPrinterTurbo)*
   - **Remotion composition**: slide-based Reel with word-by-word animations, Ken Burns zoom, progress HUD
   - **MP4 export**: Remotion renderer → silent video → ffmpeg audio muxing
   - **Audio mixing**: TTS voice at full volume + BGM at configurable volume (default 15%)
   - **Subtitle burning**: SRT → ffmpeg hardcoded subtitles (styled: white text, dark outline, background box)
   - **Multi-aspect-ratio**: portrait (1080×1920), landscape (1920×1080), square (1080×1080)
   - **Transitions**: fade, slide, zoom, wipe, hard cut — configurable per content item
   - **Batch generation**: render N variants (different transitions/aspects) for A/B testing
   - Fallback to ffmpeg slideshow when Remotion/Chromium unavailable

7. Scheduler
   - 2-3 posts per page per day
   - minimum 3-hour gap
   - default slots: 12:00, 17:00, 21:00
   - manual approval required before scheduling

8. Platform integration
   - Instagram Graph API (OAuth + media container publishing)
   - YouTube Shorts (OAuth, dry-run by default)
   - Dry-run by default — live adapters require credentials and policy review

9. Feedback loop *(Sprint A — real closed loop)*
   - **Publish model:** `publish_jobs` is the only publish record (legacy `posts` table dropped).
     The schedule worker creates `scheduled` jobs with formatted captions; the post worker
     claims due jobs atomically (`FOR UPDATE SKIP LOCKED`, concurrency 1) and publishes via
     `dispatchPublishJob`. Stale `publishing` claims self-heal back to `scheduled` after 15 min.
   - **Metrics capture:** hourly `analyze` worker snapshots each published job at 1h / 24h / 7d
     into `performance_metrics` via a `MetricsProvider` interface — `simulated` (deterministic,
     seeded by job id, shaped by hook score / format / posting hour) in dry-run,
     `instagram` (Graph API `/insights`, `views`→`impressions` fallback) automatically for live
     non-dry-run posts. Real captures skip points staler than 2× their nominal age
     (IG insights are cumulative-lifetime values).
   - **Learning:** 24h snapshots fold into `learning_signals` (EMA α=0.3) per niche —
     `keyword` and `format` engagement signals. Fold is transactional (no double-count on
     crash). A niche learns from simulated data until its first real snapshot, which triggers
     a rebuild from real rows only.
   - **Scoring feedback:** `scoreTopic` applies a learned-keyword multiplier clamped to
     [0.90, 1.10] (needs sample_size ≥ 3), recorded as `score_breakdown.learnedBoost`.
     Format suggestion uses the niche's proven winning format (sample_size ≥ 5) as a
     tiebreak for weak rule/page_default decisions (`format_confidence='learned'`).
   - **UI:** AnalyticsView shows per-post metrics, a Learning Signals card, and a
     "simulated data" banner; TopicCard shows a boosted/damped badge.

10. Growth automation *(Sprint C)*
   - **Reactor** (hourly, after metrics capture): a post whose 1h engagement
     beats its niche average ×1.5 (min 3 in-mode samples) triggers a
     cross-post to the niche's sibling page (platform-compatible only) and
     fast-tracks the topic's qa_passed sibling drafts (schedule-then-approve —
     ordering prevents a double-schedule race with the schedule worker).
   - **Evergreen recycler** (daily): published winners ≥30 days old with 24h
     engagement ≥1.5× niche average are re-queued with an LLM-regenerated
     caption (media reused; ≤3 LLM attempts/run; skips silently without LLM).
   - **Trend alerts**: topics accumulating 3+ sources within their first 6
     hours (or velocity ≥0.8 while fresh) raise a one-time alert.
   - **`automation_events`** is the single ledger: claim-once idempotency
     (UNIQUE(kind, subject)), audit log, and the alerts feed behind the
     sidebar bell (unseen badge, mark-seen on open).
   - Niche averages follow the same simulated→real source discipline as
     learning; every automation step is error-isolated and runs after the
     core capture/learn/score paths.

11. UI — inbox-first *(Sprint D-UI)*
   - Home screen is a cross-page **Inbox**: a clearable "Needs you" lane
     (drafts awaiting approval with the real platform-formatted preview,
     failed publishes with Retry/Dismiss) above an "Activity" lane
     (automation events + posted items with 24h-outcome chips), a
     since-yesterday digest strip, and next-scheduled posts. Keyboard:
     j/k focus, A approve, R reject. Opening the inbox marks alerts seen.
   - Navigation: Inbox (home) · Calendar · Performance · Topics · Pipeline ·
     Settings. The old dashboard/pipeline remain as power views; score rings
     are colored by decision thresholds (≥50 green / 35–49 amber / <35 red).
   - Backed by one aggregate endpoint (`GET /api/inbox`).

12. **Configurability & self-host** *(Sprint U1 — universal self-host)*
   - **Source registry + DB-backed maps**: `SOURCE_REGISTRY`
     (`src/services/ingestion/sourceRegistry.ts`) is a static manifest of all
     14 ingestion sources — id, label, description, which `PageSourceMap`
     fields it exposes (subreddits, tags, search phrases, feed URLs), and
     which env var (if any) it needs. It drives the Settings → Sources UI
     generically (`SourcesPanel.tsx`) — no per-source UI code. Per-page
     source config (`page_source_maps`, migration `007`) replaced the
     gitignored `data/page-sources.json` cache; a fresh install starts empty
     and the AI "regenerate" flow populates it, or a legacy cache is
     one-time-imported on first read. `GET/PUT /api/pages/:id/sources` +
     `POST /api/pages/:id/sources/regenerate` (validated via
     `sourceMapValidation.ts`) are the only write paths; regenerate merges
     rather than clobbers (user toggles/custom feeds survive a re-run).
   - **Custom niches**: `POST /api/niches` lets the wizard's "+ Custom
     niche" path create a niche (name, keywords, persona, monetization/
     negative keywords) instead of picking from the seeded set; the wizard
     then calls `POST /api/pages` and fires `sources/regenerate`
     fire-and-forget for the new page.
   - **Tunables**: constants that used to be hardcoded — automation
     thresholds (`src/domain/automation.ts`: react/recycle/trend-alert
     sensitivity) and per-source scoring quality multipliers
     (`src/domain/scoring.ts`) — are now a defaults object + a live object
     mutated by `applyAutomationOverrides()` / `applySourceQualityOverrides()`
     (clamped to sane ranges; `null` resets to defaults). Both the API and
     worker processes apply `AUTOMATION_THRESHOLDS` /
     `SOURCE_QUALITY_OVERRIDES` (JSON blobs in `configStore`) at boot, so a
     restart is required for tuning changes to take effect. Rendered by
     `AdvancedTuning.tsx` under Settings → Advanced.
   - **Docker packaging**: a single multi-stage `Dockerfile` builds once and
     serves both process roles — `scripts/docker-entrypoint.sh` runs
     migrations then execs either `dist/src/api/server.js` or
     `dist/src/worker/index.js` depending on `TPCE_ROLE` (`api` | `worker`).
     `docker-compose.yml`'s opt-in `full` profile (`docker compose --profile
     full up`) adds `app-api` and `app-worker` services alongside the
     existing `postgres`/`redis` services, both built from the same image.
     Migrations resolve their directory via `MIGRATIONS_DIR` (set inside the
     image) with a filesystem-probing fallback for non-Docker compiled runs
     (`src/db/migrate.ts`). In production, the API process also serves the
     built SPA (`dist-web/`, overridable via `WEB_DIST`) with an SPA
     fallback route that excludes `/api`, `/uploads`, `/media`, `/queues`.
   - **`API_TOKEN`**: optional single-user bearer token for `/api/*`
     (`/api/health` exempt) — unset (default) matches today's open local-dev
     behavior; the web client attaches it from `localStorage` if a self-host
     operator sets one. Not a substitute for TLS/reverse-proxy — see
     `SECURITY.md`.

13. **Run modes** *(Sprint D2 — desktop mode)*
   - **`TPCE_MODE`** (`src/config/mode.ts`) gates the differences: `server`
     (default) runs BullMQ workers against Redis and an external Postgres,
     with `api` and `worker` as separate processes (the Docker/`npm run dev`
     topology) and bull-board mounted at `/queues`. `desktop` runs a single
     process (`src/desktop/main.ts`, `npm run desktop`) with an embedded
     Postgres cluster (`embedded-postgres`, an *optional* dependency — server-
     mode/Docker installs don't pull its ~144MB of platform binaries), no
     Redis, and no bull-board (`/queues` 404s).
   - **Shared job bodies**: both modes run the same eight pipeline jobs
     (`ingest`, `score`, `generate`, `media`, `render`, `schedule`, `post`,
     `analyze`), defined once in `src/worker/jobs.ts`. Server mode wires them
     into BullMQ `Worker`s (`src/worker/index.ts`); desktop mode drives them
     from an in-process runner (`src/worker/inProcessRunner.ts`).
   - **Desktop scheduling is elapsed-time, not wall-clock cron**: a
     `job_runs` table (migration `008`) persists each job's last-run
     timestamp so schedule state survives restarts (proven: a restart
     reusing an existing cluster applies zero migrations and does not
     re-initialise). On launch the runner does a catch-up pass (`post` →
     `schedule` → `analyze` → `ingest` → `score` → `generate`, skipping the
     heavier `media`/`render`) so a job that came due while the app was
     closed — e.g. a post scheduled 2 hours in the past — still runs within
     seconds of the next launch, then ticks every 60s comparing elapsed time
     against each job's cadence.
   - **Boot order**: `src/desktop/main.ts` starts embedded Postgres, applies
     migrations, starts Express serving the built UI (`dist-web`, cold start
     ~60s on first run for `initdb`, ~25s on a warm restart), then starts the
     in-process runner — all in one process.
   - **Known limitation**: generated media still resolves to
     `process.cwd()/data/media` (hardcoded), so desktop mode currently writes
     media relative to the install directory rather than `TPCE_DATA_DIR`.
     A Phase 2 fix will make the media directory configurable.

## Migrations

Schema changes live as numbered SQL files in `src/db/migrations/`
(`001_baseline.sql`, `002_embeddings.sql`, …), applied in filename order by
`npm run db:init` / `npm run db:migrate` (and automatically by
`npm run dev`'s bootstrap). Applied versions are tracked in
`schema_migrations`; each file runs inside a transaction, and concurrent
runners are serialized with a Postgres advisory lock. **Never edit an
applied migration — add a new numbered file.** Migrations run from TS source
via tsx only; the build does not copy `.sql` into `dist/`.

## Queue States

`IDEA → SCORED → CONTENT_READY → QA_PASSED → [MEDIA → RENDER] → scheduled → published → analyzed`

(Topic states through QA are unchanged; publish states now live on `publish_jobs.status`:
`pending → scheduled → publishing → published` (or `failed`), with metrics/learning derived
from `performance_metrics` rather than a topic state.)

## API Endpoints (Media)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tts/voices` | List available TTS voices + presets |
| POST | `/api/tts/preview` | Preview a voice on a text snippet (returns MP3) |
| GET | `/api/content/:id/media` | Get media status (audio, footage, video) |
| POST | `/api/content/:id/synthesize` | Trigger TTS synthesis for a content item |
| POST | `/api/content/:id/render` | Trigger video rendering for a content item |
| POST | `/api/content/:id/batch-render` | Render N variants with different transitions/aspects |
| GET | `/api/content/:id/variants` | List all variants in a batch group |
| GET | `/api/media/options` | Available aspect ratios and transitions |
| POST | `/api/jobs/media` | Run media worker manually |
| POST | `/api/jobs/render` | Run render worker manually |

## API Endpoints (Feedback Loop)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pages/:id/analytics` | Per-post metrics (1h/24h/7d) + type breakdown + simulated flag |
| GET | `/api/pages/:id/learning` | Learned keyword/format signals + mode (real/simulated) |
| POST | `/api/jobs/analyze` | Run metrics capture + learning fold + automation manually |
| GET | `/api/alerts` | Automation activity feed + unseen count |
| POST | `/api/alerts/seen` | Mark all feed events seen |
| GET | `/api/inbox` | Aggregated inbox: needs-you, activity, digest, next scheduled |

## MVP Limits

- Seeded to 2 niches and 2 pages per niche
- No multi-user permissions
- No live posting unless `POSTING_DRY_RUN=false` and adapters are completed with approved credentials

