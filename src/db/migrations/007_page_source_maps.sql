-- Sprint U1: source maps move from gitignored data/page-sources.json to the
-- DB so a fresh install keeps its configuration.
CREATE TABLE IF NOT EXISTS page_source_maps (
  page_id    UUID PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  map        JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
