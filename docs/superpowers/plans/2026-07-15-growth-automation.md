# Sprint C — Growth Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conditional posting (cross-post + fast-track on 1h overperformance), evergreen recycling (30-day cooldown winners re-queued with fresh captions), trend alerts (source-velocity spikes), all feeding one `automation_events` activity feed with a bell UI.

**Architecture:** One `automation_events` table is idempotency ledger + audit log + alerts feed (UNIQUE(kind, subject_id); claim via INSERT ... ON CONFLICT DO NOTHING). Pure predicates in `src/domain/automation.ts`; thin services in `src/services/automation/`; reactor + recycler run at the end of the hourly `analyze` worker (after capture+learn), trend detection at the end of the `score` worker. Spec: `docs/superpowers/specs/2026-07-15-growth-automation-design.md`.

**Tech Stack:** TypeScript ESM (`.js` suffixes), pg raw SQL (`query`/`withTransaction` from `src/db/pool.js`), vitest, React 19, migrations via `src/db/migrations/NNN_*.sql` (`npm run db:init`).

**Conventions:** full gates = `npx vitest run` (currently 100 tests) + `npx tsc -p tsconfig.json --noEmit`. Dev DB: docker compose, `docker compose exec -T postgres psql -U theme -d theme_engine -c "..."`. Commit per task. Never edit applied migrations — 006 is the next free number.

---

### Task 1: Migration 006 + events repository

**Files:**
- Create: `src/db/migrations/006_automation_events.sql`
- Create: `src/services/automation/eventsRepo.ts`

- [ ] **Step 1: Migration**

Create `src/db/migrations/006_automation_events.sql`:

```sql
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
```

Run `npm run db:init` → 006 applied; run again → up to date. Verify `\d automation_events`.

- [ ] **Step 2: Events repository**

Create `src/services/automation/eventsRepo.ts`:

```ts
import { query } from "../../db/pool.js";

export type AutomationKind = "cross_post" | "fast_track" | "recycle" | "trend_alert";

export interface AutomationEvent {
  id: string;
  kind: AutomationKind;
  subjectId: string;
  nicheId: string | null;
  pageId: string | null;
  title: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  seenAt: Date | null;
}

/** Claim the right to perform an automation action exactly once.
 *  Returns true when this call inserted the row (caller may act),
 *  false when the (kind, subject) was already claimed. */
export async function claimEvent(opts: {
  kind: AutomationKind;
  subjectId: string;
  nicheId?: string | null;
  pageId?: string | null;
  title: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  const result = await query(
    `INSERT INTO automation_events (kind, subject_id, niche_id, page_id, title, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (kind, subject_id) DO NOTHING`,
    [opts.kind, opts.subjectId, opts.nicheId ?? null, opts.pageId ?? null, opts.title,
     JSON.stringify(opts.payload ?? {})]
  );
  return (result.rowCount ?? 0) === 1;
}

/** Merge extra data into a claimed event's payload (e.g. record an error). */
export async function annotateEvent(kind: AutomationKind, subjectId: string, extra: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE automation_events SET payload = payload || $3::jsonb
     WHERE kind = $1 AND subject_id = $2`,
    [kind, subjectId, JSON.stringify(extra)]
  );
}

export async function listEvents(limit = 30): Promise<{ events: AutomationEvent[]; unseen: number }> {
  const [rows, unseen] = await Promise.all([
    query(
      `SELECT * FROM automation_events ORDER BY created_at DESC LIMIT $1`,
      [limit]
    ),
    query(`SELECT count(*)::int AS n FROM automation_events WHERE seen_at IS NULL`),
  ]);
  return {
    events: rows.rows.map((r: any) => ({
      id: r.id, kind: r.kind, subjectId: r.subject_id, nicheId: r.niche_id,
      pageId: r.page_id, title: r.title, payload: r.payload ?? {},
      createdAt: new Date(r.created_at), seenAt: r.seen_at ? new Date(r.seen_at) : null,
    })),
    unseen: unseen.rows[0].n,
  };
}

export async function markAllSeen(): Promise<void> {
  await query(`UPDATE automation_events SET seen_at = now() WHERE seen_at IS NULL`);
}

/** True when any 'recycle' event was created in the last N hours —
 *  the recycler's cheap once-a-day guard. */
export async function recycleRanRecently(hours = 20): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM automation_events
     WHERE kind = 'recycle' AND created_at > now() - ($1 || ' hours')::interval
     LIMIT 1`,
    [String(hours)]
  );
  return r.rows.length > 0;
}
```

- [ ] **Step 3: Gates + commit**

`npx vitest run` (100) + `npx tsc -p tsconfig.json --noEmit` clean.

```bash
git add -A
git commit -m "feat(automation): events ledger table + claim/list/seen repository"
```

---

### Task 2: Pure automation rules (TDD)

**Files:**
- Create: `src/domain/automation.ts`
- Test: `tests/automation.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/automation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isOverperforming, isRecyclable, isTrendSpike,
  REACT_ENGAGEMENT_MULTIPLIER, REACT_MIN_SAMPLES, RECYCLE_COOLDOWN_DAYS,
} from "../src/domain/automation.js";

const at = (iso: string) => new Date(iso);

describe("isOverperforming", () => {
  it("true when engagement >= 1.5x niche average with enough samples", () => {
    expect(isOverperforming(0.09, 0.05, 5)).toBe(true);
  });
  it("false below the multiplier", () => {
    expect(isOverperforming(0.07, 0.05, 5)).toBe(false);
  });
  it("false with too few samples", () => {
    expect(isOverperforming(0.09, 0.05, REACT_MIN_SAMPLES - 1)).toBe(false);
  });
  it("false when niche average is zero or non-finite", () => {
    expect(isOverperforming(0.09, 0, 5)).toBe(false);
    expect(isOverperforming(0.09, NaN, 5)).toBe(false);
  });
  it("exact threshold counts (>=)", () => {
    expect(isOverperforming(0.05 * REACT_ENGAGEMENT_MULTIPLIER, 0.05, 5)).toBe(true);
  });
});

describe("isRecyclable", () => {
  const now = at("2026-07-15T12:00:00Z");
  it("true for an old enough winner", () => {
    expect(isRecyclable(at("2026-06-01T12:00:00Z"), 0.09, 0.05, 5, now)).toBe(true);
  });
  it("false inside the cooldown", () => {
    expect(isRecyclable(at("2026-07-01T12:00:00Z"), 0.09, 0.05, 5, now)).toBe(false);
  });
  it("cooldown boundary: exactly 30 days is eligible", () => {
    const published = new Date(now.getTime() - RECYCLE_COOLDOWN_DAYS * 86_400_000);
    expect(isRecyclable(published, 0.09, 0.05, 5, now)).toBe(true);
  });
  it("false when not a winner", () => {
    expect(isRecyclable(at("2026-06-01T12:00:00Z"), 0.06, 0.05, 5, now)).toBe(false);
  });
  it("false with insufficient samples or zero average", () => {
    expect(isRecyclable(at("2026-06-01T12:00:00Z"), 0.09, 0.05, 2, now)).toBe(false);
    expect(isRecyclable(at("2026-06-01T12:00:00Z"), 0.09, 0, 5, now)).toBe(false);
  });
});

describe("isTrendSpike", () => {
  const now = at("2026-07-15T12:00:00Z");
  it("fires on source accumulation: 3+ sources within first 6 hours", () => {
    expect(isTrendSpike(3, at("2026-07-15T07:00:00Z"), at("2026-07-15T11:00:00Z"), 0.2, now)).toBe(true);
  });
  it("does not fire when sources accumulated slowly", () => {
    expect(isTrendSpike(5, at("2026-07-10T12:00:00Z"), at("2026-07-15T11:00:00Z"), 0.2, now)).toBe(false);
  });
  it("fires on high velocity for a fresh topic", () => {
    expect(isTrendSpike(1, at("2026-07-15T08:00:00Z"), at("2026-07-15T08:00:00Z"), 0.85, now)).toBe(true);
  });
  it("does not fire on high velocity for an old topic", () => {
    expect(isTrendSpike(1, at("2026-07-10T08:00:00Z"), at("2026-07-10T09:00:00Z"), 0.85, now)).toBe(false);
  });
  it("does not fire for a quiet fresh topic", () => {
    expect(isTrendSpike(2, at("2026-07-15T08:00:00Z"), at("2026-07-15T09:00:00Z"), 0.3, now)).toBe(false);
  });
});
```

Run `npx vitest run tests/automation.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement**

Create `src/domain/automation.ts`:

```ts
/** Pure predicates for growth automation. Thresholds are code-level config
 *  (spec: per-rule UI is out of scope). Sample-size gating mirrors the
 *  learning loop's discipline — never act on noise. */

export const REACT_ENGAGEMENT_MULTIPLIER = 1.5;
export const REACT_MIN_SAMPLES = 3;
export const RECYCLE_COOLDOWN_DAYS = 30;
export const RECYCLE_MIN_MULTIPLIER = 1.5;
export const TREND_SPIKE_SOURCES = 2;
export const TREND_WINDOW_HOURS = 6;
export const TREND_VELOCITY_FLOOR = 0.8;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** A 1h snapshot beats the niche's 1h average decisively. */
export function isOverperforming(
  engagementRate: number,
  nicheAvg1h: number,
  sampleSize: number
): boolean {
  if (sampleSize < REACT_MIN_SAMPLES) return false;
  if (!Number.isFinite(nicheAvg1h) || nicheAvg1h <= 0) return false;
  if (!Number.isFinite(engagementRate)) return false;
  return engagementRate >= REACT_ENGAGEMENT_MULTIPLIER * nicheAvg1h;
}

/** A published winner past its cooldown, judged on 24h engagement. */
export function isRecyclable(
  publishedAt: Date,
  engagementRate24h: number,
  nicheAvg24h: number,
  sampleSize: number,
  now: Date = new Date()
): boolean {
  if (now.getTime() - publishedAt.getTime() < RECYCLE_COOLDOWN_DAYS * DAY_MS) return false;
  if (sampleSize < REACT_MIN_SAMPLES) return false;
  if (!Number.isFinite(nicheAvg24h) || nicheAvg24h <= 0) return false;
  if (!Number.isFinite(engagementRate24h)) return false;
  return engagementRate24h >= RECYCLE_MIN_MULTIPLIER * nicheAvg24h;
}

/** Source-velocity spike: accumulated 1+TREND_SPIKE_SOURCES sources within the
 *  topic's first TREND_WINDOW_HOURS, or high raw velocity while fresh. */
export function isTrendSpike(
  sourceCount: number,
  firstSeenAt: Date,
  lastSeenAt: Date,
  velocity: number,
  now: Date = new Date()
): boolean {
  const window = TREND_WINDOW_HOURS * HOUR_MS;
  const accumulatedFast =
    sourceCount >= 1 + TREND_SPIKE_SOURCES &&
    lastSeenAt.getTime() - firstSeenAt.getTime() <= window;
  const hotAndFresh =
    velocity >= TREND_VELOCITY_FLOOR &&
    now.getTime() - firstSeenAt.getTime() <= window;
  return accumulatedFast || hotAndFresh;
}
```

Run → 15 passed. Full gates.

- [ ] **Step 3: Commit**

```bash
git add src/domain/automation.ts tests/automation.test.ts
git commit -m "feat(automation): pure overperformance/recycling/trend-spike predicates"
```

---

### Task 3: Reactor (cross-post + fast-track) + analyze wiring

**Files:**
- Create: `src/services/automation/reactor.ts`
- Modify: `src/worker/index.ts` (analyze worker)

- [ ] **Step 1: Reactor service**

Create `src/services/automation/reactor.ts`:

```ts
import { query } from "../../db/pool.js";
import { isOverperforming } from "../../domain/automation.js";
import { nextAvailableSlot } from "../scheduler.js";
import { formatCaption, type PublishPlatform } from "../platformFormatter.js";
import {
  approveContentItem,
  listScheduledTimesForPage,
  scheduleContentBatch,
} from "../repositories.js";
import { claimEvent } from "./eventsRepo.js";

interface FreshWinnerRow {
  publish_job_id: string;
  content_item_id: string;
  topic_id: string;
  niche_id: string;
  page_id: string;
  topic_title: string;
  engagement_rate: number;
  payload: any;
}

/** Fresh (last 2h) 1h snapshots joined to their content/topic/niche, with the
 *  niche's 1h engagement average + sample count computed alongside. */
async function listFreshWinnerCandidates(): Promise<Array<FreshWinnerRow & { niche_avg: number; sample_size: number }>> {
  const r = await query(
    `
    WITH niche_avg AS (
      SELECT t.niche_id,
             avg(pm.engagement_rate)::float8 AS avg_1h,
             count(*)::int AS samples
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE pm.capture_point = '1h'
      GROUP BY t.niche_id
    )
    SELECT pj.id AS publish_job_id, c.id AS content_item_id, t.id AS topic_id,
           t.niche_id, pj.page_id, t.title AS topic_title,
           pm.engagement_rate::float8 AS engagement_rate, c.payload,
           na.avg_1h AS niche_avg, na.samples AS sample_size
    FROM performance_metrics pm
    JOIN publish_jobs pj ON pj.id = pm.publish_job_id
    JOIN content_items c ON c.id = pj.content_item_id
    JOIN topics t ON t.id = c.topic_id
    JOIN niche_avg na ON na.niche_id = t.niche_id
    WHERE pm.capture_point = '1h' AND pm.captured_at > now() - interval '2 hours'
    `
  );
  return r.rows;
}

/** Sibling page in the same niche (different page), if any. */
async function findSiblingPage(nicheId: string, pageId: string): Promise<{ id: string; platform: string } | null> {
  const r = await query(
    `SELECT id, platform FROM pages WHERE niche_id = $1 AND id <> $2 LIMIT 1`,
    [nicheId, pageId]
  );
  return r.rows[0] ?? null;
}

async function contentHasJobOnPage(contentItemId: string, pageId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM publish_jobs WHERE content_item_id = $1 AND page_id = $2 LIMIT 1`,
    [contentItemId, pageId]
  );
  return r.rows.length > 0;
}

/** The topic's other qa_passed content items (any page). */
async function listSiblingDrafts(topicId: string, excludeContentId: string): Promise<Array<{ id: string; page_id: string; platform: string; payload: any; type: string }>> {
  const r = await query(
    `SELECT c.id, c.page_id, p.platform, c.payload, c.type
     FROM content_items c JOIN pages p ON p.id = c.page_id
     WHERE c.topic_id = $1 AND c.id <> $2 AND c.status = 'qa_passed'`,
    [topicId, excludeContentId]
  );
  return r.rows;
}

async function scheduleOnPage(contentItemId: string, pageId: string, platform: string, payload: any): Promise<Date> {
  const existing = await listScheduledTimesForPage(pageId);
  const slot = nextAvailableSlot(existing);
  const formattedCaption = formatCaption({
    platform: platform as PublishPlatform,
    hook: payload?.hook ?? "",
    caption: payload?.caption ?? "",
    hashtags: payload?.hashtags ?? [],
  });
  await scheduleContentBatch([{ contentItemId, pageId, platform, scheduledAt: slot, formattedCaption }]);
  return slot;
}

/** Evaluate fresh 1h snapshots; fire cross-post + fast-track for winners.
 *  Every action is claim-first (idempotent) and individually error-isolated. */
export async function runReactor(): Promise<number> {
  let fired = 0;
  const candidates = await listFreshWinnerCandidates();
  for (const row of candidates) {
    if (!isOverperforming(row.engagement_rate, row.niche_avg, row.sample_size)) continue;

    // Action 1: cross-post to the niche's sibling page.
    try {
      const sibling = await findSiblingPage(row.niche_id, row.page_id);
      if (sibling && !(await contentHasJobOnPage(row.content_item_id, sibling.id))) {
        const claimed = await claimEvent({
          kind: "cross_post", subjectId: row.publish_job_id,
          nicheId: row.niche_id, pageId: sibling.id,
          title: `↗ Cross-posted "${row.topic_title}"`,
          payload: { engagementRate: row.engagement_rate, nicheAvg: row.niche_avg, toPage: sibling.id },
        });
        if (claimed) {
          await scheduleOnPage(row.content_item_id, sibling.id, sibling.platform, row.payload);
          fired += 1;
        }
      }
    } catch (err: any) {
      console.warn(`[reactor] cross_post failed for job ${row.publish_job_id}: ${err?.message}`);
    }

    // Action 2: fast-track the topic's other qa_passed drafts.
    try {
      const drafts = await listSiblingDrafts(row.topic_id, row.content_item_id);
      for (const draft of drafts) {
        const claimed = await claimEvent({
          kind: "fast_track", subjectId: draft.id,
          nicheId: row.niche_id, pageId: draft.page_id,
          title: `⚡ Fast-tracked ${draft.type} for "${row.topic_title}"`,
          payload: { triggeredBy: row.publish_job_id },
        });
        if (!claimed) continue;
        await approveContentItem(draft.id);
        await scheduleOnPage(draft.id, draft.page_id, draft.platform, draft.payload);
        fired += 1;
      }
    } catch (err: any) {
      console.warn(`[reactor] fast_track failed for topic ${row.topic_id}: ${err?.message}`);
    }
  }
  return fired;
}
```

- [ ] **Step 2: Wire into the analyze worker**

In `src/worker/index.ts`, the analyze worker currently runs capture + learn.
Append automation AFTER them (automation bugs must never break metrics):

```ts
new Worker(
  "analyze",
  async () => {
    const { runMetricsCapture } = await import("../services/metrics/index.js");
    const { runLearningStep } = await import("../services/learningService.js");
    const captured = await runMetricsCapture();
    if (captured > 0) console.log(`[analyze] Captured ${captured} metric snapshot(s)`);
    await runLearningStep();

    // Growth automation — after core capture+learn, individually shielded.
    try {
      const { runReactor } = await import("../services/automation/reactor.js");
      const fired = await runReactor();
      if (fired > 0) console.log(`[analyze] Reactor fired ${fired} action(s)`);
    } catch (err: any) {
      console.warn(`[analyze] reactor failed: ${err?.message}`);
    }
  },
  { connection, concurrency: 1 } // learn step must not overlap itself
);
```

- [ ] **Step 3: Gates + commit**

Full gates green.

```bash
git add -A
git commit -m "feat(automation): reactor — cross-post + fast-track on 1h overperformance"
```

---

### Task 4: Recycler + analyze wiring

**Files:**
- Create: `src/services/automation/recycler.ts`
- Modify: `src/worker/index.ts` (analyze worker, after reactor)

- [ ] **Step 1: Recycler service**

Create `src/services/automation/recycler.ts`:

```ts
import { query } from "../../db/pool.js";
import { isRecyclable } from "../../domain/automation.js";
import { llmConfigStore } from "../../config/llmConfigStore.js";
import { nextAvailableSlot } from "../scheduler.js";
import { formatCaption, type PublishPlatform } from "../platformFormatter.js";
import { listScheduledTimesForPage, scheduleContentBatch } from "../repositories.js";
import { annotateEvent, claimEvent, recycleRanRecently } from "./eventsRepo.js";

const MAX_RECYCLES_PER_RUN = 3;

interface RecycleCandidate {
  publish_job_id: string;
  content_item_id: string;
  niche_id: string;
  page_id: string;
  platform: string;
  topic_title: string;
  published_at: Date;
  engagement_rate: number;
  niche_avg: number;
  sample_size: number;
  payload: any;
}

async function listRecycleCandidates(): Promise<RecycleCandidate[]> {
  const r = await query(
    `
    WITH niche_avg AS (
      SELECT t.niche_id, avg(pm.engagement_rate)::float8 AS avg_24h, count(*)::int AS samples
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE pm.capture_point = '24h'
      GROUP BY t.niche_id
    )
    SELECT pj.id AS publish_job_id, c.id AS content_item_id, t.niche_id,
           pj.page_id, pj.platform, t.title AS topic_title, pj.published_at,
           pm.engagement_rate::float8 AS engagement_rate,
           na.avg_24h AS niche_avg, na.samples AS sample_size, c.payload
    FROM performance_metrics pm
    JOIN publish_jobs pj ON pj.id = pm.publish_job_id
    JOIN content_items c ON c.id = pj.content_item_id
    JOIN topics t ON t.id = c.topic_id
    JOIN niche_avg na ON na.niche_id = t.niche_id
    WHERE pm.capture_point = '24h'
      AND pj.status = 'published'
      AND pj.published_at <= now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM automation_events ae
        WHERE ae.kind = 'recycle' AND ae.subject_id = pj.id
      )
    ORDER BY pm.engagement_rate DESC
    LIMIT 10
    `
  );
  return r.rows.map((row: any) => ({ ...row, published_at: new Date(row.published_at) }));
}

/** One LLM call to freshen the caption. Returns null on any failure. */
export async function regenerateCaption(originalCaption: string, hook: string, nicheName: string): Promise<string | null> {
  const cfg = llmConfigStore.forTask("generation") ?? llmConfigStore.forTask("all");
  if (!cfg) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl ?? undefined });
    const resp = await client.chat.completions.create({
      model: cfg.model,
      messages: [{
        role: "user",
        content: [
          `Rewrite this social media caption for a ${nicheName} page so it reads fresh,`,
          `keeping the same voice, message, and rough length. Do not mention reposting`,
          `or that it was rewritten. Return ONLY the caption text.`,
          ``,
          `Hook: ${hook}`,
          `Caption: ${originalCaption}`,
        ].join("\n"),
      }],
      temperature: 0.8,
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err: any) {
    console.warn(`[recycler] caption regen failed: ${err?.message}`);
    return null;
  }
}

/** Daily evergreen pass: re-queue proven winners with a fresh caption. */
export async function runRecycler(now: Date = new Date()): Promise<number> {
  if (await recycleRanRecently()) return 0;

  const candidates = await listRecycleCandidates();
  const nicheNames = new Map<string, string>();
  let recycled = 0;

  for (const cand of candidates) {
    if (recycled >= MAX_RECYCLES_PER_RUN) break;
    if (!isRecyclable(cand.published_at, cand.engagement_rate, cand.niche_avg, cand.sample_size, now)) continue;

    const claimed = await claimEvent({
      kind: "recycle", subjectId: cand.publish_job_id,
      nicheId: cand.niche_id, pageId: cand.page_id,
      title: `♻ Recycled "${cand.topic_title}" (${(cand.engagement_rate * 100).toFixed(1)}% eng)`,
      payload: { engagementRate: cand.engagement_rate, nicheAvg: cand.niche_avg },
    });
    if (!claimed) continue;

    try {
      if (!nicheNames.has(cand.niche_id)) {
        const n = await query(`SELECT name FROM niches WHERE id = $1`, [cand.niche_id]);
        nicheNames.set(cand.niche_id, n.rows[0]?.name ?? "content");
      }
      const payload = cand.payload ?? {};
      const fresh = await regenerateCaption(payload.caption ?? "", payload.hook ?? "", nicheNames.get(cand.niche_id)!);
      if (!fresh) {
        await annotateEvent("recycle", cand.publish_job_id, { skipped: "caption regeneration unavailable" });
        continue; // claim kept — this winner is consumed, next winner recycles tomorrow
      }
      const existing = await listScheduledTimesForPage(cand.page_id);
      const slot = nextAvailableSlot(existing);
      const formattedCaption = formatCaption({
        platform: cand.platform as PublishPlatform,
        hook: payload.hook ?? "",
        caption: fresh,
        hashtags: payload.hashtags ?? [],
      });
      await scheduleContentBatch([{
        contentItemId: cand.content_item_id, pageId: cand.page_id,
        platform: cand.platform, scheduledAt: slot, formattedCaption,
      }]);
      recycled += 1;
    } catch (err: any) {
      console.warn(`[recycler] recycle failed for job ${cand.publish_job_id}: ${err?.message}`);
      await annotateEvent("recycle", cand.publish_job_id, { error: err?.message ?? "unknown" });
    }
  }
  return recycled;
}
```

NOTE on the once-a-day guard: `recycleRanRecently()` returns true if ANY
recycle event exists in the last 20h — including `skipped`-annotated ones, so
a day with only failed regens still counts as "ran". Deliberate: retry
tomorrow, never hammer the LLM hourly.

- [ ] **Step 2: Wire after the reactor**

In the analyze worker's automation block, after `runReactor()`:

```ts
      const { runRecycler } = await import("../services/automation/recycler.js");
      const recycled = await runRecycler();
      if (recycled > 0) console.log(`[analyze] Recycled ${recycled} winner(s)`);
```

(inside the same try/catch as the reactor, or its own — its own is cleaner:)

```ts
    try {
      const { runRecycler } = await import("../services/automation/recycler.js");
      const recycled = await runRecycler();
      if (recycled > 0) console.log(`[analyze] Recycled ${recycled} winner(s)`);
    } catch (err: any) {
      console.warn(`[analyze] recycler failed: ${err?.message}`);
    }
```

- [ ] **Step 3: Gates + commit**

```bash
git add -A
git commit -m "feat(automation): evergreen recycler — winners re-queued with regenerated captions"
```

---

### Task 5: Trend alerts + score worker wiring

**Files:**
- Create: `src/services/automation/trendAlerts.ts`
- Modify: `src/worker/index.ts` (score worker, end)

- [ ] **Step 1: Service**

Create `src/services/automation/trendAlerts.ts`:

```ts
import { isTrendSpike } from "../../domain/automation.js";
import type { Topic } from "../../domain/types.js";
import { claimEvent } from "./eventsRepo.js";

/** Detect source-velocity spikes among just-scored topics; one alert per
 *  topic ever (UNIQUE claim). Returns the number of new alerts. */
export async function detectTrendSpikes(topics: Topic[], now: Date = new Date()): Promise<number> {
  let alerts = 0;
  for (const topic of topics) {
    if (!isTrendSpike(topic.sourceCount, topic.firstSeenAt, topic.lastSeenAt, topic.velocity, now)) continue;
    const hours = Math.max(1, Math.round((topic.lastSeenAt.getTime() - topic.firstSeenAt.getTime()) / 3_600_000));
    const claimed = await claimEvent({
      kind: "trend_alert", subjectId: topic.id,
      nicheId: topic.nicheId,
      title: `🔥 Trending: "${topic.title}" (${topic.sourceCount} sources in ${hours}h)`,
      payload: { sourceCount: topic.sourceCount, velocity: topic.velocity },
    });
    if (claimed) alerts += 1;
  }
  return alerts;
}
```

- [ ] **Step 2: Wire at the end of the score worker**

In `src/worker/index.ts` score worker, after the scoring loop completes, add
(inside the worker function, `topics` is already in scope):

```ts
    try {
      const { detectTrendSpikes } = await import("../services/automation/trendAlerts.js");
      const alerts = await detectTrendSpikes(topics);
      if (alerts > 0) console.log(`[score] ${alerts} trend alert(s)`);
    } catch (err: any) {
      console.warn(`[score] trend alert detection failed: ${err?.message}`);
    }
```

- [ ] **Step 3: Gates + commit**

```bash
git add -A
git commit -m "feat(automation): trend-spike alerts at the end of each score run"
```

---

### Task 6: Alerts API + bell UI

**Files:**
- Modify: `src/api/server.ts` (two routes)
- Modify: `src/web/lib/api.ts`
- Create: `src/web/components/layout/AlertsBell.tsx`
- Modify: `src/web/components/layout/Sidebar.tsx` (mount the bell)

- [ ] **Step 1: API routes**

In `src/api/server.ts`, next to the other GET routes (match the file's
error-handling style):

```ts
app.get("/api/alerts", async (req, res, next) => {
  try {
    const { listEvents } = await import("../services/automation/eventsRepo.js");
    const limit = Math.min(100, Number(req.query.limit) || 30);
    res.json(await listEvents(limit));
  } catch (err) { next(err); }
});

app.post("/api/alerts/seen", async (_req, res, next) => {
  try {
    const { markAllSeen } = await import("../services/automation/eventsRepo.js");
    await markAllSeen();
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Client methods**

In `src/web/lib/api.ts`, next to getLearning:

```ts
  getAlerts: () => req<{ events: any[]; unseen: number }>(`/alerts`),
  markAlertsSeen: () => req<{ ok: boolean }>(`/alerts/seen`, { method: "POST" }),
```

(Check how other POSTs in this file pass options — match exactly.)

- [ ] **Step 3: AlertsBell component**

READ `src/web/components/layout/Sidebar.tsx` first for its structure/styling
idioms (CSS vars, class names). Create
`src/web/components/layout/AlertsBell.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../../lib/api';

type FeedEvent = {
  id: string;
  kind: 'cross_post' | 'fast_track' | 'recycle' | 'trend_alert';
  title: string;
  createdAt: string;
  seenAt: string | null;
};

function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const AlertsBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [unseen, setUnseen] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = () => {
    api.getAlerts().then((d) => { setEvents(d.events); setUnseen(d.unseen); }).catch(() => {});
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unseen > 0) {
      api.markAlertsSeen().then(() => setUnseen(0)).catch(() => {});
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-ghost" onClick={toggle} title="Automation activity"
        style={{ position: 'relative', padding: 8 }}>
        <Bell size={16} />
        {unseen > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 14, height: 14,
            borderRadius: 7, background: 'var(--accent)', color: '#fff',
            fontSize: 9, fontWeight: 700, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '0 3px',
          }}>{unseen > 9 ? '9+' : unseen}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', bottom: '110%', left: 0, width: 300, maxHeight: 360,
          overflowY: 'auto', background: 'var(--bg-elevated)', borderRadius: 10,
          border: '1px solid var(--border, rgba(128,128,128,0.25))',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)', zIndex: 50, padding: 8,
        }}>
          <div style={{ fontWeight: 700, fontSize: 12, padding: '4px 8px' }}>Automation activity</div>
          {events.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Nothing yet — cross-posts, recycles, and trend alerts appear here.
            </div>
          ) : events.map((e) => (
            <div key={e.id} style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6,
              background: e.seenAt ? 'transparent' : 'color-mix(in oklab, var(--accent) 8%, transparent)' }}>
              <div>{e.title}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{timeAgo(e.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

(Adapt dropdown position — `bottom: 110%` assumes the bell sits near the
Sidebar's bottom; if you mount it near the top, use `top: 110%`. Judge from
the Sidebar's real layout. `lucide-react` is already a dependency.)

- [ ] **Step 4: Mount in the Sidebar**

Read `Sidebar.tsx`; add `<AlertsBell />` in a sensible fixed spot (e.g. next
to the settings/footer area). Keep layout intact.

- [ ] **Step 5: Gates + build + commit**

`npx vitest run` + `npx tsc --noEmit` + `npm run build` (then
`git checkout -- dist-web`).

```bash
git add -A
git commit -m "feat(automation): alerts API + activity-feed bell in sidebar"
```

---

### Task 7: E2E dry-run verification + docs

**Files:** `docs/ARCHITECTURE.md`; verification only otherwise.

- [ ] **Step 1: Drive each rule live (docker Postgres + API + worker running)**

Start `npx tsx src/api/server.ts` and `npx tsx src/worker/index.ts` in the
background (logs to the scratchpad dir).

1. **Reactor:** pick a published job with a 1h metric; make it a winner:
   `UPDATE performance_metrics SET engagement_rate = 0.5, captured_at = now() WHERE capture_point='1h' AND publish_job_id='<id>';`
   (ensure ≥3 total 1h rows exist in the niche; insert extras with modest
   rates if needed, attached to other published jobs). POST /api/jobs/analyze.
   Verify: `SELECT kind, title FROM automation_events;` shows cross_post
   (if a sibling page exists) and/or fast_track rows; a new `scheduled`
   publish_job exists for the sibling page/content.
2. **Recycler:** backdate a winner:
   `UPDATE publish_jobs SET published_at = now() - interval '35 days' WHERE id='<winner id>';`
   ensure its 24h metric beats the niche average ×1.5. POST /api/jobs/analyze
   again. Verify a `recycle` event + new scheduled job with a DIFFERENT
   formatted_caption (LLM-regenerated; if no LLM key reachable, the event's
   payload records `skipped` — verify that path instead and report which).
3. **Trend alerts:** create a fresh multi-source topic:
   `UPDATE topics SET source_count = 4, first_seen_at = now() - interval '3 hours', last_seen_at = now() - interval '1 hour', state='IDEA' WHERE id = (SELECT id FROM topics WHERE state='SCORED' LIMIT 1);`
   POST /api/jobs/score. Verify a `trend_alert` event.
4. **API/UI:** `curl -s localhost:4000/api/alerts | python3 -m json.tool | head -30`
   → events + unseen count; `curl -s -X POST localhost:4000/api/alerts/seen`
   → ok; re-GET → unseen 0.
5. Idempotency: repeat steps 1–3 (re-POST the jobs) → event counts UNCHANGED
   (claims prevent re-firing), no duplicate publish_jobs.
6. Clean up: kill processes; `git checkout -- dist-web` if dirtied. Leave the
   test events (dev data) unless they pollute — your judgment; report.

- [ ] **Step 2: Docs**

`docs/ARCHITECTURE.md`: add a module section "10. Growth automation" (or next
free number): reactor (cross-post/fast-track on 1h overperformance ≥1.5×
niche avg, min 3 samples), recycler (30-day cooldown winners, caption
regenerated via LLM, ≤3/day), trend alerts (≥3 sources in first 6h or
velocity ≥0.8 fresh), automation_events ledger (claim-once idempotency),
alerts API + bell. Add `GET /api/alerts` + `POST /api/alerts/seen` to the
endpoints table. Also add both routes to `docs/API.md`.

- [ ] **Step 3: Final gates + commit**

`npx vitest run` (115) + `npx tsc --noEmit` + `npm run build` + double
`npm run db:init`.

```bash
git add -A
git commit -m "feat: growth automation live — reactor, recycler, trend alerts, activity feed"
```
