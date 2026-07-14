# Sprint B — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numbered DB migrations, embedding-based (blend-safe) topic relevance, keyword normalization, and test coverage for QA gates + caption formatter.

**Architecture:** A minimal migration runner (`src/db/migrate.ts` core + `scripts/migrate.ts` CLI) replaces boot-run schema.sql. A Gemini embedding provider (with deterministic offline fallback used ONLY in tests) caches vectors in `topics.embedding`/`niches.embedding` JSONB; the score worker builds a semantic context per run and passes `{nicheSimilarity, maxRecentSimilarity}` into `scoreTopic`, which blends it with keyword relevance (max, never lower) and uses it for novelty. `normalizeKeywords` guards every keyword write path. Spec: `docs/superpowers/specs/2026-07-14-foundations-design.md`.

**Tech Stack:** TypeScript ESM (`.js` import suffixes), pg raw SQL, vitest, Gemini `text-embedding-004` REST API.

**Conventions:** run tests `npx vitest run <file>`; full gates: `npx vitest run && npx tsc -p tsconfig.json --noEmit`. Commit after every task. Dev DB: docker compose Postgres on port 55432 (`DATABASE_URL` in .env).

---

### Task 1: Migration runner

**Files:**
- Create: `src/db/migrations/001_baseline.sql` (moved content)
- Create: `src/db/migrations/002_embeddings.sql`
- Create: `src/db/migrations/003_clean_keyword_signals.sql`
- Create: `src/db/migrate.ts`
- Create: `scripts/migrate.ts`
- Modify: `package.json` (db:init / db:migrate scripts)
- Modify: `scripts/dev-bootstrap.ts` (ensureSchema, ~lines 160-185)
- Delete: `scripts/init-db.ts`, `src/db/schema.sql`
- Test: `tests/migrate.test.ts`

- [ ] **Step 1: Write the failing test (pure ordering/pending logic)**

Create `tests/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pendingMigrations } from "../src/db/migrate.js";

describe("pendingMigrations", () => {
  const files = ["002_embeddings.sql", "001_baseline.sql", "003_clean.sql"];

  it("sorts by filename and filters out applied versions", () => {
    expect(pendingMigrations(files, ["001_baseline.sql"])).toEqual([
      "002_embeddings.sql",
      "003_clean.sql",
    ]);
  });

  it("returns all sorted when nothing applied", () => {
    expect(pendingMigrations(files, [])).toEqual([
      "001_baseline.sql", "002_embeddings.sql", "003_clean.sql",
    ]);
  });

  it("returns empty when all applied", () => {
    expect(pendingMigrations(files, [...files])).toEqual([]);
  });

  it("ignores non-sql files", () => {
    expect(pendingMigrations(["001_a.sql", "README.md", ".DS_Store"], [])).toEqual(["001_a.sql"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/migrate.test.ts`
Expected: FAIL — cannot resolve `../src/db/migrate.js`.

- [ ] **Step 3: Create the migration files**

`src/db/migrations/001_baseline.sql`: copy the ENTIRE current content of `src/db/schema.sql` unchanged (`cp src/db/schema.sql src/db/migrations/001_baseline.sql`). It is fully idempotent, so it converges on existing DBs and builds fresh ones.

`src/db/migrations/002_embeddings.sql`:
```sql
-- Sprint B: cached embedding vectors (JSONB float arrays, unit-normalized).
ALTER TABLE topics ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE niches ADD COLUMN IF NOT EXISTS embedding JSONB;
```

`src/db/migrations/003_clean_keyword_signals.sql`:
```sql
-- Sprint B: remove sentence-length keyword labels that predate normalizeKeywords.
DELETE FROM learning_signals WHERE signal_type = 'keyword' AND length(label) > 40;
```

- [ ] **Step 4: Implement the runner core**

Create `src/db/migrate.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "./pool.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** Pure: which .sql files still need applying, in filename order. */
export function pendingMigrations(files: string[], applied: string[]): string[] {
  const appliedSet = new Set(applied);
  return files
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !appliedSet.has(f));
}

/** Apply all pending migrations. Returns the filenames applied. */
export async function runMigrations(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const files = await fs.readdir(dir);
  const appliedResult = await pool.query(`SELECT version FROM schema_migrations`);
  const applied = appliedResult.rows.map((r: any) => r.version as string);
  const pending = pendingMigrations(files, applied);

  for (const file of pending) {
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
    });
    console.log(`[migrate] applied ${file}`);
  }
  if (pending.length === 0) console.log(`[migrate] up to date (${applied.length} applied)`);
  return pending;
}
```

Create `scripts/migrate.ts`:

```ts
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";

try {
  const applied = await runMigrations();
  console.log(`Migrations complete — ${applied.length} applied.`);
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
```

- [ ] **Step 5: Rewire package.json and dev-bootstrap; delete legacy**

`package.json`: change `"db:init": "tsx scripts/init-db.ts"` to `"db:init": "tsx scripts/migrate.ts"` and add `"db:migrate": "tsx scripts/migrate.ts"`.

`scripts/dev-bootstrap.ts` `ensureSchema()` (~lines 164-185): replace the schema.sql read/exec body with:

```ts
async function ensureSchema(): Promise<void> {
  log("📦 schema", "Applying schema migrations...");
  // Dynamic import to load dotenv/env before pg
  const { pool } = await import("../src/db/pool.js");
  const { runMigrations } = await import("../src/db/migrate.js");
  try {
    const applied = await runMigrations();
    log("📦 schema", applied.length > 0 ? `Applied ${applied.length} migration(s) ✓` : "Schema up to date ✓");
    await pool.end();
  } catch (error) {
    log("❌ error", `Schema migration failed: ${error}`);
    await pool.end();
    process.exit(1);
  }
}
```

Then: `git rm scripts/init-db.ts src/db/schema.sql` (schema.sql content now lives in 001_baseline.sql; grep first — `grep -rn "schema.sql" src scripts package.json` must show no remaining readers).

- [ ] **Step 6: Run tests + live migration**

Run: `npx vitest run tests/migrate.test.ts` → 4 passed.
Run: `npm run db:init` against the dev DB → expect `001_baseline.sql` applied (idempotent no-op effects), `002`, `003` applied, exit 0. Run AGAIN → "up to date". Verify:
`docker compose exec -T postgres psql -U theme -d theme_engine -c "SELECT version FROM schema_migrations ORDER BY version; \d topics"` → 3 rows; topics has `embedding` column.

- [ ] **Step 7: Full gates + commit**

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit`
```bash
git add -A
git commit -m "feat(db): numbered migration runner; schema.sql becomes 001_baseline"
```

---

### Task 2: Keyword normalizer + write-path wiring

**Files:**
- Create: `src/domain/keywords.ts`
- Modify: `src/services/repositories.ts` (`upsertRawTrend`, `createManualTopic`)
- Modify: `src/domain/learning.ts` (`snapshotSignals` guard)
- Test: `tests/keywords.test.ts`, `tests/learning.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Create `tests/keywords.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeKeywords, MAX_KEYWORD_CHARS, MAX_KEYWORDS } from "../src/domain/keywords.js";

describe("normalizeKeywords", () => {
  it("lowercases, trims, and strips edge punctuation", () => {
    expect(normalizeKeywords(["  AI, ", "«Fintech»", "web3!"])).toEqual(["ai", "fintech", "web3"]);
  });

  it("drops sentence-length entries (>40 chars or >4 words)", () => {
    expect(normalizeKeywords([
      "new updates to ai mode make it easier to dive deeper online",
      "one two three four five",
      "machine learning",
    ])).toEqual(["machine learning"]);
  });

  it("dedupes case-insensitively preserving first occurrence order", () => {
    expect(normalizeKeywords(["AI", "ai", "SaaS", "saas"])).toEqual(["ai", "saas"]);
  });

  it("caps at MAX_KEYWORDS", () => {
    const many = Array.from({ length: 15 }, (_, i) => `kw${i}`);
    expect(normalizeKeywords(many)).toHaveLength(MAX_KEYWORDS);
  });

  it("drops empties and collapses inner whitespace", () => {
    expect(normalizeKeywords(["", "  ", "personal   finance"])).toEqual(["personal finance"]);
  });

  it("exports sane constants", () => {
    expect(MAX_KEYWORD_CHARS).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/keywords.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/domain/keywords.ts`:

```ts
/** Keyword hygiene for every topic write path. Sentence-length "keywords"
 *  (from manual key-points entry) pollute scoring and learning_signals. */

export const MAX_KEYWORD_CHARS = 40;
export const MAX_KEYWORD_WORDS = 4;
export const MAX_KEYWORDS = 10;

export function normalizeKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const cleaned = entry
      .toLowerCase()
      .trim()
      .replace(/^[^\p{L}\p{N}#@]+|[^\p{L}\p{N}]+$/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;
    if (cleaned.length > MAX_KEYWORD_CHARS) continue;
    if (cleaned.split(" ").length > MAX_KEYWORD_WORDS) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}
```

Run: `npx vitest run tests/keywords.test.ts` → 6 passed.

- [ ] **Step 4: Wire write paths**

In `src/services/repositories.ts`:

1. Add import: `import { normalizeKeywords } from "../domain/keywords.js";`
2. `upsertRawTrend` — replace the keywords line:
```ts
const keywords = normalizeKeywords(rawTrend.keywords);
```
(replaces the existing lowercase/trim/dedupe Set expression — normalizeKeywords subsumes it).
3. `createManualTopic` — the bug: keywords are stored as `[keyPoints.trim()]` (one giant entry). Replace with keywordized + normalized keywords. Add import `import { keywordize } from "./ingestion/keywordize.js";` and change the params array entry from
```ts
keyPoints ? [keyPoints.trim()] : []
```
to
```ts
normalizeKeywords([...keywordize(title), ...(keyPoints ? keywordize(keyPoints) : [])])
```
(`keywordize(input, maxWords=8)` already exists at `src/services/ingestion/keywordize.ts:203` and extracts keyword phrases from free text.)

- [ ] **Step 5: snapshotSignals guard (TDD)**

Append to `tests/learning.test.ts` inside the `snapshotSignals` describe (or a new one):

```ts
  it("skips keyword labels longer than 40 chars (legacy sentence keywords)", () => {
    const long = "new updates to ai mode and overviews make it easier to dive deeper";
    const sigs = snapshotSignals([long, "ai"], "post", 0.05);
    expect(sigs).toEqual([
      { signalType: "keyword", label: "ai", engagementRate: 0.05 },
      { signalType: "format", label: "post", engagementRate: 0.05 },
    ]);
  });
```

Run → FAIL. Then in `src/domain/learning.ts` `snapshotSignals`, change the unique-keywords line to also drop long labels:

```ts
  const unique = [...new Set(keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))]
    .filter((k) => k.length <= 40);
```

(Use the literal 40 or import `MAX_KEYWORD_CHARS` from `./keywords.js` — prefer the import; learning.ts's "dependency-free" note refers to services/DB, a sibling domain import is fine. Update the file's top comment if needed.)

Run: `npx vitest run tests/learning.test.ts` → all pass (16).

- [ ] **Step 6: Full gates + commit**

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit` → all green.

```bash
git add -A
git commit -m "feat(keywords): normalizeKeywords on all topic write paths; fix manual keyPoints-as-keyword bug; guard learning signals"
```

---

### Task 3: Similarity math (pure)

**Files:**
- Create: `src/domain/similarity.ts`
- Test: `tests/similarity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/similarity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cosineSimilarity, normalizeCosine, COSINE_FLOOR, COSINE_CEIL } from "../src/domain/similarity.js";

describe("cosineSimilarity", () => {
  it("identical unit vectors → 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });
  it("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("empty or length-mismatched inputs → 0", () => {
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
  it("handles non-normalized inputs", () => {
    expect(cosineSimilarity([3, 0], [7, 0])).toBeCloseTo(1, 6);
  });
});

describe("normalizeCosine", () => {
  it("maps floor→0 and ceil→1, clamped", () => {
    expect(normalizeCosine(COSINE_FLOOR)).toBe(0);
    expect(normalizeCosine(COSINE_CEIL)).toBe(1);
    expect(normalizeCosine(0.2)).toBe(0);
    expect(normalizeCosine(0.99)).toBe(1);
  });
  it("maps midpoint linearly", () => {
    const mid = (COSINE_FLOOR + COSINE_CEIL) / 2;
    expect(normalizeCosine(mid)).toBeCloseTo(0.5, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/similarity.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `src/domain/similarity.ts`:

```ts
/** Cosine similarity + normalization for embedding-based relevance.
 *  Gemini text-embedding-004 cosines: unrelated text ≈0.4–0.55,
 *  strongly related ≈0.75+. Mapped to [0,1] for scoring. */

export const COSINE_FLOOR = 0.5;
export const COSINE_CEIL = 0.85;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Map a raw cosine onto [0,1] relevance, clamped. */
export function normalizeCosine(raw: number): number {
  return Math.max(0, Math.min(1, (raw - COSINE_FLOOR) / (COSINE_CEIL - COSINE_FLOOR)));
}
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run tests/similarity.test.ts` → 6 passed.

```bash
git add src/domain/similarity.ts tests/similarity.test.ts
git commit -m "feat(similarity): cosine + normalized relevance mapping"
```

---

### Task 4: scoreTopic semantic blend (TDD)

**Files:**
- Modify: `src/domain/scoring.ts` (`scoreTopic`, `TopicScoreBreakdown`)
- Test: `tests/scoring.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/scoring.test.ts` (reuse the existing `niche`/`topic` fixtures from the learned-boost describe, or redeclare locally):

```ts
// ── Sprint B: semantic blend ─────────────────────────────────────────────────
describe("scoreTopic semantic blend", () => {
  const niche = {
    id: "n1", name: "Tech", keywords: ["ai", "startups"],
    monetizationKeywords: ["saas"], negativeKeywords: [], targetPersona: "founders",
  } as any;

  // NOTE: fixture must avoid "ai"/"startups" even as SUBSTRINGS (the keyword
  // matcher is substring-based — e.g. "raising" contains "ai").
  const paraphrased = {
    id: "t2", nicheId: "n1", title: "Machine intelligence firms secure new funding",
    keywords: ["machine intelligence", "funding"], sources: ["hackernews"], sourceCount: 2,
    firstSeenAt: new Date(), lastSeenAt: new Date(), velocity: 0.5,
    score: null, decision: null, state: "IDEA",
    suggestedFormat: null, formatConfidence: null,
  } as any;

  it("rescues zero-keyword-overlap topics with high semantic similarity", () => {
    const withoutSemantic = scoreTopic(paraphrased, niche, []);
    expect(withoutSemantic.decision).toBe("discarded"); // today's behavior

    const withSemantic = scoreTopic(paraphrased, niche, [], undefined, {
      nicheSimilarity: 0.82, maxRecentSimilarity: 0.3,
    });
    expect(withSemantic.decision).not.toBe("discarded");
    expect(withSemantic.semanticRelevance).toBeGreaterThan(0.8);
  });

  it("still discards when both keyword overlap and similarity are low", () => {
    const result = scoreTopic(paraphrased, niche, [], undefined, {
      nicheSimilarity: 0.45, maxRecentSimilarity: 0.3,
    });
    expect(result.decision).toBe("discarded");
  });

  it("never lowers audienceRelevance for keyword-matching topics (blend is max)", () => {
    const matching = { ...paraphrased, id: "t3", title: "AI startups raising", keywords: ["ai", "startups"] };
    const base = scoreTopic(matching, niche, []);
    const blended = scoreTopic(matching, niche, [], undefined, {
      nicheSimilarity: 0.4, maxRecentSimilarity: 0.0, // low semantic must not hurt
    });
    expect(blended.audienceRelevance).toBeGreaterThanOrEqual(base.audienceRelevance);
  });

  it("semantic recent-similarity reduces novelty (paraphrase dedup)", () => {
    const matching = { ...paraphrased, id: "t4", title: "AI startups raising", keywords: ["ai", "startups"] };
    const fresh = scoreTopic(matching, niche, [], undefined, {
      nicheSimilarity: 0.8, maxRecentSimilarity: 0.5,
    });
    const dupe = scoreTopic(matching, niche, [], undefined, {
      nicheSimilarity: 0.8, maxRecentSimilarity: 0.85,
    });
    expect(dupe.novelty).toBeLessThan(fresh.novelty);
  });

  it("semanticRelevance is 0 and behavior unchanged when semantic omitted", () => {
    const matching = { ...paraphrased, id: "t5", title: "AI startups raising", keywords: ["ai", "startups"] };
    const r = scoreTopic(matching, niche, []);
    expect(r.semanticRelevance).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scoring.test.ts` → FAIL (arity/semanticRelevance missing).

- [ ] **Step 3: Implement in scoring.ts**

In `src/domain/scoring.ts`:

1. Import: `import { normalizeCosine } from "./similarity.js";`
2. Add to `TopicScoreBreakdown`: `semanticRelevance: number;` (after `audienceRelevance`).
3. Add the type + param:
```ts
export interface SemanticSignals {
  /** Raw cosine: topic embedding vs niche embedding. */
  nicheSimilarity: number;
  /** Raw cosine: topic embedding vs most-similar recent topic in the niche. */
  maxRecentSimilarity: number;
}

export function scoreTopic(
  topic: Topic,
  niche: Niche,
  recentTitles: string[],
  learned?: LearnedSignals,
  semantic?: SemanticSignals
): TopicScoreBreakdown {
```
4. After the existing `audienceRelevance` computation, add:
```ts
  const semanticRelevance = semantic ? normalizeCosine(semantic.nicheSimilarity) : 0;
  const blendedRelevance = Math.max(audienceRelevance, semanticRelevance);
```
5. Replace the hard-discard condition `if (audienceMatches === 0)` with:
```ts
  if (audienceMatches === 0 && semanticRelevance < 0.15) {
```
and add `semanticRelevance,` plus keep `learnedBoost: 1.0,` in that early-return object (set `semanticRelevance` to the computed value there, not 0).
6. Use `blendedRelevance` in place of `audienceRelevance` in the weighted `rawScore` sum (the `0.28 *` term). Keep reporting the ORIGINAL keyword-based `audienceRelevance` in the breakdown (plus the new `semanticRelevance`) so both signals stay inspectable.
7. Replace the novelty line:
```ts
  const novelty = scoreNovelty(topic.title, recentTitles);
```
with:
```ts
  const jaccardNovelty = scoreNovelty(topic.title, recentTitles);
  const semanticNovelty = semantic ? 1 - normalizeCosine(semantic.maxRecentSimilarity) : 1;
  const novelty = clamp01(Math.min(jaccardNovelty, semanticNovelty));
```
8. Add `semanticRelevance,` to the final breakdown object.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/scoring.test.ts` → all pass (old + learned + 5 new).
Also: `npx vitest run` full suite → green (learning/format tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/domain/scoring.ts tests/scoring.test.ts
git commit -m "feat(scoring): blend-safe semantic relevance + paraphrase-aware novelty in scoreTopic"
```

---

### Task 5: Embedding providers + repo

**Files:**
- Create: `src/services/embeddings.ts`
- Create: `src/services/embeddingRepo.ts`
- Test: `tests/embeddings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/embeddings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FallbackHashEmbedder,
  composeTopicText,
  composeNicheText,
  parseGeminiBatchResponse,
  unitNormalize,
} from "../src/services/embeddings.js";
import { cosineSimilarity } from "../src/domain/similarity.js";

describe("FallbackHashEmbedder", () => {
  const embedder = new FallbackHashEmbedder();

  it("is deterministic and unit-length", async () => {
    const [a] = (await embedder.embedBatch(["ai startups"]))!;
    const [b] = (await embedder.embedBatch(["ai startups"]))!;
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("related texts score higher than unrelated", async () => {
    const [ai1, ai2, cooking] = (await embedder.embedBatch([
      "ai machine learning startups",
      "machine learning ai companies",
      "sourdough bread baking recipes",
    ]))!;
    expect(cosineSimilarity(ai1, ai2)).toBeGreaterThan(cosineSimilarity(ai1, cooking));
  });
});

describe("text composition", () => {
  it("topic text = title + keywords", () => {
    expect(composeTopicText({ title: "AI rising", keywords: ["ai", "ml"] } as any))
      .toBe("AI rising. ai, ml");
  });
  it("niche text = name + persona + keywords", () => {
    expect(composeNicheText({ name: "Tech", targetPersona: "founders", keywords: ["ai"] } as any))
      .toBe("Tech. founders. ai");
  });
});

describe("parseGeminiBatchResponse", () => {
  it("extracts and unit-normalizes vectors", () => {
    const vecs = parseGeminiBatchResponse({ embeddings: [{ values: [3, 4] }] });
    expect(vecs).toEqual([[0.6, 0.8]]);
  });
  it("returns null on malformed payloads", () => {
    expect(parseGeminiBatchResponse({} as any)).toBeNull();
    expect(parseGeminiBatchResponse({ embeddings: [{}] } as any)).toBeNull();
  });
});

describe("unitNormalize", () => {
  it("zero vector stays zero (no NaN)", () => {
    expect(unitNormalize([0, 0])).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/embeddings.test.ts` → FAIL.

- [ ] **Step 3: Implement embeddings.ts**

Create `src/services/embeddings.ts`:

```ts
import { llmConfigStore } from "../config/llmConfigStore.js";
import type { Niche, Topic } from "../domain/types.js";

/** Embedding providers. ONLY real gemini vectors are ever persisted or used
 *  for scoring decisions; the fallback exists so the cosine/blend machinery
 *  stays unit-testable offline (see spec §2 safety rule). */

export interface EmbeddingProvider {
  readonly name: "gemini" | "fallback";
  /** Unit-length vectors, one per input text, or null on failure. */
  embedBatch(texts: string[]): Promise<number[][] | null>;
}

export function composeTopicText(topic: Pick<Topic, "title" | "keywords">): string {
  return `${topic.title}. ${topic.keywords.join(", ")}`;
}

export function composeNicheText(niche: Pick<Niche, "name" | "targetPersona" | "keywords">): string {
  return `${niche.name}. ${niche.targetPersona}. ${niche.keywords.join(", ")}`;
}

export function unitNormalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

interface GeminiBatchResponse {
  embeddings?: Array<{ values?: number[] }>;
}

export function parseGeminiBatchResponse(json: GeminiBatchResponse): number[][] | null {
  if (!Array.isArray(json.embeddings)) return null;
  const out: number[][] = [];
  for (const e of json.embeddings) {
    if (!Array.isArray(e.values) || e.values.length === 0) return null;
    out.push(unitNormalize(e.values));
  }
  return out;
}

const GEMINI_MODEL = "text-embedding-004";
const GEMINI_BATCH_LIMIT = 100;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini" as const;
  constructor(private readonly apiKey: string) {}

  async embedBatch(texts: string[]): Promise<number[][] | null> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += GEMINI_BATCH_LIMIT) {
      const chunk = texts.slice(i, i + GEMINI_BATCH_LIMIT);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchEmbedContents?key=${this.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: chunk.map((text) => ({
                model: `models/${GEMINI_MODEL}`,
                content: { parts: [{ text }] },
              })),
            }),
          }
        );
        if (!res.ok) {
          console.warn(`[embed] gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
          return null;
        }
        const parsed = parseGeminiBatchResponse(await res.json());
        if (!parsed || parsed.length !== chunk.length) return null;
        out.push(...parsed);
      } catch (err: any) {
        console.warn(`[embed] gemini fetch error: ${err?.message}`);
        return null;
      }
    }
    return out;
  }
}

/** Deterministic token-hash embedding (128-dim). Tests only — never persisted. */
export class FallbackHashEmbedder implements EmbeddingProvider {
  readonly name = "fallback" as const;

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Array(128).fill(0);
      const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      for (const token of tokens) {
        let h = 0x811c9dc5;
        for (let i = 0; i < token.length; i++) {
          h ^= token.charCodeAt(i);
          h = Math.imul(h, 0x01000193);
        }
        vec[(h >>> 0) % 128] += 1;
      }
      return unitNormalize(vec);
    });
  }
}

/** Gemini when an enabled gemini config with a key exists, else fallback. */
export function selectEmbeddingProvider(): EmbeddingProvider {
  const gemini = llmConfigStore.list().find(
    (c) => c.provider === "gemini" && c.enabled && c.apiKey
  );
  if (gemini) return new GeminiEmbeddingProvider(gemini.apiKey);
  return new FallbackHashEmbedder();
}
```

(Check `llmConfigStore`'s actual `list()` item shape — `provider`, `enabled`, `apiKey` fields confirmed at `src/config/llmConfigStore.ts:197`; adapt property names only if the type differs.)

- [ ] **Step 4: Implement embeddingRepo.ts**

Create `src/services/embeddingRepo.ts`:

```ts
import { query } from "../db/pool.js";

/** Thin JSONB vector cache on topics/niches. Only gemini vectors are stored. */

function asVector(value: unknown): number[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number")
    ? (value as number[])
    : null;
}

export async function getNicheEmbedding(nicheId: string): Promise<number[] | null> {
  const r = await query(`SELECT embedding FROM niches WHERE id = $1`, [nicheId]);
  return r.rows[0] ? asVector(r.rows[0].embedding) : null;
}

export async function saveNicheEmbedding(nicheId: string, vec: number[]): Promise<void> {
  await query(`UPDATE niches SET embedding = $2 WHERE id = $1`, [nicheId, JSON.stringify(vec)]);
}

export async function getTopicEmbeddings(topicIds: string[]): Promise<Map<string, number[]>> {
  if (topicIds.length === 0) return new Map();
  const r = await query(
    `SELECT id, embedding FROM topics WHERE id = ANY($1::uuid[]) AND embedding IS NOT NULL`,
    [topicIds]
  );
  const map = new Map<string, number[]>();
  for (const row of r.rows) {
    const vec = asVector(row.embedding);
    if (vec) map.set(row.id, vec);
  }
  return map;
}

export async function saveTopicEmbedding(topicId: string, vec: number[]): Promise<void> {
  await query(`UPDATE topics SET embedding = $2 WHERE id = $1`, [topicId, JSON.stringify(vec)]);
}

/** Recent same-niche topic vectors for paraphrase-novelty comparison. */
export async function listRecentTopicEmbeddings(
  nicheId: string,
  excludeTopicId: string,
  limit = 25
): Promise<number[][]> {
  const r = await query(
    `SELECT embedding FROM topics
     WHERE niche_id = $1 AND id <> $2 AND embedding IS NOT NULL
     ORDER BY last_seen_at DESC LIMIT $3`,
    [nicheId, excludeTopicId, limit]
  );
  return r.rows.map((row: any) => asVector(row.embedding)).filter((v: number[] | null): v is number[] => v !== null);
}
```

- [ ] **Step 5: Run tests + gates + commit**

Run: `npx vitest run tests/embeddings.test.ts` → 7 passed. Then full gates.

```bash
git add src/services/embeddings.ts src/services/embeddingRepo.ts tests/embeddings.test.ts
git commit -m "feat(embeddings): gemini batch provider, offline fallback, JSONB vector cache"
```

---

### Task 6: Semantic scoring context + score worker wiring

**Files:**
- Create: `src/services/semanticScoring.ts`
- Modify: `src/worker/index.ts` (score worker)

- [ ] **Step 1: Create the orchestration service**

Create `src/services/semanticScoring.ts`:

```ts
import { cosineSimilarity } from "../domain/similarity.js";
import type { SemanticSignals } from "../domain/scoring.js";
import type { Niche, Topic } from "../domain/types.js";
import {
  composeNicheText,
  composeTopicText,
  selectEmbeddingProvider,
} from "./embeddings.js";
import {
  getNicheEmbedding,
  getTopicEmbeddings,
  listRecentTopicEmbeddings,
  saveNicheEmbedding,
  saveTopicEmbedding,
} from "./embeddingRepo.js";

/** Builds per-topic semantic signals for one score run.
 *
 *  Safety rule (spec §2): only real gemini vectors are persisted or used for
 *  scoring. With no gemini key (or on API failure) this returns an empty map
 *  and scoring stays keyword-only. */
export async function buildSemanticContext(
  topics: Topic[],
  niches: Map<string, Niche>
): Promise<Map<string, SemanticSignals>> {
  const signals = new Map<string, SemanticSignals>();
  const provider = selectEmbeddingProvider();
  if (provider.name !== "gemini" || topics.length === 0) return signals;

  // 1. Ensure niche embeddings.
  const nicheVecs = new Map<string, number[]>();
  for (const [nicheId, niche] of niches) {
    let vec = await getNicheEmbedding(nicheId);
    if (!vec) {
      const embedded = await provider.embedBatch([composeNicheText(niche)]);
      if (!embedded) continue;
      vec = embedded[0];
      await saveNicheEmbedding(nicheId, vec);
    }
    nicheVecs.set(nicheId, vec);
  }

  // 2. Ensure topic embeddings (batch the uncached ones).
  const cached = await getTopicEmbeddings(topics.map((t) => t.id));
  const uncached = topics.filter((t) => !cached.has(t.id));
  if (uncached.length > 0) {
    const embedded = await provider.embedBatch(uncached.map(composeTopicText));
    if (embedded) {
      for (let i = 0; i < uncached.length; i++) {
        cached.set(uncached[i].id, embedded[i]);
        await saveTopicEmbedding(uncached[i].id, embedded[i]);
      }
    }
  }

  // 3. Per-topic signals from cached vectors only.
  for (const topic of topics) {
    const topicVec = cached.get(topic.id);
    const nicheVec = nicheVecs.get(topic.nicheId);
    if (!topicVec || !nicheVec) continue; // keyword-only for this topic
    const recent = await listRecentTopicEmbeddings(topic.nicheId, topic.id);
    const maxRecentSimilarity = recent.reduce(
      (best, vec) => Math.max(best, cosineSimilarity(topicVec, vec)),
      0
    );
    signals.set(topic.id, {
      nicheSimilarity: cosineSimilarity(topicVec, nicheVec),
      maxRecentSimilarity,
    });
  }
  return signals;
}
```

- [ ] **Step 2: Wire the score worker**

In `src/worker/index.ts`, replace the score worker body with:

```ts
new Worker(
  "score",
  async () => {
    const { getLearnedSignals } = await import("../services/learningRepo.js");
    const { buildSemanticContext } = await import("../services/semanticScoring.js");
    const topics = await listScorableTopics();
    if (topics.length === 0) return;

    const nicheMap = new Map<string, NonNullable<Awaited<ReturnType<typeof getNiche>>>>();
    for (const topic of topics) {
      if (!nicheMap.has(topic.nicheId)) {
        const niche = await getNiche(topic.nicheId);
        if (niche) nicheMap.set(topic.nicheId, niche);
      }
    }

    const semanticByTopic = await buildSemanticContext(topics, nicheMap);
    const learnedCache = new Map<string, Awaited<ReturnType<typeof getLearnedSignals>>>();

    for (const topic of topics) {
      const niche = nicheMap.get(topic.nicheId);
      if (!niche) continue;
      if (!learnedCache.has(topic.nicheId)) {
        learnedCache.set(topic.nicheId, await getLearnedSignals(topic.nicheId));
      }
      const recentTitles = await listRecentTopicTitles(topic.nicheId, topic.id);
      const breakdown = scoreTopic(
        topic, niche, recentTitles,
        learnedCache.get(topic.nicheId),
        semanticByTopic.get(topic.id)
      );
      await updateTopicScore(topic.id, breakdown.score, breakdown.decision, breakdown);
    }
  },
  workerOptions
);
```

(The niche cache replaces the previous per-topic `getNiche` calls — same behavior, fewer queries; `getNiche` import already exists.)

- [ ] **Step 3: Gates + live smoke**

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit` → green.
Live smoke (Postgres up): start API+worker (`npx tsx src/api/server.ts` / `npx tsx src/worker/index.ts` in background), `curl -s -X POST http://localhost:4000/api/jobs/score`, wait ~15s, then:
`docker compose exec -T postgres psql -U theme -d theme_engine -t -c "SELECT count(*) FROM topics WHERE embedding IS NOT NULL; SELECT count(*) FROM niches WHERE embedding IS NOT NULL; SELECT count(*) FROM topics WHERE (score_breakdown->>'semanticRelevance')::float > 0;"`
Expected WITH gemini key: nonzero counts. If the gemini call fails (network/quota), counts stay 0 and scoring is keyword-only — verify the worker log shows the `[embed]` warning rather than a crash. Kill background processes after.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(scoring): semantic context builder wired into score worker (gemini-only, keyword-safe fallback)"
```

---

### Task 7: QA gate tests (test-only)

**Files:**
- Test: `tests/qa.test.ts`

- [ ] **Step 1: Write the tests**

`runQualityGate(content, nicheCategory?)` lives at `src/services/qa.ts:9`; `GeneratedContent` at `src/domain/types.ts:78` (reelScripts[], carousel[] with slide/title/body, captions: Record<Platform,string>, hashtags[]). Create `tests/qa.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runQualityGate } from "../src/services/qa.js";
import type { GeneratedContent } from "../src/domain/types.js";

function makeContent(overrides: Partial<GeneratedContent> = {}): GeneratedContent {
  return {
    reelScripts: [{
      title: "Budget basics",
      hook: "Five money mistakes that quietly drain your paycheck",
      script: "Track spending weekly. Cut one subscription. Automate savings.",
      cta: "Save this and follow for weekly money tips",
      hookScore: 0.8,
    }],
    carousel: Array.from({ length: 8 }, (_, i) => ({
      slide: i + 1,
      title: `Slide ${i + 1}`,
      body: "Short and clear body text. Try one step today.",
    })),
    captions: { instagram: "Follow for more. Save this post.", youtube_shorts: "Subscribe for more." } as any,
    hashtags: ["#money"],
    ...overrides,
  };
}

describe("runQualityGate — generic checks", () => {
  it("passes well-formed content", () => {
    const result = runQualityGate(makeContent());
    expect(result.passed).toBe(true);
  });

  it("fails hook_clarity for a too-short hook", () => {
    const result = runQualityGate(makeContent({
      reelScripts: [{ title: "x", hook: "Money tips", script: "s", cta: "follow", hookScore: 0.5 }],
    }));
    expect(result.checks.find((c) => c.name === "hook_clarity")!.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails non_generic_content on filler phrases", () => {
    const result = runQualityGate(makeContent({
      captions: { instagram: "This ultimate guide is a game changer. Follow!" } as any,
    }));
    expect(result.checks.find((c) => c.name === "non_generic_content")!.passed).toBe(false);
  });

  it("fails cta_presence when no engagement action exists", () => {
    const content = makeContent();
    content.reelScripts[0].cta = "Thanks for watching";
    content.captions = { instagram: "Interesting facts about budgets." } as any;
    content.carousel = content.carousel.map((s) => ({ ...s, body: "Neutral body." }));
    const result = runQualityGate(content);
    expect(result.checks.find((c) => c.name === "cta_presence")!.passed).toBe(false);
  });

  it("fails carousel_structure when not exactly 8 slides", () => {
    const result = runQualityGate(makeContent({ carousel: makeContent().carousel.slice(0, 5) }));
    expect(result.checks.find((c) => c.name === "carousel_structure")!.passed).toBe(false);
  });
});

describe("runQualityGate — niche gates", () => {
  it("health: blocks miracle claims and requires a professional hedge", () => {
    const bad = makeContent();
    bad.reelScripts[0].script = "This miracle routine is 100% effective and guaranteed.";
    const result = runQualityGate(bad, "health");
    expect(result.checks.find((c) => c.name === "health_no_miracle_claims")!.passed).toBe(false);

    const good = makeContent();
    good.reelScripts[0].script = "Research suggests morning walks help. Consult your doctor.";
    expect(runQualityGate(good, "health").checks.find((c) => c.name === "health_professional_hedge")!.passed).toBe(true);
  });

  it("finance: blocks guaranteed returns, requires disclaimer", () => {
    const bad = makeContent();
    bad.reelScripts[0].script = "Guaranteed returns with this risk-free investment.";
    const result = runQualityGate(bad, "finance");
    expect(result.checks.find((c) => c.name === "finance_no_guaranteed_returns")!.passed).toBe(false);

    const good = makeContent();
    good.captions = { instagram: "Not financial advice — do your own research. Follow for more." } as any;
    expect(runQualityGate(good, "finance").checks.find((c) => c.name === "finance_not_financial_advice")!.passed).toBe(true);
  });

  it("food: blocks guaranteed allergen-free claims", () => {
    const bad = makeContent();
    bad.reelScripts[0].script = "Guaranteed nut-free brownies everyone can eat.";
    const result = runQualityGate(bad, "food");
    expect(result.checks.find((c) => c.name === "food_allergen_caution")!.passed).toBe(false);
  });

  it("niche checks absent without a category", () => {
    const names = runQualityGate(makeContent()).checks.map((c) => c.name);
    expect(names.some((n) => n.startsWith("health_") || n.startsWith("finance_") || n.startsWith("food_"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and fix fixtures (not the code)**

Run: `npx vitest run tests/qa.test.ts`.
These tests document EXISTING behavior — if an assertion fails, first verify by reading `src/services/qa.ts` whether the fixture trips another check (e.g. readability, hook word counts) and adjust the FIXTURE. Only flag (do not change) `qa.ts` if you find a genuine bug; report it.

- [ ] **Step 3: Commit**

```bash
git add tests/qa.test.ts
git commit -m "test(qa): cover generic + niche quality gates"
```

---

### Task 8: platformFormatter tests (test-only)

**Files:**
- Test: `tests/platformFormatter.test.ts`

- [ ] **Step 1: Write the tests**

`formatCaption` lives at `src/services/platformFormatter.ts` (LIMITS per platform; twitter: hook + ≤2 tags within 280; reddit: caption only; default: hook + blank + caption + blank + tags, trimmed to limit). Create `tests/platformFormatter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCaption } from "../src/services/platformFormatter.js";

const base = {
  hook: "Five money mistakes draining your paycheck",
  caption: "Track spending weekly and automate savings to build momentum.",
  hashtags: ["money", "#budget", "finance", "savings"],
};

describe("formatCaption", () => {
  it("instagram: hook + caption + hashtags with # prefixes", () => {
    const out = formatCaption({ platform: "instagram", ...base });
    expect(out).toContain(base.hook);
    expect(out).toContain(base.caption);
    expect(out).toContain("#money");
    expect(out).toContain("#budget"); // existing # not doubled
    expect(out).not.toContain("##");
  });

  it("twitter: fits 280 chars and caps hashtags at 2", () => {
    const out = formatCaption({ platform: "twitter", ...base });
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out.match(/#/g)!.length).toBeLessThanOrEqual(2);
    expect(out).not.toContain(base.caption); // twitter is hook-only
  });

  it("twitter: truncates an over-long hook with ellipsis", () => {
    const out = formatCaption({ platform: "twitter", hook: "x".repeat(400), caption: "", hashtags: ["a"] });
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out).toContain("…");
  });

  it("reddit: returns the caption body only", () => {
    const out = formatCaption({ platform: "reddit", ...base });
    expect(out).toBe(base.caption);
  });

  it("youtube_shorts: uses the default hook+caption+tags path", () => {
    const out = formatCaption({ platform: "youtube_shorts", ...base });
    expect(out).toContain(base.hook);
    expect(out).toContain(base.caption);
  });

  it("linkedin: caps hashtags at 5", () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    const out = formatCaption({ platform: "linkedin", ...base, hashtags: tags });
    expect(out.match(/#/g)!.length).toBeLessThanOrEqual(5);
  });

  it("trims caption to fit the platform limit", () => {
    const out = formatCaption({ platform: "twitter", hook: "Short hook here for the test", caption: "y".repeat(5000), hashtags: [] });
    expect(out.length).toBeLessThanOrEqual(280);
  });
});
```

- [ ] **Step 2: Run and fix fixtures (not the code)**

Run: `npx vitest run tests/platformFormatter.test.ts`. Same rule as Task 7: adjust FIXTURES to documented behavior; report (don't fix) real bugs found.

- [ ] **Step 3: Commit**

```bash
git add tests/platformFormatter.test.ts
git commit -m "test(formatter): cover per-platform caption formatting"
```

---

### Task 9: Docs + final verification

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/RUNBOOK.md` (only if it references db:init/schema.sql specifics)

- [ ] **Step 1: Update docs**

`docs/ARCHITECTURE.md`:
- Module 2 (Topic scoring): add a line — "Semantic relevance: Gemini `text-embedding-004` vectors (cached in `topics.embedding`/`niches.embedding`) blend with keyword relevance (max) and drive paraphrase-aware novelty; keyword-only when no gemini key."
- Add a short "## Migrations" section: numbered files in `src/db/migrations/`, applied by `npm run db:init` (or `db:migrate`) via `schema_migrations` tracking; never edit an applied migration — add a new file.

Check `docs/RUNBOOK.md` for `schema.sql`/`init-db` mentions (`grep -n "schema.sql\|init-db" docs/RUNBOOK.md`) and update to the migration runner if present.

- [ ] **Step 2: Full verification**

- `npx vitest run` → all suites green (expect ~75+ tests).
- `npx tsc -p tsconfig.json --noEmit` → clean.
- `npm run build` → succeeds; `git checkout -- dist-web`.
- `npm run db:init` twice → second run "up to date".
- `grep -rn "schema.sql" src scripts package.json docs` → only historical references in docs/plans (acceptable) — no code readers.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: migrations + semantic scoring; Sprint B verification"
```
