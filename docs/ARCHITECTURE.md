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

