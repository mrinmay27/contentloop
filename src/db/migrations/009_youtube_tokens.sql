-- YouTube OAuth tokens, one per page.
--
-- Mirrors canva_tokens, which already gets this right. YouTube was the only
-- provider storing a single global token in configStore, so connecting a
-- second theme page silently overwrote the first page's channel and /status
-- reported connected for whichever won.
--
-- Adoption of an existing configStore token happens in code, not here: the
-- old value lives in a JSON file this migration cannot read. See
-- services/youtubeTokens.ts adoptLegacyToken().
CREATE TABLE IF NOT EXISTS youtube_tokens (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id        UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT,
  expires_at     TIMESTAMPTZ,
  channel_id     TEXT,
  scope          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(page_id)
);
