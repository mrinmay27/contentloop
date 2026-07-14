CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS niches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  keywords TEXT[] NOT NULL,
  monetization_keywords TEXT[] NOT NULL,
  negative_keywords TEXT[] NOT NULL DEFAULT '{}',
  target_persona TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche_id UUID NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube_shorts')),
  handle TEXT NOT NULL,
  brand JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(niche_id, platform, handle)
);

CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche_id UUID NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  sources TEXT[] NOT NULL,
  source_count INT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  velocity NUMERIC NOT NULL DEFAULT 0,
  score NUMERIC,
  score_breakdown JSONB,
  decision TEXT CHECK (decision IN ('selected', 'backup', 'discarded')),
  state TEXT NOT NULL DEFAULT 'IDEA' CHECK (state IN ('IDEA', 'SCORED', 'CONTENT_READY', 'QA_PASSED', 'SCHEDULED', 'POSTED', 'ANALYZED')),
  suggested_format TEXT CHECK (suggested_format IN ('post', 'carousel', 'reel')),
  format_confidence TEXT CHECK (format_confidence IN ('user', 'llm', 'rule', 'page_default', 'learned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(niche_id, title)
);

-- Migration: add format columns to existing topics tables
ALTER TABLE topics ADD COLUMN IF NOT EXISTS suggested_format TEXT CHECK (suggested_format IN ('post', 'carousel', 'reel'));
ALTER TABLE topics ADD COLUMN IF NOT EXISTS format_confidence TEXT CHECK (format_confidence IN ('user', 'llm', 'rule', 'page_default', 'learned'));
ALTER TABLE topics ADD COLUMN IF NOT EXISTS source_url TEXT;

CREATE TABLE IF NOT EXISTS content_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('post', 'reel', 'carousel')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'qa_failed', 'qa_passed', 'approved', 'rejected')),
  payload JSONB NOT NULL,
  qa_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube_shorts')),
  state TEXT NOT NULL DEFAULT 'QA_PASSED' CHECK (state IN ('IDEA', 'SCORED', 'CONTENT_READY', 'QA_PASSED', 'SCHEDULED', 'POSTED', 'ANALYZED')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  external_post_id TEXT,
  approval_required BOOLEAN NOT NULL DEFAULT true,
  approved_at TIMESTAMPTZ,
  dry_run BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  views_1h INT NOT NULL DEFAULT 0,
  views_24h INT NOT NULL DEFAULT 0,
  saves INT NOT NULL DEFAULT 0,
  follows_gained INT NOT NULL DEFAULT 0,
  engagement_rate NUMERIC NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche_id UUID NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  label TEXT NOT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  sample_size INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(niche_id, signal_type, label)
);

CREATE INDEX IF NOT EXISTS idx_topics_state_score ON topics(state, score DESC);
CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_posts_state_scheduled ON posts(state, scheduled_at);

-- Phase 2: publish_jobs — tracks per-platform publish attempts for each content_item
CREATE TABLE IF NOT EXISTS publish_jobs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_item_id  UUID        NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  page_id          UUID        NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  platform         TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','scheduled','publishing','published','failed')),
  scheduled_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  external_post_id TEXT,
  external_url     TEXT,
  error            TEXT,
  formatted_caption TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_content ON publish_jobs(content_item_id);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_status  ON publish_jobs(status, scheduled_at);

-- Migration: ensure content_items.type allows all three formats.
-- The original constraint may have been created with only ('reel','carousel') before
-- 'post' was added. DROP + ADD is idempotent — safe to run on every boot.
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_type_check;
ALTER TABLE content_items ADD CONSTRAINT content_items_type_check
  CHECK (type IN ('post', 'reel', 'carousel'));

-- Migration: ensure content_items.status allows all expected states.
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_status_check;
ALTER TABLE content_items ADD CONSTRAINT content_items_status_check
  CHECK (status IN ('draft', 'qa_failed', 'qa_passed', 'approved', 'rejected'));

-- Canva OAuth tokens (one per page, upserted on connect)
CREATE TABLE IF NOT EXISTS canva_tokens (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id        UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT,
  expires_at     TIMESTAMPTZ,
  canva_user_id  TEXT,
  scope          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(page_id)
);

-- ── Media pipeline migrations ─────────────────────────────────────────────────
-- TTS audio, stock footage, BGM, and rendered video tracking on content_items.

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS audio_duration_sec NUMERIC;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS subtitle_url TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS footage_urls JSONB;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS bgm_url TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS render_status TEXT DEFAULT 'pending'
  CHECK (render_status IN ('pending', 'rendering', 'muxing', 'done', 'failed'));
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS tts_voice TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS word_boundaries JSONB;

-- Batch generation: variant tracking for A/B video testing
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS variant_index INT DEFAULT 0;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS variant_group UUID;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS aspect_ratio TEXT DEFAULT 'portrait'
  CHECK (aspect_ratio IN ('portrait', 'landscape', 'square'));
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS transition_type TEXT DEFAULT 'fade'
  CHECK (transition_type IN ('fade', 'slide', 'zoom', 'wipe', 'none'));

-- ── Sprint A: Real feedback loop ──────────────────────────────────────────────
-- publish_jobs is now the only publish record. posts is dropped (dev data is
-- throwaway). performance_metrics is rebuilt keyed on publish_jobs with
-- capture points and provenance.

-- Drop legacy tables only when the old shape is present (posts table exists,
-- or performance_metrics still has the old post_id column).
DROP TABLE IF EXISTS posts CASCADE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'performance_metrics' AND column_name = 'post_id'
  ) THEN
    DROP TABLE performance_metrics CASCADE;
  END IF;
END $$;

ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS performance_metrics (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  publish_job_id  UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
  capture_point   TEXT NOT NULL CHECK (capture_point IN ('1h','24h','7d')),
  source          TEXT NOT NULL CHECK (source IN ('simulated','instagram')),
  views           INT NOT NULL DEFAULT 0,
  reach           INT NOT NULL DEFAULT 0,
  likes           INT NOT NULL DEFAULT 0,
  comments        INT NOT NULL DEFAULT 0,
  saves           INT NOT NULL DEFAULT 0,
  shares          INT NOT NULL DEFAULT 0,
  follows         INT NOT NULL DEFAULT 0,
  engagement_rate NUMERIC NOT NULL DEFAULT 0,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  learned_at      TIMESTAMPTZ,
  UNIQUE(publish_job_id, capture_point)
);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_unlearned
  ON performance_metrics(capture_point) WHERE learned_at IS NULL;

-- format_confidence gains 'learned'
ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_format_confidence_check;
ALTER TABLE topics DROP CONSTRAINT IF EXISTS topics_format_confidence_check1;
ALTER TABLE topics ADD CONSTRAINT topics_format_confidence_check
  CHECK (format_confidence IN ('user', 'llm', 'rule', 'page_default', 'learned'));
