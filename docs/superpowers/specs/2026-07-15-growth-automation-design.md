# Sprint C — Growth Automation: Design Spec

> Status: Approved design, 2026-07-15
> Scope: conditional posting (cross-post + fast-track), evergreen recycling,
> trend alerts, unified activity/alerts feed.
> Deferred to Sprint D: content remixing, competitor ingestion (user-selected,
> separate spec).

## Goal

Make TPCE act on its own signals instead of waiting to be polled:

- a post that overperforms in its first hour triggers follow-up distribution,
- proven winners come back automatically after a cooldown,
- source-velocity spikes surface as alerts,
- everything the automation does is visible in one feed.

All three features are fully functional in dry-run (they operate on
publish_jobs + performance_metrics, which the simulated provider feeds today)
and require no new credentials.

## Decisions (user-confirmed)

- Sprint C = conditional posting + evergreen recycling + trend alerts.
  Remixing + competitor ingestion = Sprint D (own spec after C ships).
- Conditional actions: **cross-post winner** and **fast-track sibling
  content**. Boost-comment (live-IG-only) explicitly NOT selected.
- Recycling mode: **regenerate caption, reuse media** (no re-render,
  no verbatim repost).
- Architecture: extend existing worker cycles + one `automation_events`
  table (no new queues). Trend alerts delivered in-app only.

## 1. `automation_events` (migration 006)

```sql
CREATE TABLE IF NOT EXISTS automation_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind       TEXT NOT NULL CHECK (kind IN ('cross_post','fast_track','recycle','trend_alert')),
  subject_id UUID NOT NULL,           -- publish_job / content_item / topic id per kind
  niche_id   UUID REFERENCES niches(id) ON DELETE CASCADE,
  page_id    UUID,                    -- nullable; not FK'd (subject may outlive page)
  title      TEXT NOT NULL,           -- human-readable feed line
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at    TIMESTAMPTZ,
  UNIQUE(kind, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_automation_events_unseen
  ON automation_events(created_at DESC) WHERE seen_at IS NULL;
```

The UNIQUE constraint is the idempotency mechanism: every automation action
first INSERTs its event with `ON CONFLICT DO NOTHING` and only proceeds when
the insert claimed a row (`rowCount === 1`). A crash after claim but before
action means that action is skipped forever — acceptable for all four kinds
(they are conveniences, not guarantees), and vastly better than double-firing.

## 2. Pure domain rules — `src/domain/automation.ts`

Constants (exported): `REACT_ENGAGEMENT_MULTIPLIER = 1.5`,
`REACT_MIN_SAMPLES = 3`, `RECYCLE_COOLDOWN_DAYS = 30`,
`RECYCLE_MIN_MULTIPLIER = 1.5`, `TREND_SPIKE_SOURCES = 2`,
`TREND_WINDOW_HOURS = 6`, `TREND_VELOCITY_FLOOR = 0.8`.

Pure predicates (unit-tested, no DB):

- `isOverperforming(engagementRate, nicheAvg1h, sampleSize)` — true when
  `sampleSize >= REACT_MIN_SAMPLES && nicheAvg1h > 0 &&
  engagementRate >= REACT_ENGAGEMENT_MULTIPLIER * nicheAvg1h`.
- `isRecyclable(publishedAt, engagementRate24h, nicheAvg24h, sampleSize, now)`
  — published ≥ RECYCLE_COOLDOWN_DAYS ago AND engagement ≥
  RECYCLE_MIN_MULTIPLIER × nicheAvg24h AND sampleSize ≥ REACT_MIN_SAMPLES.
- `isTrendSpike(sourceCount, firstSeenAt, lastSeenAt, velocity, now)` — true
  when the topic accumulated ≥ 1 + TREND_SPIKE_SOURCES sources within its
  first TREND_WINDOW_HOURS (lastSeenAt − firstSeenAt ≤ window), OR
  velocity ≥ TREND_VELOCITY_FLOOR while the topic is ≤ TREND_WINDOW_HOURS old
  (now − firstSeenAt). One alert per topic ever (enforced by the event
  UNIQUE constraint) — see §5.

Niche averages come from real `performance_metrics` rows per capture point
(1h for reactions, 24h for recycling); when a niche has only simulated rows,
those are used — same source discipline as learning (a niche upgrades to
real-only when real data exists).

## 3. Conditional posting — `src/services/automation/reactor.ts`

Runs inside the hourly `analyze` worker, immediately after
`runMetricsCapture` (which returns the count; extend it to also return the
list of newly-captured `{publishJobId, point}` — or query 1h rows captured in
the last 2h not yet reacted; choose the simpler query-based approach so the
reactor is self-contained and crash-tolerant).

For each fresh 1h snapshot whose job `isOverperforming`:

1. **cross_post** (subject = source publish_job id): find the niche's sibling
   page (same niche, different page id; skip if none). Claim the event; create
   a `scheduled` publish_job for the SAME content_item on the sibling page at
   the next available slot, caption re-formatted via `formatCaption` for the
   sibling platform. Feed line: `↗ Cross-posted "{topic}" to {page}`.
2. **fast_track** (subject = each sibling content_item id): the topic's other
   content_items with status `qa_passed` (not yet approved). Claim per item;
   `approveContentItem` + create scheduled publish_job (same slot logic as
   the schedule worker). Feed line: `⚡ Fast-tracked {type} for "{topic}"`.

Both actions reuse existing repositories/helpers (`scheduleContentBatch`,
`nextAvailableSlot`, `listScheduledTimesForPage`, `formatCaption`,
`approveContentItem`). Failures are caught per action, logged, and the loop
continues; the claimed event row keeps the action from re-firing even after
an error (accepted, see §1).

## 4. Evergreen recycling — `src/services/automation/recycler.ts`

Runs in the same analyze cycle behind a daily guard (skip unless the last
`recycle`-kind event—or a probe of automation_events—was > 20h ago; simpler:
compute candidates only when `new Date().getUTCHours() === 8`, matching the
daily-pipeline spirit; choose the hour-guard for simplicity and document it).

Candidates: published jobs with `published_at <= now() - 30 days`, a 24h
snapshot, `isRecyclable(...)` true, content_item still present, and no
`recycle` event claimed for that publish_job.

Action per candidate (cap 3 per run to avoid floods):

1. Claim event (subject = original publish_job id).
2. Regenerate caption: one LLM chat call ("rewrite this caption freshly,
   same voice, don't mention reposting") via the existing
   `llmConfigStore.forTask('generation') ?? forTask('all')` config + OpenAI
   client pattern already used in server.ts. If no config or the call fails:
   log + release? NO — skip creating the publish_job but keep the claim
   (retry-forever loops are worse; the next eligible winner recycles
   tomorrow). Record the failure in the event payload.
3. Create a `scheduled` publish_job for the same content_item + page at the
   next slot with the fresh caption. Feed line: `♻ Recycled "{topic}"
   ({engagement}% eng)`.

## 5. Trend alerts — `src/services/automation/trendAlerts.ts`

Runs at the END of the `score` worker (after topics are scored, where
fresh source_counts exist). For each scorable-or-just-scored topic:
`isTrendSpike(topic.sourceCount, previousCount, hoursBetween, velocity, ageHours)`.

`previousCount` problem: we don't store history. Solution: the event payload
stores the source_count at alert time; detection compares against the LAST
trend_alert event for predecessors... but UNIQUE(kind, subject_id) allows only
one alert per topic — GOOD (one alert per topic, ever; spikes re-alerting
every hour would be noise). So detection simplifies to: no prior event AND
(`sourceCount >= 1 + TREND_SPIKE_SOURCES` AND `lastSeenAt - firstSeenAt <=
TREND_WINDOW_HOURS` — i.e., accumulated 3+ sources within its first 6 hours)
OR (`velocity >= TREND_VELOCITY_FLOOR` AND topic age ≤ TREND_WINDOW_HOURS).
The pure predicate takes exactly these inputs; adjust its signature to
`isTrendSpike(sourceCount, firstSeenAt, lastSeenAt, velocity, now)`.
Feed line: `🔥 Trending: "{topic}" ({n} sources in {h}h)`.

## 6. API + UI

- `GET /api/alerts?limit=30` → `{ events: [...], unseen: number }` (all kinds,
  newest first, seen + unseen).
- `POST /api/alerts/seen` → marks all unseen as seen (single bulk action —
  per-item seen is YAGNI).
- UI: bell button in the existing topbar (`App.tsx` layout / topbar component)
  with an unseen-count badge; clicking opens a dropdown panel listing the feed
  (icon per kind, title, relative time) and marks all seen on open. New
  component `src/web/components/layout/AlertsBell.tsx`; client methods
  `api.getAlerts()`, `api.markAlertsSeen()`. Poll unseen count with the
  page's existing refresh cadence (or a 60s interval local to the component).

## 7. Error handling

- Every automation step is wrapped: one bad candidate never aborts the cycle,
  and the analyze worker's core capture+learn steps run BEFORE automation so
  automation bugs can't break metrics/learning.
- All automation is a no-op when the niche lacks the minimum metric samples.
- LLM caption regeneration failing skips that recycle (claim kept, payload
  records the error).
- The reactor never cross-posts to a page that already has ANY publish_job
  for that content_item (double-guard beyond the event claim).

## 8. Testing

Pure (vitest): `isOverperforming` (threshold, min-samples, zero-avg),
`isRecyclable` (cooldown boundary, multiplier, samples), `isTrendSpike`
(source-accumulation path, velocity path, too-old topics, already-slow).
Service-level logic stays thin enough to be exercised by the E2E dry-run
pass: backdate metrics to trip each rule, run the analyze/score cycles, and
verify events + created publish_jobs + the alerts endpoint.

## Out of scope

- Boost-comment action (needs live IG comment API — revisit when live).
- Per-rule user configuration UI (constants are code-level for now).
- Push/email notification channels (in-app only).
- Sprint D: remixing, competitor ingestion.
