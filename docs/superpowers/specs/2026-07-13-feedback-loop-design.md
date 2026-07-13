# Sprint A — Real Feedback Loop: Design Spec

> Status: Approved design, 2026-07-13
> Scope: publish model consolidation, provider-based metrics capture, learning signals,
> bounded scoring feedback, insights UI.

## Goal

Replace the fake analytics loop (`Math.random()` metrics in the `analyze` worker,
unused `learning_signals` table) with a real closed loop:

```
publish_jobs (published) → metrics capture (1h/24h/7d) → performance_metrics
                → learning aggregation → learning_signals
                → bounded boost in scoreTopic + format suggestion
                → visible in AnalyticsView
```

Instagram is dry-run-only today, so the loop runs on a **deterministic simulated
provider** now and self-upgrades to real Instagram Insights when credentials land —
same interface, zero rework.

## Context / verified facts

- Two parallel publish pipelines exist today. Legacy: `schedule` worker → `posts`
  table → `post` worker → `publishPost()` (throw-only stubs when live) → `analyze`
  worker (random metrics). Phase 2: `publish_jobs` → `dispatchPublishJob()` (real
  Instagram adapter), driven only from the UI.
- **Bug (fixed by this sprint):** `publish_jobs` rows with status `scheduled` are
  never auto-published. Only the manual `publish-now` PATCH action fires them.
- `learning_signals` table exists with zero code references.
- `instagram_tokens` stores per-page `access_token` + `ig_user_id` — sufficient for
  the Insights API.
- All current DB data is dry-run/throwaway. No data preservation required.

## 1. Publish model consolidation

**End state: `publish_jobs` is the only publish record. `posts` is dropped.**

- `schedule` worker: for each approved content item without a publish job, create a
  `publish_jobs` row (status `scheduled`, `scheduled_at` from `nextAvailableSlot`)
  for the page's platform. Reuses the caption formatting used by the schedule-batch
  endpoint.
- `post` worker: every 10 min (existing cadence), select `publish_jobs` where
  `status='scheduled' AND scheduled_at <= now()`, build `PublishJobInput` (same
  payload→images/hook mapping as the `publish-now` handler, extracted into a shared
  helper), call `dispatchPublishJob(input, env.POSTING_DRY_RUN)`.
- Delete `src/services/platforms/posting.ts` and the posts repositories
  (`createPost`, `listPosts`, `markPostPosted`, `listScheduledTimesForPage`
  (rewired to publish_jobs), `insertMetric` (replaced, see §2)).
- `dashboardStats` and `listAnalyticsForPage` queries move from `posts` to
  `publish_jobs`.
- Schema: `DROP TABLE IF EXISTS posts CASCADE;` (idempotent, in schema.sql —
  migration tooling is Sprint B). `publish_jobs` gains `dry_run BOOLEAN NOT NULL
  DEFAULT true`.
- Topic states unchanged; `SCHEDULED`/`POSTED`/`ANALYZED` are derived from
  publish_job status + metric existence where currently derived from posts.

## 2. Metrics schema

Rebuild `performance_metrics` (drop + recreate; data is throwaway):

```sql
CREATE TABLE performance_metrics (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  publish_job_id UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
  capture_point  TEXT NOT NULL CHECK (capture_point IN ('1h','24h','7d')),
  source         TEXT NOT NULL CHECK (source IN ('simulated','instagram')),
  views          INT NOT NULL DEFAULT 0,   -- views w/ impressions fallback
  reach          INT NOT NULL DEFAULT 0,
  likes          INT NOT NULL DEFAULT 0,
  comments       INT NOT NULL DEFAULT 0,
  saves          INT NOT NULL DEFAULT 0,
  shares         INT NOT NULL DEFAULT 0,
  follows        INT NOT NULL DEFAULT 0,
  engagement_rate NUMERIC NOT NULL DEFAULT 0,  -- (likes+comments+saves+shares)/reach
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  learned_at     TIMESTAMPTZ,  -- null until folded into learning_signals (see §7)
  UNIQUE(publish_job_id, capture_point)
);
```

The UNIQUE constraint makes hourly re-runs idempotent.

## 3. MetricsProvider

```ts
interface MetricSnapshot { views; reach; likes; comments; saves; shares; follows; }
interface MetricsProvider {
  readonly source: 'simulated' | 'instagram';
  fetchMetrics(job: PublishedJobContext, point: CapturePoint): Promise<MetricSnapshot | null>;
}
```

- **SimulatedProvider** — deterministic PRNG seeded by `publish_job_id + capture_point`.
  Output shaped by content features: hook score (via `scoreHook`), format (reel >
  carousel > post base multipliers), posting hour (evening bonus). Growth curve
  1h → 24h → 7d. Reproducible: same job always yields same numbers.
- **InstagramInsightsProvider** — `GET graph.instagram.com/{external_post_id}/insights`
  with a single metric-set constant; requests `views` first, falls back to
  `impressions` on an unknown-metric API error (metric names are version-dependent).
  Returns `null` (not an error) when the post is too new or the API is temporarily
  unavailable — a missed capture just retries next hourly run, up to a 7d+24h cutoff.
- **Selection per job:** `instagram` when `job.platform='instagram' AND dry_run=false
  AND external_post_id present AND token exists`, else `simulated`.

**Rebuilt `analyze` worker** (hourly, existing cadence): find published jobs due for
an uncaptured capture point (published_at + 1h/24h/7d elapsed, no row for that
point), fetch via selected provider, insert snapshot. Then run the learn step (§4).

## 4. Learning aggregation

After capture, aggregate **24h snapshots** into `learning_signals` per niche
(niche via publish_job → content_item → topic → niche):

- `signal_type='keyword'`, label = each topic keyword (lowercased):
  `score = EMA(engagement_rate, α=0.3)`, `sample_size += 1`.
- `signal_type='format'`, label = content type (post/carousel/reel): same EMA.

**Source discipline:** aggregation uses real (`instagram`) rows when the niche has
any; otherwise simulated rows. Signals rows record nothing about source — instead,
when the first real metric for a niche arrives, that niche's signals are recomputed
from scratch from real rows only (simulated history discarded). Recompute = delete
niche signals + replay all real 24h snapshots in `captured_at` order.

Uses the existing `learning_signals` table unchanged (`UNIQUE(niche_id,
signal_type, label)` upsert).

## 5. Scoring & format integration

- `scoreTopic(topic, niche, recentTitles, learned?)` gains an optional
  `learned: { keywordScores: Map<string, {score, sampleSize}>, nicheAvg: number }`.
  For topics whose keywords have signals with `sample_size >= 3`: compute mean
  learned engagement of matching keywords vs `nicheAvg`, map to a multiplier
  clamped to **[0.90, 1.10]**. Applied like the seasonal multiplier. Recorded in
  `score_breakdown.learnedBoost` (1.0 when not applied).
- Format suggestion: when a niche has format signals with `sample_size >= 5` for
  the winning format, the rule-based suggester uses that format as its tiebreak.
  Recorded as `format_confidence='learned'` — CHECK constraints on
  `topics.format_confidence` extended via the existing idempotent DROP/ADD pattern.
- The `score` worker loads the niche's learned signals once per niche per run.

## 6. UI — extend AnalyticsView

- Per-post rows show real columns (views/reach/likes/saves/ER at 1h/24h/7d) from the
  rebuilt `listAnalyticsForPage`.
- New "Learning" section: top 10 learned keywords (score bar + sample size), format
  win-rate bars.
- **"Simulated data" banner** whenever displayed metrics include simulated rows.
- TopicCard: small "boosted" badge when `score_breakdown.learnedBoost ≠ 1.0`
  (tooltip shows the multiplier).
- New endpoint `GET /api/pages/:id/learning` returning signals + source mode.

## 7. Error handling

- Provider fetch failure → log, skip; retried next hourly run until cutoff
  (7d + 24h after publish); after cutoff the capture point is abandoned silently.
- Learn step is idempotent per snapshot: `performance_metrics` gains
  `learned_at TIMESTAMPTZ` (null until folded into signals) so EMA never
  double-counts a snapshot.
- Scoring with no/insufficient signals → multiplier 1.0 (loop is strictly additive;
  never blocks the pipeline).

## 8. Testing

Unit (vitest, no DB):
- SimulatedProvider determinism (same seed → same snapshot; growth across points).
- EMA aggregation math + idempotency (replaying a learned snapshot is a no-op).
- Learned boost: clamping to [0.90, 1.10], `sample_size < 3` → 1.0, neutral when
  no keywords match.
- Capture-point due logic (published_at + elapsed vs existing rows).
- `nextAvailableSlot` unchanged (existing tests keep passing with publish_jobs-fed
  input).

Integration (manual, via dry-run stack): approve content → schedule worker creates
job → post worker publishes (stub) → analyze captures 1h snapshot → signals appear
→ next score run shows `learnedBoost` on a matching topic → AnalyticsView renders
with simulated banner.

## Out of scope (later sprints)

- Migration tooling, embedding-based relevance, broader test coverage (Sprint B).
- Conditional posting, evergreen recycling, remixing, competitor ingestion, trend
  alerts (Sprint C — all consume this sprint's metrics).
- Hook-pattern and posting-time learning (explicitly deferred by user).
- YouTube Shorts insights (provider interface accommodates a future provider).
