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
  format_confidence TEXT CHECK (format_confidence IN ('user', 'llm', 'rule', 'page_default')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(niche_id, title)
);

-- Migration: add format columns to existing topics tables
ALTER TABLE topics ADD COLUMN IF NOT EXISTS suggested_format TEXT CHECK (suggested_format IN ('post', 'carousel', 'reel'));
ALTER TABLE topics ADD COLUMN IF NOT EXISTS format_confidence TEXT CHECK (format_confidence IN ('user', 'llm', 'rule', 'page_default'));
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
