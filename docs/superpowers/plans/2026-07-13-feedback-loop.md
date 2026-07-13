# Real Feedback Loop Implementation Plan (Sprint A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake analytics loop with a real one: publish_jobs → provider-based metrics capture (simulated now, Instagram Insights when live) → learning_signals → bounded scoring/format feedback → AnalyticsView.

**Architecture:** Consolidate the two parallel publish pipelines onto `publish_jobs` (drop `posts`). An hourly `analyze` worker captures 1h/24h/7d metric snapshots per published job via a `MetricsProvider` interface, folds 24h snapshots into `learning_signals` (EMA), and `scoreTopic` applies a clamped ±10% learned boost. Spec: `docs/superpowers/specs/2026-07-13-feedback-loop-design.md`.

**Tech Stack:** TypeScript ESM (`.js` import suffixes!), Express 5, BullMQ, pg (raw SQL in `src/services/repositories.ts`), vitest, React 19.

**Conventions:**
- All imports of local files use `.js` extension (ESM): `import { x } from "./y.js"`.
- Run tests with `npx vitest run <file>`; full suite `npm test`; type-check `npx tsc -p tsconfig.json --noEmit`.
- DB is throwaway dev data — destructive schema changes are fine.
- Commit after every task.

---

### Task 1: Schema migration

**Files:**
- Modify: `src/db/schema.sql` (end of file)
- Modify: `src/domain/types.ts:18`

- [ ] **Step 1: Append Sprint A migrations to schema.sql**

Add at the end of `src/db/schema.sql`:

```sql
-- ── Sprint A: Real feedback loop ──────────────────────────────────────────────
-- publish_jobs is now the only publish record. posts is dropped (dev data is
-- throwaway). performance_metrics is rebuilt keyed on publish_jobs with
-- capture points and provenance.

DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS performance_metrics CASCADE;

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
ALTER TABLE topics ADD CONSTRAINT topics_format_confidence_check
  CHECK (format_confidence IN ('user', 'llm', 'rule', 'page_default', 'learned'));
```

Note: the inline `CHECK` on the `format_confidence` column created in the
`CREATE TABLE topics` statement (schema.sql:39) and the duplicate in the
`ALTER TABLE topics ADD COLUMN IF NOT EXISTS format_confidence` migration
(schema.sql:46) get an unnamed auto constraint on fresh databases. Update both
of those inline lists to include `'learned'` as well, so fresh installs match:
in both places change `IN ('user', 'llm', 'rule', 'page_default')` to
`IN ('user', 'llm', 'rule', 'page_default', 'learned')`.

- [ ] **Step 2: Add 'learned' to FormatConfidence type**

In `src/domain/types.ts` line 18, change:

```ts
export type FormatConfidence = "user" | "llm" | "rule" | "page_default";
```

to:

```ts
export type FormatConfidence = "user" | "llm" | "rule" | "page_default" | "learned";
```

- [ ] **Step 3: Apply schema and verify**

Run: `npm run db:init`
Expected: exits 0. Then verify:
`docker compose exec -T postgres psql -U postgres -d tpce -c "\d performance_metrics" 2>/dev/null || psql "$DATABASE_URL" -c "\d performance_metrics"`
(check `docker-compose.yml` / `.env` for the actual db name/user if this fails)
Expected: table with `publish_job_id`, `capture_point`, `source`, `learned_at` columns; `posts` table gone (`\d posts` errors).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.sql src/domain/types.ts
git commit -m "feat(schema): rebuild performance_metrics on publish_jobs, drop posts, add learned format confidence"
```

---

### Task 2: Metrics types + SimulatedProvider (TDD)

**Files:**
- Create: `src/services/metrics/types.ts`
- Create: `src/services/metrics/simulatedProvider.ts`
- Test: `tests/simulatedProvider.test.ts`

- [ ] **Step 1: Create the shared types**

Create `src/services/metrics/types.ts`:

```ts
export type CapturePoint = "1h" | "24h" | "7d";
export type MetricsSource = "simulated" | "instagram";

export interface MetricSnapshot {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  follows: number;
}

/** Everything a provider needs to know about a published job. */
export interface PublishedJobContext {
  jobId: string;
  pageId: string;
  platform: string;
  externalPostId: string | null;
  publishedAt: Date;
  dryRun: boolean;
  contentType: "post" | "carousel" | "reel";
  hook: string;
}

export interface MetricsProvider {
  readonly source: MetricsSource;
  /** Returns null when metrics are unavailable (retry next run). */
  fetchMetrics(job: PublishedJobContext, point: CapturePoint): Promise<MetricSnapshot | null>;
}

/** Engagement rate = interactions / reach. Single definition used everywhere. */
export function engagementRate(m: MetricSnapshot): number {
  return m.reach > 0 ? (m.likes + m.comments + m.saves + m.shares) / m.reach : 0;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/simulatedProvider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SimulatedMetricsProvider } from "../src/services/metrics/simulatedProvider.js";
import { engagementRate, type PublishedJobContext } from "../src/services/metrics/types.js";

const job = (overrides: Partial<PublishedJobContext> = {}): PublishedJobContext => ({
  jobId: "11111111-1111-1111-1111-111111111111",
  pageId: "p1",
  platform: "instagram",
  externalPostId: null,
  publishedAt: new Date("2026-07-10T18:00:00Z"),
  dryRun: true,
  contentType: "reel",
  hook: "5 mistakes that are costing you followers",
  ...overrides,
});

describe("SimulatedMetricsProvider", () => {
  const provider = new SimulatedMetricsProvider();

  it("is deterministic: same job + point → identical snapshot", async () => {
    const a = await provider.fetchMetrics(job(), "24h");
    const b = await provider.fetchMetrics(job(), "24h");
    expect(a).toEqual(b);
  });

  it("different jobs produce different snapshots", async () => {
    const a = await provider.fetchMetrics(job(), "24h");
    const b = await provider.fetchMetrics(job({ jobId: "22222222-2222-2222-2222-222222222222" }), "24h");
    expect(a).not.toEqual(b);
  });

  it("grows across capture points: 1h < 24h < 7d reach", async () => {
    const h1 = await provider.fetchMetrics(job(), "1h");
    const h24 = await provider.fetchMetrics(job(), "24h");
    const d7 = await provider.fetchMetrics(job(), "7d");
    expect(h1!.reach).toBeLessThan(h24!.reach);
    expect(h24!.reach).toBeLessThan(d7!.reach);
  });

  it("produces sane engagement rates (0.5%–15%)", async () => {
    const snap = await provider.fetchMetrics(job(), "24h");
    const er = engagementRate(snap!);
    expect(er).toBeGreaterThan(0.005);
    expect(er).toBeLessThan(0.15);
  });

  it("interaction parts sum to <= reach and are non-negative", async () => {
    const s = (await provider.fetchMetrics(job(), "24h"))!;
    for (const v of Object.values(s)) expect(v).toBeGreaterThanOrEqual(0);
    expect(s.likes + s.comments + s.saves + s.shares).toBeLessThanOrEqual(s.reach);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/simulatedProvider.test.ts`
Expected: FAIL — cannot resolve `simulatedProvider.js`.

- [ ] **Step 4: Implement the provider**

Create `src/services/metrics/simulatedProvider.ts`:

```ts
import { scoreHook } from "../../domain/scoring.js";
import type { CapturePoint, MetricSnapshot, MetricsProvider, PublishedJobContext } from "./types.js";

/** Deterministic simulated metrics, shaped by content features so the
 *  learning loop is testable end-to-end before real Instagram data exists. */

const GROWTH: Record<CapturePoint, number> = { "1h": 0.15, "24h": 1.0, "7d": 1.6 };
const FORMAT_MULT: Record<string, number> = { reel: 1.6, carousel: 1.2, post: 1.0 };

/** FNV-1a 32-bit string hash. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SimulatedMetricsProvider implements MetricsProvider {
  readonly source = "simulated" as const;

  async fetchMetrics(job: PublishedJobContext, point: CapturePoint): Promise<MetricSnapshot> {
    const rand = mulberry32(hashString(`${job.jobId}:${point}`));
    const hookQuality = scoreHook(job.hook || "generic post").score; // ~0.5–0.9
    const fmt = FORMAT_MULT[job.contentType] ?? 1.0;
    const hour = job.publishedAt.getUTCHours();
    const hourMult = hour >= 17 && hour <= 22 ? 1.25 : hour >= 11 && hour <= 14 ? 1.1 : 0.9;

    const base = 400 + rand() * 1600;
    const reach = Math.max(50, Math.round(base * fmt * hourMult * GROWTH[point] * (0.6 + hookQuality)));
    const views = Math.round(reach * (1.1 + rand() * 0.5));

    // Target ER 2–8% driven mostly by hook quality, with small noise.
    const er = 0.02 + hookQuality * 0.06 + (rand() - 0.5) * 0.01;
    const interactions = Math.max(1, Math.round(reach * er));
    const likes = Math.round(interactions * 0.7);
    const comments = Math.round(interactions * 0.08);
    const saves = Math.round(interactions * 0.15);
    const shares = Math.max(0, interactions - likes - comments - saves);
    const follows = Math.round(interactions * 0.03 * rand());

    return { views, reach, likes, comments, saves, shares, follows };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/simulatedProvider.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/services/metrics/types.ts src/services/metrics/simulatedProvider.ts tests/simulatedProvider.test.ts
git commit -m "feat(metrics): MetricsProvider interface + deterministic simulated provider"
```

---

### Task 3: Capture-due logic (TDD)

**Files:**
- Create: `src/services/metrics/capture.ts`
- Test: `tests/capture.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/capture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dueCapturePoints } from "../src/services/metrics/capture.js";

const at = (iso: string) => new Date(iso);

describe("dueCapturePoints", () => {
  const published = at("2026-07-10T12:00:00Z");

  it("nothing due immediately after publish", () => {
    expect(dueCapturePoints(published, [], at("2026-07-10T12:30:00Z"))).toEqual([]);
  });

  it("1h due after an hour", () => {
    expect(dueCapturePoints(published, [], at("2026-07-10T13:05:00Z"))).toEqual(["1h"]);
  });

  it("skips already-captured points", () => {
    expect(dueCapturePoints(published, ["1h"], at("2026-07-10T14:00:00Z"))).toEqual([]);
  });

  it("catches up multiple missed points", () => {
    expect(dueCapturePoints(published, [], at("2026-07-12T12:00:00Z"))).toEqual(["1h", "24h"]);
  });

  it("all three due after a week", () => {
    expect(dueCapturePoints(published, [], at("2026-07-17T13:00:00Z"))).toEqual(["1h", "24h", "7d"]);
  });

  it("abandons points past cutoff (7d + 24h)", () => {
    expect(dueCapturePoints(published, [], at("2026-07-19T12:00:00Z"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capture.test.ts`
Expected: FAIL — cannot resolve `capture.js`.

- [ ] **Step 3: Implement**

Create `src/services/metrics/capture.ts`:

```ts
import type { CapturePoint } from "./types.js";

const HOUR = 3_600_000;
export const POINT_MS: Record<CapturePoint, number> = {
  "1h": HOUR,
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
};

/** After this age, uncaptured points are abandoned (silently). */
export const CAPTURE_CUTOFF_MS = POINT_MS["7d"] + 24 * HOUR;

const ORDER: CapturePoint[] = ["1h", "24h", "7d"];

/** Which capture points are due for a job published at `publishedAt`,
 *  given the points already captured. Past-cutoff jobs return []. */
export function dueCapturePoints(
  publishedAt: Date,
  captured: CapturePoint[],
  now: Date = new Date()
): CapturePoint[] {
  const age = now.getTime() - publishedAt.getTime();
  if (age > CAPTURE_CUTOFF_MS) return [];
  return ORDER.filter((p) => age >= POINT_MS[p] && !captured.includes(p));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capture.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/metrics/capture.ts tests/capture.test.ts
git commit -m "feat(metrics): capture-point due logic with 7d+24h cutoff"
```

---

### Task 4: InstagramInsightsProvider (TDD on parsing)

**Files:**
- Create: `src/services/metrics/instagramProvider.ts`
- Test: `tests/instagramProvider.test.ts`

Instagram metric names are API-version-dependent (`views` superseded
`impressions`; `saved` not `saves`). We request a primary metric set and fall
back on unknown-metric errors. The response parser is the unit-testable core.

- [ ] **Step 1: Write the failing test**

Create `tests/instagramProvider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseInsightsResponse } from "../src/services/metrics/instagramProvider.js";

describe("parseInsightsResponse", () => {
  it("maps IG metric names onto MetricSnapshot (saved→saves, views)", () => {
    const snap = parseInsightsResponse([
      { name: "views", values: [{ value: 1200 }] },
      { name: "reach", values: [{ value: 900 }] },
      { name: "likes", values: [{ value: 80 }] },
      { name: "comments", values: [{ value: 5 }] },
      { name: "saved", values: [{ value: 12 }] },
      { name: "shares", values: [{ value: 7 }] },
      { name: "follows", values: [{ value: 3 }] },
    ]);
    expect(snap).toEqual({ views: 1200, reach: 900, likes: 80, comments: 5, saves: 12, shares: 7, follows: 3 });
  });

  it("maps impressions→views on fallback responses; missing metrics → 0", () => {
    const snap = parseInsightsResponse([
      { name: "impressions", values: [{ value: 500 }] },
      { name: "reach", values: [{ value: 400 }] },
    ]);
    expect(snap.views).toBe(500);
    expect(snap.likes).toBe(0);
    expect(snap.follows).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instagramProvider.test.ts`
Expected: FAIL — cannot resolve `instagramProvider.js`.

- [ ] **Step 3: Implement**

Create `src/services/metrics/instagramProvider.ts`:

```ts
import { getToken } from "../instagram.js";
import type { CapturePoint, MetricSnapshot, MetricsProvider, PublishedJobContext } from "./types.js";

const GRAPH = "https://graph.instagram.com/v21.0";
// Primary uses `views` (current consumption metric); fallback covers older
// API versions that only know `impressions`.
const PRIMARY_METRICS = ["views", "reach", "likes", "comments", "saved", "shares", "follows"];
const FALLBACK_METRICS = ["impressions", "reach", "likes", "comments", "saved", "shares"];

interface InsightEntry { name: string; values: Array<{ value: number }> }

export function parseInsightsResponse(data: InsightEntry[]): MetricSnapshot {
  const get = (name: string) => data.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
  return {
    views: get("views") || get("impressions"),
    reach: get("reach"),
    likes: get("likes"),
    comments: get("comments"),
    saves: get("saved"),
    shares: get("shares"),
    follows: get("follows"),
  };
}

export class InstagramInsightsProvider implements MetricsProvider {
  readonly source = "instagram" as const;

  async fetchMetrics(job: PublishedJobContext, _point: CapturePoint): Promise<MetricSnapshot | null> {
    if (!job.externalPostId) return null;
    const token = await getToken(job.pageId);
    if (!token?.access_token) return null;

    const fetchWith = (metrics: string[]) =>
      fetch(`${GRAPH}/${job.externalPostId}/insights?metric=${metrics.join(",")}&access_token=${token.access_token}`);

    try {
      let res = await fetchWith(PRIMARY_METRICS);
      if (!res.ok) {
        const body = await res.text();
        // Unknown-metric error (code 100) → retry with legacy metric names.
        if (/#100|does not support|invalid metric|must be one of/i.test(body)) {
          res = await fetchWith(FALLBACK_METRICS);
        } else {
          console.warn(`[metrics] IG insights ${res.status} for job ${job.jobId}: ${body.slice(0, 200)}`);
          return null;
        }
      }
      if (!res.ok) {
        console.warn(`[metrics] IG insights fallback failed for job ${job.jobId}: ${await res.text().then((t) => t.slice(0, 200))}`);
        return null;
      }
      const json = (await res.json()) as { data?: InsightEntry[] };
      if (!json.data) return null;
      return parseInsightsResponse(json.data);
    } catch (err: any) {
      console.warn(`[metrics] IG insights fetch error for job ${job.jobId}: ${err?.message}`);
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instagramProvider.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/metrics/instagramProvider.ts tests/instagramProvider.test.ts
git commit -m "feat(metrics): Instagram Insights provider with views/impressions fallback"
```

---

### Task 5: Learning pure functions (TDD)

**Files:**
- Create: `src/domain/learning.ts`
- Test: `tests/learning.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/learning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ema, snapshotSignals, learnedBoost, type LearnedSignals } from "../src/domain/learning.js";

describe("ema", () => {
  it("first observation returns the value itself", () => {
    expect(ema(null, 0.05)).toBe(0.05);
  });
  it("blends with alpha=0.3", () => {
    expect(ema(0.10, 0.20)).toBeCloseTo(0.3 * 0.20 + 0.7 * 0.10, 10);
  });
});

describe("snapshotSignals", () => {
  it("emits one keyword signal per unique lowercased keyword + one format signal", () => {
    const sigs = snapshotSignals(["AI", "ai", "Fintech"], "reel", 0.04);
    expect(sigs).toEqual([
      { signalType: "keyword", label: "ai", engagementRate: 0.04 },
      { signalType: "keyword", label: "fintech", engagementRate: 0.04 },
      { signalType: "format", label: "reel", engagementRate: 0.04 },
    ]);
  });
});

describe("learnedBoost", () => {
  const learned = (entries: Array<[string, number, number]>, nicheAvg: number): LearnedSignals => ({
    keywordScores: new Map(entries.map(([k, score, sampleSize]) => [k, { score, sampleSize }])),
    nicheAvg,
  });

  it("returns 1.0 with no learned data", () => {
    expect(learnedBoost(["ai"], undefined)).toBe(1.0);
  });

  it("returns 1.0 when no keywords match", () => {
    expect(learnedBoost(["crypto"], learned([["ai", 0.08, 10]], 0.04))).toBe(1.0);
  });

  it("ignores signals with sample_size < 3", () => {
    expect(learnedBoost(["ai"], learned([["ai", 0.08, 2]], 0.04))).toBe(1.0);
  });

  it("boosts above-average keywords, clamped at 1.10", () => {
    // ratio 2.0 → 1 + (2-1)*0.5 = 1.5 → clamped to 1.10
    expect(learnedBoost(["ai"], learned([["ai", 0.08, 5]], 0.04))).toBe(1.10);
  });

  it("penalizes below-average keywords, clamped at 0.90", () => {
    // ratio 0.25 → 1 + (0.25-1)*0.5 = 0.625 → clamped to 0.90
    expect(learnedBoost(["ai"], learned([["ai", 0.01, 5]], 0.04))).toBe(0.90);
  });

  it("average keywords → ~1.0", () => {
    expect(learnedBoost(["ai"], learned([["ai", 0.04, 5]], 0.04))).toBeCloseTo(1.0, 10);
  });

  it("matches case-insensitively", () => {
    expect(learnedBoost(["AI"], learned([["ai", 0.08, 5]], 0.04))).toBe(1.10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/learning.test.ts`
Expected: FAIL — cannot resolve `learning.js`.

- [ ] **Step 3: Implement**

Create `src/domain/learning.ts`:

```ts
/** Pure learning-loop math: EMA aggregation and the bounded scoring boost.
 *  DB plumbing lives in services; this file must stay dependency-free. */

export const EMA_ALPHA = 0.3;
export const MIN_KEYWORD_SAMPLES = 3;
export const MIN_FORMAT_SAMPLES = 5;
export const BOOST_MIN = 0.90;
export const BOOST_MAX = 1.10;

export function ema(prev: number | null, value: number, alpha = EMA_ALPHA): number {
  return prev === null ? value : alpha * value + (1 - alpha) * prev;
}

export interface SignalUpdate {
  signalType: "keyword" | "format";
  label: string;
  engagementRate: number;
}

/** Signals produced by one 24h metric snapshot. */
export function snapshotSignals(
  keywords: string[],
  contentType: string,
  engagementRate: number
): SignalUpdate[] {
  const unique = [...new Set(keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))];
  return [
    ...unique.map((label) => ({ signalType: "keyword" as const, label, engagementRate })),
    { signalType: "format" as const, label: contentType, engagementRate },
  ];
}

export interface LearnedSignals {
  keywordScores: Map<string, { score: number; sampleSize: number }>;
  /** Mean score across all keyword signals for the niche. */
  nicheAvg: number;
}

/** Bounded multiplier from learned keyword performance.
 *  ratio 1.0 (average) → 1.0; each 10% above/below average moves ±5%,
 *  clamped to [0.90, 1.10]. Signals need >= MIN_KEYWORD_SAMPLES to count. */
export function learnedBoost(keywords: string[], learned?: LearnedSignals): number {
  if (!learned || learned.nicheAvg <= 0) return 1.0;
  const matched = keywords
    .map((k) => learned.keywordScores.get(k.toLowerCase().trim()))
    .filter((s): s is { score: number; sampleSize: number } => !!s && s.sampleSize >= MIN_KEYWORD_SAMPLES);
  if (matched.length === 0) return 1.0;
  const mean = matched.reduce((sum, m) => sum + m.score, 0) / matched.length;
  const ratio = mean / learned.nicheAvg;
  return Math.min(BOOST_MAX, Math.max(BOOST_MIN, 1 + (ratio - 1) * 0.5));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/learning.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/domain/learning.ts tests/learning.test.ts
git commit -m "feat(learning): EMA, snapshot signals, and bounded learned boost (pure)"
```

---

### Task 6: scoreTopic learned integration (TDD)

**Files:**
- Modify: `src/domain/scoring.ts:72-141` (`scoreTopic`)
- Test: `tests/scoring.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/scoring.test.ts` (keep existing imports; add `learnedBoost`-related import):

```ts
import type { LearnedSignals } from "../src/domain/learning.js";

// ── Sprint A: learned boost integration ──────────────────────────────────────
describe("scoreTopic learned boost", () => {
  // Reuse this file's existing niche/topic fixture helpers if present; else:
  const niche = {
    id: "n1", name: "Tech", keywords: ["ai", "startups"],
    monetizationKeywords: ["saas"], negativeKeywords: [], targetPersona: "founders",
  } as any;
  const topic = {
    id: "t1", nicheId: "n1", title: "AI startups raising in 2026",
    keywords: ["ai", "startups"], sources: ["hackernews"], sourceCount: 2,
    firstSeenAt: new Date(), lastSeenAt: new Date(), velocity: 0.5,
    score: null, decision: null, state: "IDEA",
    suggestedFormat: null, formatConfidence: null,
  } as any;

  const learned: LearnedSignals = {
    keywordScores: new Map([["ai", { score: 0.09, sampleSize: 5 }]]),
    nicheAvg: 0.03,
  };

  it("applies the boost and records it in the breakdown", () => {
    const base = scoreTopic(topic, niche, []);
    const boosted = scoreTopic(topic, niche, [], learned);
    expect(boosted.learnedBoost).toBe(1.10);
    expect(boosted.score).toBeCloseTo(Math.min(1, base.score * 1.10), 10);
  });

  it("learnedBoost is 1.0 when no learned data passed", () => {
    expect(scoreTopic(topic, niche, []).learnedBoost).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scoring.test.ts`
Expected: FAIL — `learnedBoost` not a property of the breakdown / wrong arity.

- [ ] **Step 3: Implement in scoring.ts**

In `src/domain/scoring.ts`:

1. Add import at top:
```ts
import { learnedBoost, type LearnedSignals } from "./learning.js";
```

2. Add `learnedBoost: number;` to `TopicScoreBreakdown` (after `novelty`).

3. Change the `scoreTopic` signature to:
```ts
export function scoreTopic(
  topic: Topic,
  niche: Niche,
  recentTitles: string[],
  learned?: LearnedSignals
): TopicScoreBreakdown {
```

4. In the early-return hard-discard branch (zero keyword overlap), add
`learnedBoost: 1.0,` to the returned object.

5. Replace the seasonal-multiplier block:
```ts
const seasonal = seasonalScoreMultiplier(`${topic.title} ${topic.keywords.join(" ")}`);
const score = clamp01(rawScore * seasonal);
```
with:
```ts
const seasonal = seasonalScoreMultiplier(`${topic.title} ${topic.keywords.join(" ")}`);
const boost = learnedBoost(topic.keywords, learned);
const score = clamp01(rawScore * seasonal * boost);
```

6. Add `learnedBoost: boost,` to the final returned breakdown object.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/scoring.test.ts`
Expected: all pass (old tests unaffected — new param optional).

- [ ] **Step 5: Commit**

```bash
git add src/domain/scoring.ts tests/scoring.test.ts
git commit -m "feat(scoring): optional learned-keyword boost in scoreTopic, recorded in breakdown"
```

---

### Task 7: Learned format tiebreak (TDD)

**Files:**
- Modify: `src/domain/format-rules.ts` (append function)
- Test: `tests/format-rules.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/format-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyLearnedFormat } from "../src/domain/format-rules.js";

const signals = (entries: Array<[string, number, number]>) =>
  entries.map(([label, score, sampleSize]) => ({ label, score, sampleSize }));

describe("applyLearnedFormat", () => {
  it("never overrides user or llm decisions", () => {
    const s = signals([["reel", 0.09, 10]]);
    expect(applyLearnedFormat("post", "user", s)).toEqual({ format: "post", confidence: "user" });
    expect(applyLearnedFormat("post", "llm", s)).toEqual({ format: "post", confidence: "llm" });
  });

  it("overrides weak (rule/page_default) decisions with the learned winner", () => {
    const s = signals([["reel", 0.09, 6], ["post", 0.02, 8]]);
    expect(applyLearnedFormat("post", "rule", s)).toEqual({ format: "reel", confidence: "learned" });
    expect(applyLearnedFormat("post", "page_default", s)).toEqual({ format: "reel", confidence: "learned" });
  });

  it("requires sample_size >= 5 on the winner", () => {
    const s = signals([["reel", 0.09, 4]]);
    expect(applyLearnedFormat("post", "rule", s)).toEqual({ format: "post", confidence: "rule" });
  });

  it("keeps original confidence when learned winner matches current format", () => {
    const s = signals([["post", 0.09, 8]]);
    expect(applyLearnedFormat("post", "rule", s)).toEqual({ format: "post", confidence: "rule" });
  });

  it("no signals → unchanged", () => {
    expect(applyLearnedFormat("carousel", "rule", [])).toEqual({ format: "carousel", confidence: "rule" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/format-rules.test.ts`
Expected: FAIL — `applyLearnedFormat` is not exported.

- [ ] **Step 3: Implement**

Append to `src/domain/format-rules.ts`:

```ts
import { MIN_FORMAT_SAMPLES } from "./learning.js";
import type { FormatConfidence } from "./types.js";
// (move both imports to the top of the file with the existing import)

export interface FormatSignal { label: string; score: number; sampleSize: number }

/** Learned tiebreak: when the niche has a proven winning format
 *  (sample_size >= MIN_FORMAT_SAMPLES), it overrides weak decisions
 *  (rule / page_default). Explicit user and LLM decisions always win. */
export function applyLearnedFormat(
  current: SuggestedFormat,
  confidence: FormatConfidence,
  formatSignals: FormatSignal[]
): { format: SuggestedFormat; confidence: FormatConfidence } {
  if (confidence === "user" || confidence === "llm") return { format: current, confidence };
  const eligible = formatSignals.filter((s) => s.sampleSize >= MIN_FORMAT_SAMPLES);
  if (eligible.length === 0) return { format: current, confidence };
  const winner = [...eligible].sort((a, b) => b.score - a.score)[0];
  if (winner.label === current) return { format: current, confidence };
  return { format: winner.label as SuggestedFormat, confidence: "learned" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/format-rules.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/domain/format-rules.ts tests/format-rules.test.ts
git commit -m "feat(format): learned format tiebreak for weak rule/page_default decisions"
```

---

### Task 8: Metrics & learning repositories

**Files:**
- Create: `src/services/metrics/metricsRepo.ts`
- Create: `src/services/learningRepo.ts`

Raw-SQL plumbing (no unit tests — exercised by the integration check in Task 14;
keep functions thin so all logic stays in the tested pure modules).

- [ ] **Step 1: Create metricsRepo.ts**

Create `src/services/metrics/metricsRepo.ts`:

```ts
import { query } from "../../db/pool.js";
import type { CapturePoint, MetricSnapshot, MetricsSource } from "./types.js";
import { engagementRate } from "./types.js";
import { CAPTURE_CUTOFF_MS } from "./capture.js";

export interface CaptureCandidate {
  jobId: string;
  pageId: string;
  platform: string;
  externalPostId: string | null;
  publishedAt: Date;
  dryRun: boolean;
  contentType: "post" | "carousel" | "reel";
  hook: string;
  captured: CapturePoint[];
}

/** Published jobs still inside the capture window, with their captured points. */
export async function listCaptureCandidates(): Promise<CaptureCandidate[]> {
  const result = await query(
    `
      SELECT pj.id, pj.page_id, pj.platform, pj.external_post_id, pj.published_at,
             pj.dry_run, c.type, c.payload->>'hook' AS hook,
             COALESCE(array_agg(pm.capture_point) FILTER (WHERE pm.capture_point IS NOT NULL), '{}') AS captured
      FROM publish_jobs pj
      JOIN content_items c ON c.id = pj.content_item_id
      LEFT JOIN performance_metrics pm ON pm.publish_job_id = pj.id
      WHERE pj.status = 'published'
        AND pj.published_at > now() - ($1 || ' milliseconds')::interval
      GROUP BY pj.id, c.type, c.payload
    `,
    [String(CAPTURE_CUTOFF_MS)]
  );
  return result.rows.map((row: any) => ({
    jobId: row.id,
    pageId: row.page_id,
    platform: row.platform,
    externalPostId: row.external_post_id,
    publishedAt: new Date(row.published_at),
    dryRun: row.dry_run,
    contentType: row.type,
    hook: row.hook ?? "",
    captured: row.captured as CapturePoint[],
  }));
}

/** Idempotent snapshot insert (UNIQUE(publish_job_id, capture_point)). */
export async function insertMetricSnapshot(
  publishJobId: string,
  point: CapturePoint,
  source: MetricsSource,
  snap: MetricSnapshot
): Promise<void> {
  await query(
    `
      INSERT INTO performance_metrics
        (publish_job_id, capture_point, source, views, reach, likes, comments, saves, shares, follows, engagement_rate)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (publish_job_id, capture_point) DO NOTHING
    `,
    [publishJobId, point, source, snap.views, snap.reach, snap.likes, snap.comments,
     snap.saves, snap.shares, snap.follows, engagementRate(snap)]
  );
}
```

- [ ] **Step 2: Create learningRepo.ts**

Create `src/services/learningRepo.ts`:

```ts
import { query } from "../db/pool.js";
import { EMA_ALPHA, type LearnedSignals, type SignalUpdate } from "../domain/learning.js";
import type { FormatSignal } from "../domain/format-rules.js";

export interface UnlearnedSnapshot {
  id: string;
  nicheId: string;
  source: "simulated" | "instagram";
  engagementRate: number;
  keywords: string[];
  contentType: string;
  capturedAt: Date;
}

/** 24h snapshots not yet folded into learning_signals, with topic context. */
export async function listUnlearnedDailySnapshots(): Promise<UnlearnedSnapshot[]> {
  const result = await query(
    `
      SELECT pm.id, pm.source, pm.engagement_rate, pm.captured_at,
             t.keywords, t.niche_id, c.type
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE pm.capture_point = '24h' AND pm.learned_at IS NULL
      ORDER BY pm.captured_at ASC
    `
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    nicheId: row.niche_id,
    source: row.source,
    engagementRate: Number(row.engagement_rate),
    keywords: row.keywords ?? [],
    contentType: row.type,
    capturedAt: new Date(row.captured_at),
  }));
}

/** Has this niche already folded any REAL (instagram) snapshot into signals? */
export async function nicheHasLearnedRealRows(nicheId: string): Promise<boolean> {
  const result = await query(
    `
      SELECT 1 FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE t.niche_id = $1 AND pm.source = 'instagram'
        AND pm.capture_point = '24h' AND pm.learned_at IS NOT NULL
      LIMIT 1
    `,
    [nicheId]
  );
  return result.rows.length > 0;
}

export async function deleteSignalsForNiche(nicheId: string): Promise<void> {
  await query(`DELETE FROM learning_signals WHERE niche_id = $1`, [nicheId]);
}

/** EMA upsert — first sample takes the raw value, later samples blend. */
export async function upsertLearningSignal(nicheId: string, sig: SignalUpdate): Promise<void> {
  await query(
    `
      INSERT INTO learning_signals (niche_id, signal_type, label, score, sample_size, updated_at)
      VALUES ($1, $2, $3, $4, 1, now())
      ON CONFLICT (niche_id, signal_type, label)
      DO UPDATE SET
        score = $5 * EXCLUDED.score + (1 - $5) * learning_signals.score,
        sample_size = learning_signals.sample_size + 1,
        updated_at = now()
    `,
    [nicheId, sig.signalType, sig.label, sig.engagementRate, EMA_ALPHA]
  );
}

export async function markSnapshotsLearned(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await query(`UPDATE performance_metrics SET learned_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
}

/** Learned signals for scoring: keyword map + niche average. */
export async function getLearnedSignals(nicheId: string): Promise<LearnedSignals | undefined> {
  const result = await query(
    `SELECT label, score, sample_size FROM learning_signals
     WHERE niche_id = $1 AND signal_type = 'keyword'`,
    [nicheId]
  );
  if (result.rows.length === 0) return undefined;
  const keywordScores = new Map<string, { score: number; sampleSize: number }>(
    result.rows.map((r: any) => [r.label, { score: Number(r.score), sampleSize: Number(r.sample_size) }])
  );
  const nicheAvg =
    result.rows.reduce((s: number, r: any) => s + Number(r.score), 0) / result.rows.length;
  return { keywordScores, nicheAvg };
}

/** Format win-rate signals for the learned format tiebreak. */
export async function getFormatSignals(nicheId: string): Promise<FormatSignal[]> {
  const result = await query(
    `SELECT label, score, sample_size FROM learning_signals
     WHERE niche_id = $1 AND signal_type = 'format'`,
    [nicheId]
  );
  return result.rows.map((r: any) => ({
    label: r.label, score: Number(r.score), sampleSize: Number(r.sample_size),
  }));
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/metrics/metricsRepo.ts src/services/learningRepo.ts
git commit -m "feat(metrics): snapshot + learning signal repositories"
```

---

### Task 9: Learning service (fold + source discipline)

**Files:**
- Create: `src/services/learningService.ts`

- [ ] **Step 1: Create learningService.ts**

```ts
import { snapshotSignals } from "../domain/learning.js";
import {
  deleteSignalsForNiche,
  listUnlearnedDailySnapshots,
  markSnapshotsLearned,
  nicheHasLearnedRealRows,
  upsertLearningSignal,
  type UnlearnedSnapshot,
} from "./learningRepo.js";

async function foldSnapshot(row: UnlearnedSnapshot): Promise<void> {
  for (const sig of snapshotSignals(row.keywords, row.contentType, row.engagementRate)) {
    await upsertLearningSignal(row.nicheId, sig);
  }
  await markSnapshotsLearned([row.id]);
}

/** Folds unlearned 24h snapshots into learning_signals.
 *
 *  Source discipline: a niche learns from real (instagram) rows once any
 *  exist; before that, from simulated rows. The first real row triggers a
 *  rebuild — simulated history is discarded and signals recomputed from
 *  real rows only. */
export async function runLearningStep(): Promise<void> {
  const rows = await listUnlearnedDailySnapshots();
  if (rows.length === 0) return;

  const byNiche = new Map<string, UnlearnedSnapshot[]>();
  for (const row of rows) {
    const list = byNiche.get(row.nicheId) ?? [];
    list.push(row);
    byNiche.set(row.nicheId, list);
  }

  for (const [nicheId, nicheRows] of byNiche) {
    const hasRealHistory = await nicheHasLearnedRealRows(nicheId);
    const realRows = nicheRows.filter((r) => r.source === "instagram");

    if (!hasRealHistory && realRows.length > 0) {
      // First real data for this niche: drop simulated-built signals, replay real only.
      console.log(`[learn] First real metrics for niche ${nicheId} — rebuilding signals from real data`);
      await deleteSignalsForNiche(nicheId);
      await markSnapshotsLearned(nicheRows.filter((r) => r.source === "simulated").map((r) => r.id));
      for (const row of realRows) await foldSnapshot(row);
      continue;
    }

    const mode: UnlearnedSnapshot["source"] = hasRealHistory ? "instagram" : "simulated";
    for (const row of nicheRows) {
      if (row.source === mode) await foldSnapshot(row);
      else await markSnapshotsLearned([row.id]); // off-mode rows: consumed, not folded
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/learningService.ts
git commit -m "feat(learning): fold service with simulated→real source discipline"
```

---

### Task 10: Publish consolidation — schedule path

**Files:**
- Modify: `src/services/platformFormatter.ts:1-17` (add youtube_shorts)
- Modify: `src/services/repositories.ts:189-222` (rewire, delete createPost)
- Modify: `src/worker/index.ts:229-240` (schedule worker)

- [ ] **Step 1: Add youtube_shorts to the platform formatter**

In `src/services/platformFormatter.ts`:

```ts
export type PublishPlatform = 'instagram' | 'linkedin' | 'twitter' | 'reddit' | 'facebook' | 'youtube_shorts';
```

Add to `LIMITS`:
```ts
  youtube_shorts: { caption: 5000, maxHashtags: 15 },
```

Add to `PLATFORM_META`:
```ts
  youtube_shorts: { label: 'YouTube Shorts', icon: '▶️', color: '#FF0000' },
```

(No formatter branch needed — the default hook+caption+hashtags path applies.)

- [ ] **Step 2: Rewire repositories to publish_jobs**

In `src/services/repositories.ts` replace `listApprovedContentWithoutPost`
(lines 189–202), `listScheduledTimesForPage` (204–210), and DELETE
`createPost` (212–222) entirely:

```ts
export async function listApprovedContentWithoutJob(): Promise<any[]> {
  const result = await query(
    `
      SELECT c.*, p.platform, p.id AS page_id
      FROM content_items c
      JOIN pages p ON p.id = c.page_id
      WHERE c.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM publish_jobs pj WHERE pj.content_item_id = c.id)
      ORDER BY c.updated_at ASC
      LIMIT 50
    `
  );
  return result.rows;
}

export async function listScheduledTimesForPage(pageId: string): Promise<Date[]> {
  const result = await query(
    `SELECT scheduled_at FROM publish_jobs
     WHERE page_id = $1 AND status = 'scheduled' AND scheduled_at IS NOT NULL`,
    [pageId]
  );
  return result.rows.map((row: any) => new Date(row.scheduled_at));
}
```

- [ ] **Step 3: Rewrite the schedule worker**

In `src/worker/index.ts`, replace the `schedule` worker (lines 229–240) with:

```ts
new Worker(
  "schedule",
  async () => {
    const { formatCaption } = await import("../services/platformFormatter.js");
    const approved = await listApprovedContentWithoutJob();
    for (const item of approved) {
      const existing = await listScheduledTimesForPage(item.page_id);
      const slot = nextAvailableSlot(existing);
      const payload = item.payload ?? {};
      const formattedCaption = formatCaption({
        platform: item.platform,
        hook: payload.hook ?? "",
        caption: payload.caption ?? "",
        hashtags: payload.hashtags ?? [],
      });
      await scheduleContentBatch([{
        contentItemId: item.id,
        pageId: item.page_id,
        platform: item.platform,
        scheduledAt: slot,
        formattedCaption,
      }]);
    }
  },
  workerOptions
);
```

Update the imports at the top of `src/worker/index.ts`: remove `createPost`
and `listApprovedContentWithoutPost`; add `listApprovedContentWithoutJob` and
`scheduleContentBatch`.

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: errors ONLY in places later tasks fix (post/analyze workers,
server.ts `/api/posts`, `dashboardStats`, `listAnalyticsForPage` may still
reference deleted symbols — if so, proceed; Task 11–13 clean them up).
If `createPost` errors appear beyond those files, fix the stragglers.

- [ ] **Step 5: Commit**

```bash
git add src/services/platformFormatter.ts src/services/repositories.ts src/worker/index.ts
git commit -m "feat(publish): schedule worker creates publish_jobs; drop createPost path"
```

---

### Task 11: Publish consolidation — post worker + shared input builder

**Files:**
- Modify: `src/services/platforms/publisher.ts` (add builder + due-jobs publisher + dry_run recording)
- Modify: `src/api/server.ts:1292-1315` (publish-now uses builder)
- Modify: `src/worker/index.ts:242-257` (post worker)
- Delete: `src/services/platforms/posting.ts`
- Modify: `src/services/repositories.ts` (delete `listPosts`, `markPostPosted`, `insertMetric`)
- Modify: `src/api/server.ts` (delete `GET /api/posts` route and `listPosts` import)

- [ ] **Step 1: Add shared builder + due publisher to publisher.ts**

Append to `src/services/platforms/publisher.ts`:

```ts
/** Row shape: publish_jobs joined to content_items (page_id, payload). */
export function buildPublishJobInput(job: {
  id: string; content_item_id: string; page_id: string;
  platform: string; formatted_caption: string | null;
  payload: any;
}): PublishJobInput {
  const payload = job.payload ?? {};
  const images: string[] = (payload.images ?? [])
    .map((img: any) => img?.url ?? img)
    .filter(Boolean);
  return {
    jobId: job.id,
    contentItemId: job.content_item_id,
    pageId: job.page_id,
    platform: job.platform as PublishPlatform,
    formattedCaption: job.formatted_caption ?? "",
    imageUrls: images,
    hook: payload.hook ?? "",
  };
}

/** Publish every scheduled job whose time has come. */
export async function publishDueJobs(dryRun: boolean): Promise<number> {
  const { rows } = await query(
    `SELECT pj.id, pj.content_item_id, pj.page_id, pj.platform, pj.formatted_caption, c.payload
     FROM publish_jobs pj
     JOIN content_items c ON c.id = pj.content_item_id
     WHERE pj.status = 'scheduled' AND pj.scheduled_at <= now()
     ORDER BY pj.scheduled_at ASC
     LIMIT 25`
  );
  for (const job of rows) {
    await dispatchPublishJob(buildPublishJobInput(job), dryRun);
  }
  return rows.length;
}
```

Also record `dry_run` at publish time — change `markPublishing` to:

```ts
async function markPublishing(jobId: string, dryRun: boolean) {
  await query(
    `UPDATE publish_jobs SET status='publishing', dry_run=$2, updated_at=now() WHERE id=$1`,
    [jobId, dryRun]
  );
}
```

and its call in `dispatchPublishJob` to `await markPublishing(input.jobId, dryRun);`.

Note: `publishToInstagram` uses `graph.instagram.com` media publish; only
non-dry-run jobs reach it, so `dry_run=false` rows are exactly the ones the
Instagram insights provider may poll. The `youtube_shorts` platform added in
Task 10 must get a case in `dispatchPublishJob`'s switch:

```ts
      case 'youtube_shorts': throw new Error('YouTube Shorts live publishing not implemented — dry-run only');
```

- [ ] **Step 2: Rewire the publish-now endpoint**

In `src/api/server.ts` (PATCH `/api/publish-jobs/:id`, `publish-now` branch,
lines ~1292–1315), replace the inline `jobInput` construction with:

```ts
    if (body.action === 'publish-now') {
      const { rows } = await query(
        `SELECT pj.id, pj.content_item_id, pj.page_id, pj.platform, pj.formatted_caption, c.payload
         FROM publish_jobs pj
         JOIN content_items c ON c.id = pj.content_item_id
         WHERE pj.id = $1`,
        [id]
      );
      if (!rows[0]) return void res.status(404).json({ error: 'Job not found' });
      const { dispatchPublishJob, buildPublishJobInput } = await import('../services/platforms/publisher.js');
      dispatchPublishJob(buildPublishJobInput(rows[0]), env.POSTING_DRY_RUN).catch(() => {});
      return void res.json({ ok: true });
    }
```

- [ ] **Step 3: Rewrite the post worker**

In `src/worker/index.ts`, replace the `post` worker (lines 242–257) with:

```ts
new Worker(
  "post",
  async () => {
    const { publishDueJobs } = await import("../services/platforms/publisher.js");
    const published = await publishDueJobs(env.POSTING_DRY_RUN);
    if (published > 0) console.log(`[post] Published ${published} due job(s)`);
  },
  workerOptions
);
```

Remove the now-unused imports in `src/worker/index.ts`: `publishPost`,
`listPosts`, `markPostPosted` (leave `insertMetric` removal to Task 12 if the
analyze worker still references it — Task 12 rewrites it anyway; if you're
doing tasks in order, remove `insertMetric` import in Task 12).

- [ ] **Step 4: Delete the legacy path**

```bash
rm src/services/platforms/posting.ts
```

In `src/services/repositories.ts` delete the functions `listPosts` (lines
224–239) and `markPostPosted` (241–246). In `src/api/server.ts` delete the
`GET /api/posts` route and remove `listPosts` from the repositories import.

- [ ] **Step 5: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: remaining errors only in the analyze worker / `insertMetric` /
`dashboardStats` / `listAnalyticsForPage` (Tasks 12–13). Anything else: fix now.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(publish): post worker publishes due publish_jobs; delete legacy posts path"
```

---

### Task 12: Analyze worker rewrite

**Files:**
- Create: `src/services/metrics/index.ts` (provider selection + capture run)
- Modify: `src/worker/index.ts:259-273` (analyze worker)
- Modify: `src/services/repositories.ts` (delete `insertMetric`, lines 248–258)

- [ ] **Step 1: Create the capture orchestrator**

Create `src/services/metrics/index.ts`:

```ts
import { dueCapturePoints } from "./capture.js";
import { InstagramInsightsProvider } from "./instagramProvider.js";
import { listCaptureCandidates, insertMetricSnapshot, type CaptureCandidate } from "./metricsRepo.js";
import { SimulatedMetricsProvider } from "./simulatedProvider.js";
import type { MetricsProvider, PublishedJobContext } from "./types.js";

const simulated = new SimulatedMetricsProvider();
const instagram = new InstagramInsightsProvider();

/** Real insights only for live (non-dry-run) Instagram posts with an external id. */
export function selectProvider(job: CaptureCandidate): MetricsProvider {
  if (job.platform === "instagram" && !job.dryRun && job.externalPostId) return instagram;
  return simulated;
}

/** One capture pass: insert every due snapshot. Returns count inserted. */
export async function runMetricsCapture(now = new Date()): Promise<number> {
  const candidates = await listCaptureCandidates();
  let captured = 0;
  for (const job of candidates) {
    const due = dueCapturePoints(job.publishedAt, job.captured, now);
    if (due.length === 0) continue;
    const provider = selectProvider(job);
    const ctx: PublishedJobContext = {
      jobId: job.jobId,
      pageId: job.pageId,
      platform: job.platform,
      externalPostId: job.externalPostId,
      publishedAt: job.publishedAt,
      dryRun: job.dryRun,
      contentType: job.contentType,
      hook: job.hook,
    };
    for (const point of due) {
      const snap = await provider.fetchMetrics(ctx, point);
      if (!snap) continue; // unavailable → retried next run until cutoff
      await insertMetricSnapshot(job.jobId, point, provider.source, snap);
      captured += 1;
    }
  }
  return captured;
}
```

- [ ] **Step 2: Rewrite the analyze worker**

In `src/worker/index.ts`, replace the `analyze` worker (the `Math.random`
block) with:

```ts
new Worker(
  "analyze",
  async () => {
    const { runMetricsCapture } = await import("../services/metrics/index.js");
    const { runLearningStep } = await import("../services/learningService.js");
    const captured = await runMetricsCapture();
    if (captured > 0) console.log(`[analyze] Captured ${captured} metric snapshot(s)`);
    await runLearningStep();
  },
  workerOptions
);
```

Remove `insertMetric` from the repositories import in `src/worker/index.ts`,
and delete the `insertMetric` function from `src/services/repositories.ts`
(lines 248–258).

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: remaining errors only in `dashboardStats` / `listAnalyticsForPage`
(Task 13). Anything else: fix now.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(metrics): analyze worker captures real/simulated snapshots + runs learning"
```

---

### Task 13: Score/generate worker wiring + stats/analytics/API rewrite

**Files:**
- Modify: `src/worker/index.ts:60-104` (score + generate workers)
- Modify: `src/services/repositories.ts` (`dashboardStats`, `listAnalyticsForPage`)
- Modify: `src/api/server.ts` (learning endpoint)
- Modify: `src/web/lib/api.ts` (client)

- [ ] **Step 1: Wire learned signals into the score worker**

In `src/worker/index.ts`, replace the `score` worker with:

```ts
new Worker(
  "score",
  async () => {
    const { getLearnedSignals } = await import("../services/learningRepo.js");
    const topics = await listScorableTopics();
    const learnedCache = new Map<string, Awaited<ReturnType<typeof getLearnedSignals>>>();
    for (const topic of topics) {
      const niche = await getNiche(topic.nicheId);
      if (!niche) continue;
      if (!learnedCache.has(topic.nicheId)) {
        learnedCache.set(topic.nicheId, await getLearnedSignals(topic.nicheId));
      }
      const recentTitles = await listRecentTopicTitles(topic.nicheId, topic.id);
      const breakdown = scoreTopic(topic, niche, recentTitles, learnedCache.get(topic.nicheId));
      await updateTopicScore(topic.id, breakdown.score, breakdown.decision, breakdown);
    }
  },
  workerOptions
);
```

- [ ] **Step 2: Wire learned format tiebreak into the generate worker**

In the `generate` worker in `src/worker/index.ts`, after the existing
`page_default` fallback block (`if (!finalFormat || finalConfidence === 'page_default') {...}`)
and BEFORE `await updateTopicFormat(...)`, insert:

```ts
      // Learned tiebreak: proven niche format overrides weak decisions
      if (finalFormat && finalConfidence && (finalConfidence === 'rule' || finalConfidence === 'page_default')) {
        const { getFormatSignals } = await import("../services/learningRepo.js");
        const { applyLearnedFormat } = await import("../domain/format-rules.js");
        const learned = applyLearnedFormat(finalFormat, finalConfidence, await getFormatSignals(topic.nicheId));
        finalFormat = learned.format;
        finalConfidence = learned.confidence;
      }
```

- [ ] **Step 3: Rewrite dashboardStats**

In `src/services/repositories.ts` `dashboardStats`, replace the three
posts-based UNION branches and the nextPost query:

- `'scheduled'` branch → `FROM publish_jobs WHERE status = 'scheduled' AND ($2::uuid IS NULL OR page_id = $2)`
- `'posted'` branch → `FROM publish_jobs WHERE status = 'published' AND ($2::uuid IS NULL OR page_id = $2)`
- `'posted_today'` branch → `FROM publish_jobs WHERE status = 'published' AND published_at >= current_date AND ($2::uuid IS NULL OR page_id = $2)`
- nextPost query →
```sql
SELECT scheduled_at FROM publish_jobs
WHERE status = 'scheduled' AND scheduled_at > now()
  AND ($1::uuid IS NULL OR page_id = $1)
ORDER BY scheduled_at ASC LIMIT 1
```

- [ ] **Step 4: Rewrite listAnalyticsForPage**

Replace the whole function body in `src/services/repositories.ts`:

```ts
export async function listAnalyticsForPage(pageId: string): Promise<any> {
  const postsResult = await query(
    `
      SELECT
        pj.id,
        pj.published_at AS posted_at,
        pj.status,
        c.type,
        t.title AS topic_title,
        COALESCE(m24.views, m1.views, 0)::int   AS views,
        COALESCE(m24.reach, m1.reach, 0)::int   AS reach,
        COALESCE(m24.saves, m1.saves, 0)::int   AS saves,
        COALESCE(m7.views, 0)::int              AS views_7d,
        COALESCE(m24.engagement_rate, m1.engagement_rate, 0)::numeric(6,4) AS engagement_rate,
        COALESCE(m24.source, m1.source)         AS metric_source
      FROM publish_jobs pj
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      LEFT JOIN performance_metrics m1  ON m1.publish_job_id  = pj.id AND m1.capture_point  = '1h'
      LEFT JOIN performance_metrics m24 ON m24.publish_job_id = pj.id AND m24.capture_point = '24h'
      LEFT JOIN performance_metrics m7  ON m7.publish_job_id  = pj.id AND m7.capture_point  = '7d'
      WHERE pj.page_id = $1 AND pj.status = 'published'
      ORDER BY pj.published_at DESC
      LIMIT 30
    `,
    [pageId]
  );

  const typeResult = await query(
    `
      SELECT c.type, count(DISTINCT pj.id)::int AS total,
             COALESCE(avg(pm.engagement_rate), 0)::numeric(5,4) AS avg_engagement
      FROM publish_jobs pj
      JOIN content_items c ON c.id = pj.content_item_id
      LEFT JOIN performance_metrics pm
        ON pm.publish_job_id = pj.id AND pm.capture_point = '24h'
      WHERE pj.page_id = $1 AND pj.status = 'published'
      GROUP BY c.type
    `,
    [pageId]
  );

  const simulated = postsResult.rows.some((r: any) => r.metric_source === "simulated");
  return { posts: postsResult.rows, byType: typeResult.rows, simulated };
}
```

- [ ] **Step 5: Add the learning endpoint**

In `src/api/server.ts`, next to the analytics route (line ~438), add:

```ts
app.get("/api/pages/:id/learning", async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT niche_id FROM pages WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return void res.status(404).json({ error: "Page not found" });
    const nicheId = rows[0].niche_id;
    const signals = await query(
      `SELECT signal_type, label, score::float, sample_size, updated_at
       FROM learning_signals WHERE niche_id = $1
       ORDER BY signal_type, score DESC`,
      [nicheId]
    );
    const real = await query(
      `SELECT 1 FROM performance_metrics pm
       JOIN publish_jobs pj ON pj.id = pm.publish_job_id
       JOIN content_items c ON c.id = pj.content_item_id
       JOIN topics t ON t.id = c.topic_id
       WHERE t.niche_id = $1 AND pm.source = 'instagram' LIMIT 1`,
      [nicheId]
    );
    res.json({
      keywords: signals.rows.filter((r: any) => r.signal_type === "keyword").slice(0, 10),
      formats: signals.rows.filter((r: any) => r.signal_type === "format"),
      mode: real.rows.length > 0 ? "real" : "simulated",
    });
  } catch (err) { next(err); }
});
```

- [ ] **Step 6: Add the API client method**

In `src/web/lib/api.ts`, next to `getAnalytics` (line 41), add:

```ts
  getLearning: (pageId: string) => req<any>(`/pages/${pageId}/learning`),
```

- [ ] **Step 7: Type-check + full test suite**

Run: `npx tsc -p tsconfig.json --noEmit && npm test`
Expected: clean compile; all tests pass. No more references to the `posts`
table anywhere: `grep -rn "FROM posts\|INTO posts\|UPDATE posts" src` → empty.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(loop): learned signals wired into score/generate workers, stats+analytics on publish_jobs, learning endpoint"
```

---

### Task 14: UI — AnalyticsView learning section, simulated banner, TopicCard badge

**Files:**
- Modify: `src/web/views/AnalyticsView.tsx`
- Modify: `src/web/components/dashboard/TopicCard.tsx:130-145`
- Modify: `src/web/lib/types.ts` (Topic type)
- Modify: `src/db/mappers.ts` (`mapTopic`)
- Modify: `src/domain/types.ts` (Topic interface)

- [ ] **Step 1: Expose scoreBreakdown on topics**

In `src/domain/types.ts`, add to the `Topic` interface (near `score`):

```ts
  scoreBreakdown?: Record<string, number> | null;
```

In `src/db/mappers.ts` `mapTopic`, add:

```ts
    scoreBreakdown: row.score_breakdown ?? null,
```

In `src/web/lib/types.ts`, add to the web `Topic` type (near `score`):

```ts
  scoreBreakdown?: { learnedBoost?: number } | null;
```

Verify the topics API returns `score_breakdown` through `mapTopic` (it stores
via `updateTopicScore`; if the topics list endpoint selects `*`, the column
flows through). If the endpoint hand-picks columns, add `score_breakdown`.

- [ ] **Step 2: TopicCard boosted badge**

In `src/web/components/dashboard/TopicCard.tsx`, near the `ScoreRing`
(line ~138), add after it:

```tsx
          {topic.scoreBreakdown?.learnedBoost && topic.scoreBreakdown.learnedBoost !== 1 && (
            <span
              className="badge badge-green"
              title={`Learning boost ×${Number(topic.scoreBreakdown.learnedBoost).toFixed(2)} from past performance`}
              style={{ fontSize: 9, padding: '1px 5px' }}
            >
              {topic.scoreBreakdown.learnedBoost > 1 ? '▲ boosted' : '▼ damped'}
            </span>
          )}
```

- [ ] **Step 3: AnalyticsView — banner + learning section**

In `src/web/views/AnalyticsView.tsx`:

1. Extend the data types at the top:

```ts
type AnalyticsData = { posts: Post[]; byType: ByType[]; simulated?: boolean };
type LearningData = {
  keywords: Array<{ label: string; score: number; sample_size: number }>;
  formats: Array<{ label: string; score: number; sample_size: number }>;
  mode: 'real' | 'simulated';
};
```

2. Add state + fetch alongside the existing analytics fetch in the
`useEffect`:

```ts
  const [learning, setLearning] = useState<LearningData | null>(null);
  // inside useEffect, after the getAnalytics call:
  api.getLearning(page.id).then(setLearning).catch(() => setLearning(null));
```

3. Directly under the KPI row `</div>` (after line ~136), add the banner:

```tsx
            {data.simulated && (
              <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px dashed var(--text-muted)',
                fontSize: 12, color: 'var(--text-secondary)' }}>
                ⚗️ Simulated metrics — Instagram is in dry-run mode. Real insights replace
                these automatically once publishing goes live.
              </div>
            )}
```

4. Inside `analytics-grid`, add a new card after the "Content Type
Performance" card:

```tsx
              {/* Learned signals */}
              <div className="analytics-card">
                <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Learning Signals</div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:12 }}>
                  {learning?.mode === 'real' ? 'From real Instagram data' : 'From simulated data'}
                </div>
                {!learning || learning.keywords.length === 0 ? (
                  <div style={{ color:'var(--text-muted)', fontSize:12 }}>
                    No signals yet — appears after posts collect 24h metrics
                  </div>
                ) : (
                  learning.keywords.map(k => {
                    const maxScore = Math.max(...learning.keywords.map(x => x.score), 0.001);
                    return (
                      <div key={k.label} className="perf-row">
                        <div style={{ width:90, fontSize:12, color:'var(--text-secondary)',
                          flexShrink:0, overflow:'hidden', textOverflow:'ellipsis',
                          whiteSpace:'nowrap' }}>{k.label}</div>
                        <div className="perf-bar">
                          <div className="perf-fill"
                            style={{ width:`${Math.round((k.score/maxScore)*100)}%`, background:'var(--purple)' }}/>
                        </div>
                        <div style={{ width:48, textAlign:'right', fontSize:11,
                          fontFamily:'var(--mono)' }}>{(k.score*100).toFixed(1)}%</div>
                        <div style={{ width:24, textAlign:'right', fontSize:10,
                          color:'var(--text-muted)' }}>×{k.sample_size}</div>
                      </div>
                    );
                  })
                )}
              </div>
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: clean type-check + vite build.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): learning signals card, simulated-data banner, learned-boost topic badge"
```

---

### Task 15: End-to-end verification (dry-run loop)

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm test && npm run build`
Expected: all tests pass, build clean.

- [ ] **Step 2: No posts-table stragglers**

Run: `grep -rn "FROM posts\|INTO posts\|UPDATE posts\|listPosts\|createPost\|markPostPosted\|insertMetric\b" src/`
Expected: no matches.

- [ ] **Step 3: Boot the stack and drive the loop**

```bash
npm run infra:up && npm run db:init && npm run seed
npm run dev
```

Then, in a second terminal, drive one cycle (endpoints from RUNBOOK/API docs;
`POST /api/jobs/<name>` triggers workers manually if exposed — check
`src/api/server.ts` for the exact job-trigger routes):

1. Create/approve a content item (via dashboard or existing seed + approve endpoint).
2. Trigger the schedule worker → verify `publish_jobs` row with status `scheduled`:
   `SELECT id, status, scheduled_at FROM publish_jobs ORDER BY created_at DESC LIMIT 3;`
3. Set the job due: `UPDATE publish_jobs SET scheduled_at = now() - interval '1 minute' WHERE status='scheduled';`
4. Trigger the post worker → job flips to `published` with a `stub-*` external id.
5. Backdate publish: `UPDATE publish_jobs SET published_at = now() - interval '25 hours' WHERE status='published';`
6. Trigger the analyze worker → verify:
   - `SELECT capture_point, source, engagement_rate FROM performance_metrics;` → 1h + 24h simulated rows
   - `SELECT signal_type, label, score, sample_size FROM learning_signals;` → keyword + format rows
7. Trigger the score worker → `SELECT title, score_breakdown->>'learnedBoost' FROM topics WHERE score IS NOT NULL LIMIT 5;` → boosts present (1.0 or ≠1.0).
8. Open the dashboard → Analytics view shows the simulated banner + Learning Signals card.

- [ ] **Step 4: Update docs**

Update `docs/ARCHITECTURE.md`: replace the "Feedback loop" section (item 9)
with a short description of the real loop (capture points, providers, source
discipline, bounded boost), and note that `posts` was replaced by
`publish_jobs`. Update the state-machine line if it references posts.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: close the real feedback loop — metrics capture, learning signals, bounded scoring boost

Replaces Math.random analytics with provider-based capture (simulated now,
Instagram Insights when live), folds 24h snapshots into learning_signals,
and feeds learned keyword/format performance back into scoring and format
suggestion. Consolidates publishing onto publish_jobs; drops posts."
```
