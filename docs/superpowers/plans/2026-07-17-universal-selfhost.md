# Sprint U1 — Universal Self-Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sources become user-configurable (DB-backed map + registry-driven UI + custom niches), opinionated constants become settings, and the project becomes installable by a stranger (Docker, prod static serving, optional API token, AGPL docs).

**Architecture:** `page_source_maps` table replaces the gitignored JSON cache (one-time seed import); a static `SOURCE_REGISTRY` manifest drives a generic Sources settings UI; `ingestForNiche` gains map overrides for the last hardcoded sources; domain constants get validated `apply*Overrides()` setters fed from configStore at boot; packaging = multi-stage Dockerfile + compose `full` profile + dist-aware migrations + SPA static serving. Spec: `docs/superpowers/specs/2026-07-17-universal-selfhost-design.md`.

**Tech Stack:** TypeScript ESM (`.js` suffixes), Express 5, pg raw SQL, React 19 inline-style UI, vitest (116 green — keep green), Docker.

**Conventions:** gates = `npx vitest run` + `npx tsc -p tsconfig.json --noEmit` + `npm run build` (then `git checkout -- dist-web`). Dev DB: `docker compose exec -T postgres psql -U theme -d theme_engine`. READ every file before modifying. Commit per task.

---

### Task 1: DB-backed source maps (migration 007)

**Files:**
- Create: `src/db/migrations/007_page_source_maps.sql`
- Modify: `src/services/ingestion/tag-generator.ts` (persistence swap + new map fields)
- Modify: `src/services/ingestion/index.ts` (await async cache)
- Modify: `src/api/server.ts` (3 call sites go async)

- [ ] **Step 1: Migration**

`src/db/migrations/007_page_source_maps.sql`:

```sql
-- Sprint U1: source maps move from gitignored data/page-sources.json to the
-- DB so a fresh install keeps its configuration.
CREATE TABLE IF NOT EXISTS page_source_maps (
  page_id    UUID PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  map        JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`npm run db:init` (applies 007; second run "up to date").

- [ ] **Step 2: tag-generator persistence swap**

In `src/services/ingestion/tag-generator.ts`:

1. Extend `PageSourceMap` with optional fields:
```ts
  /** Google News search phrases (override; empty/absent = category defaults). */
  googleNewsQueries?: string[];
  /** Finance-newsletter RSS overrides (absent = adapter defaults). */
  financeFeeds?: string[];
  /** Crypto-news RSS overrides (absent = adapter defaults). */
  cryptoFeeds?: string[];
```
2. Replace the disk cache with DB persistence (KEEP the exported function
   names; they become async):
```ts
import { query } from "../../db/pool.js";

/** One-time legacy import: seed the DB from data/page-sources.json rows
 *  that don't exist in the table yet. Safe to call repeatedly. */
async function seedLegacyCache(): Promise<void> {
  let legacy: Record<string, PageSourceMap> = {};
  try {
    if (fs.existsSync(CACHE_PATH)) legacy = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch { return; }
  for (const [pageId, map] of Object.entries(legacy)) {
    await query(
      `INSERT INTO page_source_maps (page_id, map) VALUES ($1, $2)
       ON CONFLICT (page_id) DO NOTHING`,
      [pageId, JSON.stringify(map)]
    ).catch(() => {}); // page may no longer exist (FK) — skip
  }
}
let seeded = false;
async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  seeded = true;
  await seedLegacyCache();
}

export async function getCachedSourceMap(pageId: string): Promise<PageSourceMap | null> {
  await ensureSeeded();
  const r = await query(`SELECT map FROM page_source_maps WHERE page_id = $1`, [pageId]);
  return r.rows[0]?.map ?? null;
}

export async function setCachedSourceMap(pageId: string, map: PageSourceMap): Promise<void> {
  await query(
    `INSERT INTO page_source_maps (page_id, map, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (page_id) DO UPDATE SET map = EXCLUDED.map, updated_at = now()`,
    [pageId, JSON.stringify(map)]
  );
}

export async function clearSourceMap(pageId: string): Promise<void> {
  await query(`DELETE FROM page_source_maps WHERE page_id = $1`, [pageId]);
}
```
   KEEP `CACHE_PATH`, `fs`, `path` imports for the seed path; DELETE
   `loadCache`/`saveCache` and `listCachedPageIds` IF unreferenced (grep
   first — the earlier recon shows no callers outside tag-generator, but
   verify). `generateSourceMap` internally calls the setter — make it await
   the new async version.

- [ ] **Step 3: Async ripple (exact call sites)**

- `src/services/ingestion/index.ts:44` → `let cachedMap = pageId ? await getCachedSourceMap(pageId) : null;`
- `src/api/server.ts:669` → `const map = await getCachedSourceMap(req.params.id);`
- `src/api/server.ts:689` → `await clearSourceMap(req.params.id);`
- `src/api/server.ts:698,702` → `await` both the get and the set.
Grep for any other caller and convert.

- [ ] **Step 4: Gates + live check + commit**

Gates green (116). Live: `npm run db:init`, start API, hit the existing
source-map GET route for a real page id — the legacy JSON content must
come back (proving the seed import worked):
`docker compose exec -T postgres psql -U theme -d theme_engine -c "SELECT page_id, jsonb_object_keys(map) FROM page_source_maps LIMIT 5;"`

```bash
git add -A && git commit -m "feat(sources): DB-backed page source maps with legacy JSON seed (migration 007)"
```

---

### Task 2: Source registry + last hardcoded overrides (TDD)

**Files:**
- Create: `src/services/ingestion/sourceRegistry.ts`
- Modify: `src/services/ingestion/index.ts` (google_news override)
- Modify: `src/services/ingestion/finance-newsletters.ts`, `crypto-news.ts` (optional feed overrides)
- Test: `tests/sourceRegistry.test.ts`

- [ ] **Step 1: Failing test**

`tests/sourceRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { SOURCE_REGISTRY } from "../src/services/ingestion/sourceRegistry.js";

describe("SOURCE_REGISTRY", () => {
  it("covers every source id dispatched by ingestForNiche", () => {
    const src = fs.readFileSync("src/services/ingestion/index.ts", "utf-8");
    const dispatched = [...src.matchAll(/isEnabled\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(dispatched.length).toBeGreaterThanOrEqual(14);
    const registryIds = SOURCE_REGISTRY.map((s) => s.id);
    for (const id of dispatched) expect(registryIds).toContain(id);
  });

  it("has unique ids and non-empty labels/descriptions", () => {
    const ids = SOURCE_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SOURCE_REGISTRY) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("configFields reference known kinds", () => {
    for (const s of SOURCE_REGISTRY)
      for (const f of s.configFields)
        expect(["strings", "feeds"]).toContain(f.kind);
  });
});
```

Run → FAIL (module not found).

- [ ] **Step 2: Implement the registry**

`src/services/ingestion/sourceRegistry.ts`:

```ts
/** Static manifest of every ingestion source — drives the Sources settings
 *  UI generically. Adding a source = adapter + one entry here (a test
 *  enforces registry/dispatch parity). `mapField` names refer to
 *  PageSourceMap keys (tag-generator.ts). */

export interface SourceConfigField {
  mapField: string;              // PageSourceMap key holding the config
  label: string;                 // UI label
  kind: "strings" | "feeds";     // chip list vs URL list (validated)
  placeholder?: string;
}

export interface SourceMeta {
  id: string;                    // must match isEnabled("<id>") in index.ts
  label: string;
  description: string;
  configFields: SourceConfigField[];
  needsKey?: { env: string; label: string };
}

export const SOURCE_REGISTRY: SourceMeta[] = [
  { id: "reddit", label: "Reddit", description: "Hot posts from niche subreddits.",
    configFields: [{ mapField: "redditSubreddits", label: "Subreddits", kind: "strings", placeholder: "MachineLearning" }] },
  { id: "rss", label: "Custom RSS", description: "Any RSS/Atom feeds you add.",
    configFields: [{ mapField: "rssFeeds", label: "Feeds", kind: "feeds", placeholder: "https://example.com/feed.xml" }] },
  { id: "google_news", label: "Google News", description: "News search phrases (intent-specific, not raw keywords).",
    configFields: [{ mapField: "googleNewsQueries", label: "Search phrases", kind: "strings", placeholder: "personal finance tips" }] },
  { id: "medium", label: "Medium", description: "Tag feeds on Medium.",
    configFields: [{ mapField: "mediumTags", label: "Tags", kind: "strings", placeholder: "machine-learning" }] },
  { id: "hacker_news", label: "Hacker News", description: "Front-page stories matching your terms.",
    configFields: [{ mapField: "hackernewsTerms", label: "Match terms", kind: "strings", placeholder: "LLM" }] },
  { id: "devto", label: "Dev.to", description: "Tag feeds on dev.to (tech niches).",
    configFields: [{ mapField: "devtoTags", label: "Tags", kind: "strings", placeholder: "ai" }] },
  { id: "substack", label: "Substack", description: "Public Substack publications.",
    configFields: [{ mapField: "substackSlugs", label: "Publication slugs", kind: "strings", placeholder: "importai" }] },
  { id: "arxiv", label: "arXiv", description: "Research papers by category (STEM niches).",
    configFields: [{ mapField: "arxivCategories", label: "Categories", kind: "strings", placeholder: "cs.AI" }] },
  { id: "crypto_news", label: "Crypto News", description: "Crypto RSS (CoinDesk, Decrypt, … or your own).",
    configFields: [{ mapField: "cryptoFeeds", label: "Feeds (empty = defaults)", kind: "feeds" }] },
  { id: "pubmed", label: "PubMed", description: "Medical research (health/food niches).", configFields: [] },
  { id: "exploding_topics", label: "Exploding Topics", description: "Early trend signals.",
    configFields: [], needsKey: { env: "EXPLODING_TOPICS_API_KEY", label: "Exploding Topics Pro API key" } },
  { id: "product_hunt", label: "Product Hunt", description: "Product launches.",
    configFields: [], needsKey: { env: "PRODUCT_HUNT_TOKEN", label: "Product Hunt token (optional, raises limits)" } },
  { id: "finance_newsletter", label: "Finance Newsletters", description: "Business/finance RSS (CNBC, … or your own).",
    configFields: [{ mapField: "financeFeeds", label: "Feeds (empty = defaults)", kind: "feeds" }] },
  { id: "youtube_trends", label: "YouTube Trends", description: "Trending videos.",
    configFields: [], needsKey: { env: "YOUTUBE_API_KEY", label: "YouTube Data API key" } },
];
```

VERIFY each `needsKey.env` against `src/config/env.ts` / the adapters (grep
the adapter files for `process.env` / `env.` usage) and correct the names to
the REAL env vars. Also verify the dispatched-ids test passes: if
ingestForNiche dispatches ids not listed here (e.g. `google_trends`,
`twitter` may or may not still be dispatched), add entries for them.

- [ ] **Step 3: Map overrides for the last hardcoded sources**

1. `src/services/ingestion/index.ts` — google news line becomes:
```ts
  const googleNewsQueries = cachedMap?.googleNewsQueries?.length
    ? cachedMap.googleNewsQueries
    : (GOOGLE_NEWS_QUERIES[category] ?? []);
```
2. `finance-newsletters.ts`: change `fetchFinanceNewsletterTrends(category, keywords)` to accept an optional third arg `overrideFeeds?: string[]` — when non-empty, use it instead of the module's default list. Same pattern for `fetchCryptoTrends(keywords, overrideFeeds?: string[])` in `crypto-news.ts` (READ both files; the default lists stay as fallbacks).
3. index.ts dispatch passes `cachedMap?.financeFeeds` / `cachedMap?.cryptoFeeds`.

- [ ] **Step 4: Gates + commit**

`npx vitest run` (116 + 3 = 119) + tsc clean.

```bash
git add -A && git commit -m "feat(sources): registry manifest + map overrides for google-news/finance/crypto feeds"
```

---

### Task 3: Sources API

**Files:**
- Create: `src/services/ingestion/sourceMapValidation.ts`
- Modify: `src/api/server.ts` (3 routes)
- Modify: `src/web/lib/api.ts` (client methods)
- Test: `tests/sourceMapValidation.test.ts`

- [ ] **Step 1: Failing validation test**

`tests/sourceMapValidation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateSourcePatch } from "../src/services/ingestion/sourceMapValidation.js";

describe("validateSourcePatch", () => {
  it("accepts toggles and string arrays", () => {
    const r = validateSourcePatch({
      sourceEnabled: { reddit: false },
      redditSubreddits: ["MachineLearning", " ChatGPT "],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.redditSubreddits).toEqual(["MachineLearning", "ChatGPT"]);
  });

  it("rejects invalid feed URLs", () => {
    const r = validateSourcePatch({ rssFeeds: [{ name: "x", url: "not-a-url" }] });
    expect(r.ok).toBe(false);
  });

  it("accepts valid feeds and plain-string feed arrays (financeFeeds)", () => {
    const r = validateSourcePatch({
      rssFeeds: [{ name: "Blog", url: "https://example.com/feed.xml" }],
      financeFeeds: ["https://example.com/biz.xml"],
    });
    expect(r.ok).toBe(true);
  });

  it("strips unknown keys", () => {
    const r = validateSourcePatch({ evil: "x", sourceEnabled: {} } as any);
    expect(r.ok).toBe(true);
    if (r.ok) expect("evil" in r.patch).toBe(false);
  });

  it("drops empty strings and dedupes", () => {
    const r = validateSourcePatch({ mediumTags: ["ai", "", "ai", "  "] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.mediumTags).toEqual(["ai"]);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement validation**

`src/services/ingestion/sourceMapValidation.ts`:

```ts
/** Validates a partial PageSourceMap patch from the Sources UI. */

const STRING_ARRAY_KEYS = [
  "mediumTags", "hackernewsTerms", "substackSlugs", "redditSubreddits",
  "devtoTags", "arxivCategories", "googleNewsQueries",
] as const;
const URL_ARRAY_KEYS = ["financeFeeds", "cryptoFeeds"] as const;

type Patch = Record<string, unknown>;
export type ValidationResult =
  | { ok: true; patch: Patch }
  | { ok: false; error: string };

function isHttpUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

function cleanStrings(arr: unknown): string[] | null {
  if (!Array.isArray(arr) || !arr.every((v) => typeof v === "string")) return null;
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

export function validateSourcePatch(body: Patch): ValidationResult {
  const patch: Patch = {};

  if (body.sourceEnabled !== undefined) {
    const se = body.sourceEnabled;
    if (typeof se !== "object" || se === null || Array.isArray(se)) return { ok: false, error: "sourceEnabled must be an object" };
    for (const v of Object.values(se)) if (typeof v !== "boolean") return { ok: false, error: "sourceEnabled values must be booleans" };
    patch.sourceEnabled = se;
  }

  for (const key of STRING_ARRAY_KEYS) {
    if (body[key] === undefined) continue;
    const cleaned = cleanStrings(body[key]);
    if (!cleaned) return { ok: false, error: `${key} must be an array of strings` };
    patch[key] = cleaned;
  }

  for (const key of URL_ARRAY_KEYS) {
    if (body[key] === undefined) continue;
    const cleaned = cleanStrings(body[key]);
    if (!cleaned) return { ok: false, error: `${key} must be an array of URLs` };
    const bad = cleaned.find((u) => !isHttpUrl(u));
    if (bad) return { ok: false, error: `invalid URL in ${key}: ${bad}` };
    patch[key] = cleaned;
  }

  if (body.rssFeeds !== undefined) {
    const feeds = body.rssFeeds;
    if (!Array.isArray(feeds)) return { ok: false, error: "rssFeeds must be an array" };
    const out: Array<{ name: string; url: string }> = [];
    for (const f of feeds) {
      const name = typeof (f as any)?.name === "string" ? (f as any).name.trim() : "";
      const url = typeof (f as any)?.url === "string" ? (f as any).url.trim() : "";
      if (!isHttpUrl(url)) return { ok: false, error: `invalid feed URL: ${url || "(empty)"}` };
      out.push({ name: name || url, url });
    }
    patch.rssFeeds = out;
  }

  return { ok: true, patch };
}
```

Run → 5 passed.

- [ ] **Step 3: Routes + client**

In `src/api/server.ts` (next to the existing source-map routes ~line 660 —
READ them; the GET/regenerate below likely REPLACE/extend what's there;
keep URLs consistent with what the existing UI already calls if anything
does — recon says nothing calls them from the web yet):

```ts
app.get("/api/pages/:id/sources", async (req, res, next) => {
  try {
    const { getCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const { SOURCE_REGISTRY } = await import("../services/ingestion/sourceRegistry.js");
    const map = await getCachedSourceMap(req.params.id);
    const keys: Record<string, boolean> = {};
    for (const s of SOURCE_REGISTRY) if (s.needsKey) keys[s.id] = Boolean(process.env[s.needsKey.env]);
    res.json({ registry: SOURCE_REGISTRY, map, keyPresent: keys });
  } catch (err) { next(err); }
});

app.put("/api/pages/:id/sources", async (req, res, next) => {
  try {
    const { getCachedSourceMap, setCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const { validateSourcePatch } = await import("../services/ingestion/sourceMapValidation.js");
    const result = validateSourcePatch(req.body ?? {});
    if (!result.ok) return void res.status(400).json({ error: result.error });
    const existing = await getCachedSourceMap(req.params.id);
    if (!existing) return void res.status(404).json({ error: "No source map yet — regenerate first" });
    const merged = { ...existing, ...result.patch };
    await setCachedSourceMap(req.params.id, merged);
    res.json({ ok: true, map: merged });
  } catch (err) { next(err); }
});

app.post("/api/pages/:id/sources/regenerate", async (req, res, next) => {
  try {
    const { generateSourceMap, getCachedSourceMap } = await import("../services/ingestion/tag-generator.js");
    const page = await query(`SELECT p.id, n.name, n.keywords FROM pages p JOIN niches n ON n.id = p.niche_id WHERE p.id = $1`, [req.params.id]);
    if (!page.rows[0]) return void res.status(404).json({ error: "Page not found" });
    await generateSourceMap(req.params.id, page.rows[0].name, page.rows[0].keywords, true);
    res.json({ ok: true, map: await getCachedSourceMap(req.params.id) });
  } catch (err) { next(err); }
});
```

(READ `generateSourceMap`'s real signature — 4th arg force flag assumed
from earlier usage `generateSourceMap(pageId, niche.name, niche.keywords,
false)`; adapt.) If old overlapping routes exist at ~line 660-700, merge:
keep ONE canonical set at these URLs, delete superseded ones, and grep the
web client for any callers to update.

`src/web/lib/api.ts`:

```ts
  getSources:        (pageId: string) => req<any>(`/pages/${pageId}/sources`),
  updateSources:     (pageId: string, patch: any) => req<any>(`/pages/${pageId}/sources`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }),
  regenerateSources: (pageId: string) => req<any>(`/pages/${pageId}/sources/regenerate`, { method: 'POST' }),
```
(Match how the file's existing JSON-body calls set headers/body — READ one
first, e.g. schedule-batch or reschedule, and mirror exactly.)

- [ ] **Step 4: Gates + live check + commit**

Gates (124: 119 + 5 validation tests). Live: GET sources for a real page (registry + map + keyPresent
sane); PUT a toggle `{"sourceEnabled":{"google_trends":false}}`… use a real
registry id, e.g. `{"sourceEnabled":{"medium":false}}` → 200, re-GET shows
it; PUT an invalid feed → 400.

```bash
git add -A && git commit -m "feat(sources): sources API — registry+map GET, validated PUT, regenerate"
```

---

### Task 4: Sources settings UI

**Files:**
- Create: `src/web/components/settings/SourcesPanel.tsx`
- Modify: `src/web/views/SettingsView.tsx` (mount as a new section)

- [ ] **Step 1: Component**

READ `SettingsView.tsx`'s NAV_SECTIONS + section-rendering + per-section
save pattern first, and one existing settings card for styling idioms.
Create `src/web/components/settings/SourcesPanel.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { ThemePage } from '../../lib/types';

type ConfigField = { mapField: string; label: string; kind: 'strings' | 'feeds'; placeholder?: string };
type SourceMeta = { id: string; label: string; description: string; configFields: ConfigField[]; needsKey?: { env: string; label: string } };

export const SourcesPanel: React.FC<{ page: ThemePage }> = ({ page }) => {
  const [registry, setRegistry] = useState<SourceMeta[]>([]);
  const [map, setMap] = useState<any | null>(null);
  const [keyPresent, setKeyPresent] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const load = () => api.getSources(page.id).then((d) => {
    setRegistry(d.registry); setMap(d.map); setKeyPresent(d.keyPresent ?? {}); setDirty(false);
  }).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page.id]);

  const enabled = (id: string) => map?.sourceEnabled?.[id] !== false;
  const toggle = (id: string) => {
    setMap((m: any) => ({ ...m, sourceEnabled: { ...(m?.sourceEnabled ?? {}), [id]: !enabled(id) } }));
    setDirty(true);
  };

  const fieldValues = (f: ConfigField): string[] => {
    const v = map?.[f.mapField];
    if (!v) return [];
    return f.mapField === 'rssFeeds' ? v.map((x: any) => x.url ?? x) : v;
  };

  const addValue = (f: ConfigField) => {
    const raw = (inputs[f.mapField] ?? '').trim();
    if (!raw) return;
    setMap((m: any) => {
      const current = m?.[f.mapField] ?? [];
      const next = f.mapField === 'rssFeeds'
        ? [...current, { name: raw, url: raw }]
        : [...new Set([...current, raw])];
      return { ...m, [f.mapField]: next };
    });
    setInputs((s) => ({ ...s, [f.mapField]: '' }));
    setDirty(true);
  };

  const removeValue = (f: ConfigField, value: string) => {
    setMap((m: any) => ({
      ...m,
      [f.mapField]: (m?.[f.mapField] ?? []).filter((x: any) => (f.mapField === 'rssFeeds' ? x.url !== value : x !== value)),
    }));
    setDirty(true);
  };

  const save = () => {
    if (!map) return;
    setBusy('save');
    const patch: any = { sourceEnabled: map.sourceEnabled ?? {} };
    for (const s of registry) for (const f of s.configFields) if (map[f.mapField] !== undefined) patch[f.mapField] = map[f.mapField];
    api.updateSources(page.id, patch).then((d) => { setMap(d.map); setDirty(false); }).finally(() => setBusy(null));
  };

  const regenerate = () => {
    setBusy('regen');
    api.regenerateSources(page.id).then((d) => { setMap(d.map); setDirty(false); }).finally(() => setBusy(null));
  };

  if (!map) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
        No source map yet for {page.name}.
        <button className="btn btn-surface btn-sm" style={{ marginLeft: 10 }} disabled={busy === 'regen'} onClick={regenerate}>
          <Sparkles size={13} /> Generate with AI
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Sources for <b>{page.name}</b> — toggle, tune, or add your own.
        </span>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={load} title="Reload"><RefreshCw size={13} /></button>
        <button className="btn btn-ghost btn-sm" disabled={busy === 'regen'} onClick={regenerate}><Sparkles size={13} /> Regenerate with AI</button>
        <button className="btn btn-primary btn-sm" disabled={!dirty || busy === 'save'} onClick={save}>Save changes</button>
      </div>

      {registry.map((s) => (
        <div key={s.id} style={{ borderRadius: 10, background: 'var(--bg-elevated)', padding: 14,
          opacity: enabled(s.id) ? 1 : 0.55 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              <input type="checkbox" checked={enabled(s.id)} onChange={() => toggle(s.id)} />
              {s.label}
            </label>
            {s.needsKey && (
              <span className={`badge ${keyPresent[s.id] ? 'badge-green' : 'badge-amber'}`} title={s.needsKey.label}>
                {keyPresent[s.id] ? 'key set' : 'key missing'}
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.description}</span>
          </div>
          {enabled(s.id) && s.configFields.map((f) => (
            <div key={f.mapField} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>{f.label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {fieldValues(f).map((v) => (
                  <span key={v} className="badge badge-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {v}
                    <X size={10} style={{ cursor: 'pointer' }} onClick={() => removeValue(f, v)} />
                  </span>
                ))}
                <input className="search-input" style={{ width: 220, fontSize: 11 }}
                  placeholder={f.placeholder ?? 'add…'}
                  value={inputs[f.mapField] ?? ''}
                  onChange={(e) => setInputs((st) => ({ ...st, [f.mapField]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') addValue(f); }} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Mount in SettingsView**

Add a "Sources" entry to NAV_SECTIONS (its own group or under Pipeline —
match the file's grouping structure) rendering `<SourcesPanel page={...} />`.
SettingsView needs the ACTIVE PAGE — check what props SettingsView receives
(App renders `<SettingsView/>` with none) — pass `page={currentPage}` from
App.tsx (add the prop, optional to avoid breaking other usages) OR let
SourcesPanel fetch pages itself and include a page selector dropdown
(cleaner given SettingsView takes no props today — CHOOSE the page-selector
approach: `api.getPages()` on mount, dropdown at the top, default first
page). Report the choice.

- [ ] **Step 3: Gates + build + commit**

Gates + `npm run build` (+ restore dist-web). Visual smoke via vite +
curl as in prior sprints.

```bash
git add -A && git commit -m "feat(sources): registry-driven Sources settings panel — toggles, config chips, custom feeds, AI regenerate"
```

---

### Task 5: Custom niches + wizard step

**Files:**
- Modify: `src/api/server.ts` (POST /api/niches)
- Modify: `src/services/repositories.ts` (createNiche)
- Modify: `src/web/components/modals/CreatePageModal.tsx`
- Modify: `src/web/App.tsx` (onCreate flow — READ App.tsx:200-225 first)
- Modify: `src/web/lib/api.ts` (createNiche client)

- [ ] **Step 1: Repository + route**

`src/services/repositories.ts`:

```ts
export async function createNiche(opts: {
  name: string; keywords: string[]; monetizationKeywords: string[];
  negativeKeywords: string[]; targetPersona: string;
}): Promise<Niche> {
  const result = await query(
    `INSERT INTO niches (name, keywords, monetization_keywords, negative_keywords, target_persona)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [opts.name.trim(), opts.keywords, opts.monetizationKeywords, opts.negativeKeywords, opts.targetPersona.trim()]
  );
  return mapNiche(result.rows[0]);
}
```

`src/api/server.ts` (zod-validated like sibling POST routes — READ one for
the idiom):

```ts
app.post("/api/niches", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(2),
      keywords: z.array(z.string().min(1)).min(2),
      monetizationKeywords: z.array(z.string()).default([]),
      negativeKeywords: z.array(z.string()).default([]),
      targetPersona: z.string().min(3),
    }).parse(req.body);
    const { createNiche } = await import("../services/repositories.js");
    const { normalizeKeywords } = await import("../domain/keywords.js");
    const niche = await createNiche({
      ...body,
      keywords: normalizeKeywords(body.keywords),
      monetizationKeywords: normalizeKeywords(body.monetizationKeywords),
      negativeKeywords: normalizeKeywords(body.negativeKeywords),
    });
    res.json({ ok: true, niche });
  } catch (err) { next(err); }
});
```

Client (`src/web/lib/api.ts`, same idiom as updateSources in Task 3):

```ts
  createNiche: (body: any) => req<any>('/niches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
```

- [ ] **Step 2: CreatePageModal custom-niche path**

READ the modal fully. Add a "+ Custom niche" card at the end of the niche
grid; selecting it reveals inputs: niche name, keywords (comma-separated),
target persona, monetization keywords (comma-separated, optional). On
create-with-custom: call `api.createNiche(...)` first, use the returned
`niche.id` as `nicheId` in the existing `onCreate` payload. After page
creation succeeds (App's onCreate handler — READ it; it calls the
create-page API), fire `api.regenerateSources(newPageId)` fire-and-forget
and show a toast/note: "Sources are being generated — review them in
Settings → Sources." (If App's handler doesn't expose the new page id,
add it to whatever the create-page API returns; READ `POST /api/pages` in
server.ts.)

- [ ] **Step 3: Gates + live check + commit**

Live: POST /api/niches with a test niche → row exists (then DELETE it);
zod rejects 1-keyword bodies (400).

```bash
git add -A && git commit -m "feat(niches): custom niche creation — API + wizard path in CreatePageModal + auto source-map"
```

---

### Task 6: Tunables — overrides setters + Advanced settings (TDD)

**Files:**
- Modify: `src/domain/automation.ts`, `src/domain/scoring.ts` (setters)
- Modify: `src/config/configStore.ts` (2 new keys)
- Modify: `src/worker/index.ts` + `src/api/server.ts` (boot wiring)
- Create: `src/web/components/settings/AdvancedTuning.tsx` (+ mount like Task 4)
- Test: `tests/overrides.test.ts`

- [ ] **Step 1: Failing test**

`tests/overrides.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  applyAutomationOverrides, getAutomationThresholds,
} from "../src/domain/automation.js";
import {
  applySourceQualityOverrides, sourceQualityMultiplier,
} from "../src/domain/scoring.js";

afterEach(() => {
  applyAutomationOverrides(null);        // null = reset to defaults
  applySourceQualityOverrides(null);
});

describe("applyAutomationOverrides", () => {
  it("applies partial overrides and reports effective values", () => {
    applyAutomationOverrides({ reactEngagementMultiplier: 2.0 });
    const t = getAutomationThresholds();
    expect(t.reactEngagementMultiplier).toBe(2.0);
    expect(t.recycleCooldownDays).toBe(30); // untouched default
  });
  it("clamps to sane ranges and ignores non-finite values", () => {
    applyAutomationOverrides({ reactEngagementMultiplier: -5, recycleCooldownDays: NaN } as any);
    const t = getAutomationThresholds();
    expect(t.reactEngagementMultiplier).toBeGreaterThanOrEqual(1);
    expect(t.recycleCooldownDays).toBe(30);
  });
  it("null resets to defaults", () => {
    applyAutomationOverrides({ trendVelocityFloor: 0.1 });
    applyAutomationOverrides(null);
    expect(getAutomationThresholds().trendVelocityFloor).toBe(0.8);
  });
});

describe("applySourceQualityOverrides", () => {
  it("overrides one source, leaves others", () => {
    applySourceQualityOverrides({ reddit: 1.4 });
    expect(sourceQualityMultiplier("reddit")).toBe(1.4);
    expect(sourceQualityMultiplier("hacker_news")).toBe(1.3);
  });
  it("clamps to [0.1, 3] and resets on null", () => {
    applySourceQualityOverrides({ rss: 99 });
    expect(sourceQualityMultiplier("rss")).toBeLessThanOrEqual(3);
    applySourceQualityOverrides(null);
    expect(sourceQualityMultiplier("rss")).toBe(0.95);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement setters**

`src/domain/automation.ts`: convert the seven exported consts into a
defaults object + live object + accessors, PRESERVING the existing exported
constant names as getters is impossible for `const` — instead: keep the
exported names but make them read through the live object at CALL time.
The predicates already read the constants internally — change them to read
`T.reactEngagementMultiplier` etc.:

```ts
const DEFAULTS = {
  reactEngagementMultiplier: 1.5,
  reactMinSamples: 3,
  recycleCooldownDays: 30,
  recycleMinMultiplier: 1.5,
  trendSpikeSources: 2,
  trendWindowHours: 6,
  trendVelocityFloor: 0.8,
} as const;
export type AutomationThresholds = { -readonly [K in keyof typeof DEFAULTS]: number };
let T: AutomationThresholds = { ...DEFAULTS };

const CLAMPS: Record<keyof AutomationThresholds, [number, number]> = {
  reactEngagementMultiplier: [1, 10], reactMinSamples: [1, 100],
  recycleCooldownDays: [1, 365], recycleMinMultiplier: [1, 10],
  trendSpikeSources: [1, 20], trendWindowHours: [1, 72], trendVelocityFloor: [0, 1],
};

/** Apply partial overrides (clamped); null resets all to defaults. */
export function applyAutomationOverrides(partial: Partial<AutomationThresholds> | null): void {
  if (partial === null) { T = { ...DEFAULTS }; return; }
  for (const [key, value] of Object.entries(partial) as Array<[keyof AutomationThresholds, number]>) {
    if (!(key in DEFAULTS) || !Number.isFinite(value)) continue;
    const [lo, hi] = CLAMPS[key];
    T[key] = Math.min(hi, Math.max(lo, value));
  }
}
export function getAutomationThresholds(): AutomationThresholds { return { ...T }; }
```

Update the three predicates to use `T.*`. The old exported constants
(`REACT_ENGAGEMENT_MULTIPLIER` etc.) have OTHER importers (tests from
Sprint C, maybe services) — grep; keep exporting them as the DEFAULT values
(document: "default, see getAutomationThresholds() for effective") so
existing imports still compile; existing Sprint C tests assert against
defaults so they stay green.

`src/domain/scoring.ts`: same pattern around `SOURCE_QUALITY_MULTIPLIER` —
a `let overrides: Record<string, number> = {}` consulted by
`sourceQualityMultiplier` (override → clamp [0.1, 3] → else table → 1.0),
plus `applySourceQualityOverrides(map | null)`.

- [ ] **Step 3: configStore keys + boot wiring**

`configStore.ts`: extend `ConfigKey` union + `CONFIG_META` with
`AUTOMATION_THRESHOLDS` (JSON, default `""`) and
`SOURCE_QUALITY_OVERRIDES` (JSON, default `""`) — follow the exact meta
shape of existing entries (READ a few).

Boot wiring — in BOTH `src/worker/index.ts` and `src/api/server.ts`
startup (top-level, after imports):

```ts
// Apply user tuning overrides from the config store (JSON strings).
try {
  const at = configStore.get("AUTOMATION_THRESHOLDS");
  if (at) applyAutomationOverrides(JSON.parse(at));
  const sq = configStore.get("SOURCE_QUALITY_OVERRIDES");
  if (sq) applySourceQualityOverrides(JSON.parse(sq));
} catch (err) { console.warn(`[config] invalid tuning overrides ignored: ${err}`); }
```

(static imports of the two apply fns; configStore already imported in both.)

- [ ] **Step 4: Advanced settings UI**

`src/web/components/settings/AdvancedTuning.tsx`: fetches current values
via the EXISTING settings/config API (READ how SettingsView loads/saves
configStore values — there is a settings section with per-section save;
reuse `api` methods it uses). Renders: 7 numeric inputs (labels + the
default in parentheses) bound to a local JSON object serialized into
`AUTOMATION_THRESHOLDS`, and a small table of source→multiplier numeric
inputs (rows from a hardcoded list of the 15 registry ids + google_trends/
twitter) into `SOURCE_QUALITY_OVERRIDES`; "Reset to defaults" clears both
keys (save empty string). Note under the section: "Workers pick up changes
on next restart." Mount as an "Advanced" settings section like Task 4's
panel. Keep it plain — no cleverness.

- [ ] **Step 5: Gates + commit**

`npx vitest run` (129: 124 + 5 override tests) — Sprint C automation tests must still
pass (they use default constants). tsc + build.

```bash
git add -A && git commit -m "feat(tuning): automation + source-quality overrides via configStore with Advanced settings UI"
```

---

### Task 7: Packaging — Docker, prod serving, dist migrations, API token

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `scripts/docker-entrypoint.sh`
- Modify: `docker-compose.yml` (app services, profile "full")
- Modify: `src/db/migrate.ts` (dist-aware dir resolution)
- Modify: `src/api/server.ts` (static serving + token middleware)
- Modify: `src/web/lib/api.ts` (attach token)
- Modify: `package.json` (start scripts)

- [ ] **Step 1: dist-aware migrations**

In `src/db/migrate.ts`, replace the MIGRATIONS_DIR constant with resolution:

```ts
function resolveMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "migrations"),                      // tsx: src/db/migrations
    path.join(here, "../../../src/db/migrations"),      // dist/src/db → repo src fallback
  ];
  for (const c of candidates) { try { if (fsSync.existsSync(c)) return c; } catch {} }
  return candidates[0];
}
const MIGRATIONS_DIR = resolveMigrationsDir();
```

(`import fsSync from "node:fs"` alongside the promises import.) Update the
existing "dist trap" comment to describe the new resolution + env override.

- [ ] **Step 2: Prod static serving + token middleware**

In `src/api/server.ts` — token middleware BEFORE routes (after
helmet/cors/json — READ the middleware stack order):

```ts
// Optional single-user API token (self-host). Unset = open (local dev).
const API_TOKEN = process.env.API_TOKEN;
if (API_TOKEN) {
  app.use("/api", (req, res, next) => {
    if (req.path === "/health") return next();
    const auth = req.headers.authorization;
    if (auth === `Bearer ${API_TOKEN}`) return next();
    res.status(401).json({ error: "unauthorized" });
  });
}
```

Static serving AFTER all API routes, before the error handler:

```ts
if (env.NODE_ENV === "production") {
  const webDist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../dist-web");
  app.use(express.static(webDist));
  app.get(/^\/(?!api|uploads|media|queues).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}
```

(READ what static prefixes exist — /uploads, /media are served; exclude
them + /queues bull board from the SPA fallback. Adapt path resolution to
the compiled layout: dist/src/api/server.js → ../../../dist-web is repo
dist-web when running from dist; verify against the Dockerfile layout in
step 3 and set accordingly, env override `WEB_DIST` allowed.)

Client (`src/web/lib/api.ts`) — in the shared `req<T>()` helper, attach:

```ts
const token = localStorage.getItem('tpce_token');
if (token) headers['Authorization'] = `Bearer ${token}`;
```

(READ the helper; merge with existing headers handling.) On a 401 response,
`throw` as today — plus Settings gains a simple "API token" text field
persisted to localStorage (add to an existing credentials section; small).

- [ ] **Step 3: Dockerfile + compose + entrypoint**

`Dockerfile`:

```dockerfile
# ── build ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-web ./dist-web
COPY --from=build /app/src/db/migrations ./src/db/migrations
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh
ENV MIGRATIONS_DIR=/app/src/db/migrations
EXPOSE 4000
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
```

`scripts/docker-entrypoint.sh`:

```bash
#!/usr/bin/env sh
set -e
node dist/scripts/migrate.js
case "${TPCE_ROLE:-api}" in
  api)    exec node dist/src/api/server.js ;;
  worker) exec node dist/src/worker/index.js ;;
  *) echo "TPCE_ROLE must be api or worker" >&2; exit 1 ;;
esac
```

(VERIFY `npm run build`'s tsc output layout — does dist contain
`dist/scripts/migrate.js` and `dist/src/api/server.js`? Check
tsconfig.json `include`/`outDir`; scripts/ may not be compiled — if not,
add scripts to tsconfig include or run migrations via a small compiled
entry `dist/src/db/runMigrationsCli.js` you create in src/db/ instead.
Adapt and report.)

`.dockerignore`: node_modules, dist, dist-web, data, .env*, Imgs, docs,
.git.

`docker-compose.yml` — append (READ the existing services for network/env
names; postgres/redis service names + креds):

```yaml
  app-api:
    build: .
    profiles: ["full"]
    environment:
      - DATABASE_URL=postgres://theme:theme@postgres:5432/theme_engine
      - REDIS_URL=redis://redis:6379
      - TPCE_ROLE=api
    ports: ["4000:4000"]
    depends_on: [postgres, redis]
  app-worker:
    build: .
    profiles: ["full"]
    environment:
      - DATABASE_URL=postgres://theme:theme@postgres:5432/theme_engine
      - REDIS_URL=redis://redis:6379
      - TPCE_ROLE=worker
    depends_on: [postgres, redis]
```

(Adapt hostnames/env to the real compose file — the DB user/db name are
theme/theme_engine per .env; inside the compose network the host is the
service name.)

- [ ] **Step 4: Verify + commit**

- Gates green; `API_TOKEN=secret npx tsx src/api/server.ts` → /api/health
  200 without token, /api/topics 401 without / 200 with Bearer secret; then
  unset → open. 
- `docker build -t tpce-test .` → succeeds (report duration; if the
  environment can't build images, report BLOCKED-on-docker for this step
  only and verify the entrypoint pieces by running the compiled outputs
  directly: `npm run build && MIGRATIONS_DIR=src/db/migrations node dist/scripts/migrate.js` equivalent).
- `NODE_ENV=production node dist/src/api/server.js` serves the UI at :4000
  (curl / → index.html) — run after `npm run build` WITHOUT restoring
  dist-web first, then `git checkout -- dist-web`.

```bash
git add -A && git commit -m "feat(deploy): Dockerfile + compose full profile, prod static serving, dist migrations, optional API token"
```

---

### Task 8: Docs for strangers + E2E

**Files:**
- Create: `LICENSE`, `SECURITY.md`
- Modify: `README.md`, `.env.example`, `docs/ARCHITECTURE.md`, `docs/API.md`

- [ ] **Step 1: LICENSE + SECURITY**

`LICENSE`: full AGPL-3.0 text (fetch from https://www.gnu.org/licenses/agpl-3.0.txt — do not paraphrase).
`SECURITY.md` (short): single-user scope; tokens stored unencrypted in the
local DB/config — do not expose the API publicly without API_TOKEN +
reverse-proxy TLS; report issues via GitHub issues.

- [ ] **Step 2: README rewrite**

Structure: what TPCE is (3 sentences + the pipeline in one line) → Quickstart
(clone → `cp .env.example .env` → `docker compose --profile full up` → open
:4000 → create page via wizard → Settings→Sources review) → Dev setup
(existing npm run dev flow) → BYOK keys table (which features need which
env keys, all optional) → Configuration (Sources UI, Advanced tuning,
API_TOKEN) → Architecture pointer to docs/ → License note (AGPL-3.0).
Audit `.env.example`: every env var referenced in `src/config/env.ts` and
the registry's needsKey entries present with a comment; no real values.

- [ ] **Step 3: E2E**

1. Custom niche flow: POST /api/niches (test niche) → create page via
   existing POST /api/pages (READ its shape) → regenerate sources → GET
   sources shows map; PUT toggles medium off + adds a custom RSS feed →
   run ingest job → worker log shows medium skipped and the custom feed
   fetched (or errored gracefully). Clean up niche/page.
2. Tuning: set `AUTOMATION_THRESHOLDS` `{"reactEngagementMultiplier":99}`
   via the settings API, restart worker, re-run the Sprint C reactor
   fixture (boost a 1h metric) → NO cross_post fires (threshold
   unreachable); reset key, re-verify normal (claim table blocks re-fire —
   use a FRESH fixture job id for the positive check or just verify the
   negative + unit coverage).
3. Full gates + double db:init.

- [ ] **Step 4: Docs update + final commit**

ARCHITECTURE.md: new "12. Configurability & self-host" module note (source
registry/map, tunables, Docker roles). API.md: the three sources routes,
POST /niches, dismiss note already there, API_TOKEN note.

```bash
git add -A && git commit -m "feat: universal self-host — sources UI, custom niches, tuning, Docker, AGPL docs"
```
