# Sprint B — Foundations: Design Spec

> Status: Approved design, 2026-07-14 (user delegated approach selection)
> Scope: numbered DB migrations, embedding-based relevance scoring (blend-safe),
> keyword normalization, targeted test coverage.

## Goals

1. Replace ad-hoc idempotent-ALTER schema evolution with numbered migrations.
2. Fix brittle substring-only topic relevance: paraphrased on-niche topics are
   currently hard-discarded when no keyword literally overlaps.
3. Stop sentence-length "keywords" (from Phase 1.5 manual topics) polluting
   scoring and `learning_signals`.
4. Cover the highest-value untested pure logic (QA gates, caption formatter).

## Decisions (user-confirmed)

- **Blend, safe:** embeddings raise relevance, never lower it; discard requires
  both keyword-zero AND low similarity. No currently-selected topic gets worse.
- **Hand-rolled migration runner:** zero new dependencies, matches raw-SQL style.
- **Approach A for embeddings:** lazy embed at scoring time, cached in DB
  (JSONB float arrays), cosine in JS. No pgvector, no embed-at-ingestion.
- **Gemini `text-embedding-004`** is the only real provider (free tier; key
  already present in `data/llm_configs.json`). Groq has no embeddings API;
  OPENAI_API_KEY is empty.

## 1. Migration runner

- New: `src/db/migrations/001_baseline.sql` — current `schema.sql` content
  verbatim (already fully idempotent, so it converges on existing DBs and
  builds fresh ones).
- New: `src/db/migrations/002_embeddings.sql`:
  ```sql
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS embedding JSONB;
  ALTER TABLE niches ADD COLUMN IF NOT EXISTS embedding JSONB;
  ```
- New: `scripts/migrate.ts` (~60 lines):
  - `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  - read `src/db/migrations/*.sql`, sort by filename, skip versions already in
    `schema_migrations`, apply each pending file inside one transaction
    (`withTransaction` from `src/db/pool.ts`), insert its version row in the
    same transaction. Log applied/skipped counts. Fail loudly on error (exit 1).
- `package.json`: `db:init` → `tsx scripts/migrate.ts`; add `db:migrate` alias.
  `scripts/init-db.ts` deleted. `scripts/dev-bootstrap.ts` updated if it calls
  init-db directly.
- `src/db/schema.sql` deleted after its content moves to `001_baseline.sql`
  (single source of truth; grep for other readers first).
- Convention documented in ARCHITECTURE.md: never edit an applied migration;
  add a new numbered file.

## 2. Embedding service

- New: `src/services/embeddings.ts`
  ```ts
  interface EmbeddingProvider {
    readonly name: "gemini" | "fallback";
    /** Returns unit-length vectors, one per input, or null on failure. */
    embedBatch(texts: string[]): Promise<number[][] | null>;
  }
  ```
  - `GeminiEmbeddingProvider`: POST
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents`
    (≤100 texts per call; chunk larger inputs). API key from
    `llmConfigStore` gemini entry (or `GOOGLE_AI_API_KEY`/`LLM_API_KEY` env
    fallback — match how the rest of the app resolves the gemini key). Returns
    null on any HTTP/parse error (logged, never throws).
  - `FallbackHashEmbedder`: deterministic token-hash vector (128-dim, unit
    norm) so cosine machinery stays testable offline. **Never persisted** and
    never used for scoring decisions (see safety rule).
  - `selectEmbeddingProvider()`: gemini when a key exists, else fallback.
- Embedding text composition (single helper, used everywhere):
  - topic: `${title}. ${keywords.join(", ")}`
  - niche: `${name}. ${targetPersona}. ${keywords.join(", ")}`
- Cache repositories (thin, in `src/services/embeddingRepo.ts`):
  `listTopicsWithoutEmbedding(limit)`, `saveTopicEmbedding(id, vec)`,
  `getNicheEmbedding(id)` / `saveNicheEmbedding(id, vec)`,
  `listRecentTopicEmbeddings(nicheId, excludeTopicId, limit 25)` →
  `{id, title, embedding}[]`.
- **Safety rule:** only real gemini vectors are persisted or passed to scoring.
  When the provider is `fallback` (no key) or a batch fails, the worker passes
  `semantic: undefined` and scoring behaves exactly as today (keyword-only).
  Fallback vectors exist solely for unit tests of the cosine/blend math.

## 3. Scoring blend (pure)

- New in `src/domain/similarity.ts`:
  - `cosineSimilarity(a, b): number` (0 when either is empty/mismatched length)
  - `normalizeCosine(raw): number` — maps [0.50, 0.85] → [0, 1], clamped.
    (Gemini cosines for unrelated text cluster ≈0.4–0.55; strongly related
    ≈0.75+. Constants exported for tuning.)
- `scoreTopic(topic, niche, recentTitles, learned?, semantic?)` where
  `semantic?: { nicheSimilarity: number; maxRecentSimilarity: number }`
  (both raw cosines):
  - `semanticRelevance = normalizeCosine(semantic.nicheSimilarity)`
  - `audienceRelevance = max(keywordRelevance, semanticRelevance)`
  - Hard-discard branch: only when `audienceMatches === 0 AND
    (semantic === undefined || semanticRelevance < 0.15)`. When semantics
    rescue a zero-keyword topic, scoring continues with
    `audienceRelevance = semanticRelevance`.
  - `novelty = clamp01(1 - max(jaccardMax, normalizeCosine(semantic.maxRecentSimilarity)))`
    (falls back to jaccard-only when semantic undefined).
  - Breakdown gains `semanticRelevance: number` (0 when unused) so the UI/DB
    can show why a topic scored.
- Score worker (`src/worker/index.ts`):
  1. resolve provider; if gemini: ensure niche embeddings cached, batch-embed
     scorable topics missing embeddings (chunked ≤100), persist.
  2. per topic: compute `semantic` from cached vectors
     (`nicheSimilarity` vs its niche, `maxRecentSimilarity` vs
     `listRecentTopicEmbeddings`), pass to `scoreTopic`. Topics without a
     cached vector (embed failed) score keyword-only.

## 4. Keyword normalization

- New: `src/domain/keywords.ts` —
  `normalizeKeywords(raw: string[]): string[]`: lowercase → trim → strip
  leading/trailing punctuation → collapse inner whitespace → drop empty →
  **drop > 40 chars or > 4 words** → dedupe (order-preserving) → cap at 10.
  Constants exported (`MAX_KEYWORD_CHARS = 40`, `MAX_KEYWORD_WORDS = 4`,
  `MAX_KEYWORDS = 10`).
- Applied at write paths:
  - manual topic creation endpoint(s) in `src/api/server.ts` (Phase 1.5 —
    both URL-extract and fully-manual forms),
  - ingestion keyword generation (`src/services/ingestion/keywordize.ts` and/or
    `tag-generator.ts` — wherever topic keywords are produced; locate at
    implementation time and normalize at the final write into `topics`).
- Defensive guard in `snapshotSignals` (`src/domain/learning.ts`): skip
  keyword labels longer than `MAX_KEYWORD_CHARS` so sentence labels can never
  enter `learning_signals` even from legacy rows.
- One-off cleanup migration `003_clean_keyword_signals.sql`:
  `DELETE FROM learning_signals WHERE signal_type='keyword' AND length(label) > 40;`

## 5. Test coverage

New suites (vitest, pure, no DB):
- `tests/qa.test.ts` — `runQualityGate`: passing content; generic-hook fail;
  missing-CTA fail; carousel structure; niche gates (health miracle-claims,
  finance guaranteed-returns, food allergen).
- `tests/platformFormatter.test.ts` — `formatCaption`: twitter 280-char
  truncation + ≤2 hashtags; reddit body passthrough; instagram hashtag cap 30;
  youtube_shorts default path; caption-trim when over limit.
- `tests/keywords.test.ts` — normalizer: case/trim/punct, sentence-drop,
  dedupe, cap, empty input.
- `tests/similarity.test.ts` — cosine (orthogonal/identical/empty/mismatch),
  normalizeCosine clamping, blend behavior via `scoreTopic` with `semantic`
  (rescue case: zero keywords + high similarity → not discarded; low both →
  discarded; keyword high + semantic low → unchanged vs today).
- `tests/migrate.test.ts` — pure parts of the runner (filename ordering,
  pending-set computation) extracted as functions; no live-DB test.
- `snapshotSignals` guard case added to `tests/learning.test.ts`.

## 6. Error handling

- Gemini batch failure → warn log, that run scores keyword-only; next run
  retries the uncached topics. Never blocks the score worker.
- Vector length mismatch or non-array JSONB → treated as missing (re-embed).
- Migration failure → transaction rolls back, runner exits 1, nothing recorded.

## Out of scope

- pgvector / semantic search UI (revisit if topic volume grows 100×).
- Embedding-based dedup at ingestion (Sprint C candidate with trend alerts).
- Re-embedding existing ANALYZED/POSTED topics (only scorable topics get
  vectors).
- Sprint C growth features.
