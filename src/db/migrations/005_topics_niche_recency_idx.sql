-- Sprint B: serve the per-niche recent-embedding pool (novelty comparison)
-- and any niche-recency scans without a full table sort.
CREATE INDEX IF NOT EXISTS idx_topics_niche_recency ON topics(niche_id, last_seen_at DESC);
