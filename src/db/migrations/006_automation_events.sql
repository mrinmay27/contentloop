-- Sprint C: automation ledger — idempotency claims + audit log + alerts feed.
CREATE TABLE IF NOT EXISTS automation_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind       TEXT NOT NULL CHECK (kind IN ('cross_post','fast_track','recycle','trend_alert')),
  subject_id UUID NOT NULL,
  niche_id   UUID REFERENCES niches(id) ON DELETE CASCADE,
  page_id    UUID,
  title      TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at    TIMESTAMPTZ,
  UNIQUE(kind, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_automation_events_unseen
  ON automation_events(created_at DESC) WHERE seen_at IS NULL;
