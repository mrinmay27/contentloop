-- Sprint B: cached embedding vectors (JSONB float arrays, unit-normalized).
ALTER TABLE topics ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE niches ADD COLUMN IF NOT EXISTS embedding JSONB;
