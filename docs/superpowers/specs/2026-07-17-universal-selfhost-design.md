# Sprint U1 — Universal Self-Host: Design Spec

> Status: Approved design, 2026-07-17
> Goal: turn TPCE from a personal tool into a shareable open-source content
> engine — sources become user-configurable, opinionated constants become
> settings, and the project becomes installable by a stranger.
> License decision (user-confirmed): **AGPL-3.0**.

## Context (verified)

- `ingestForNiche` ALREADY honors `sourceEnabled` toggles and a per-page
  LLM-generated `PageSourceMap` that overrides subreddits / RSS feeds /
  Substack slugs / dev.to tags / arXiv categories / Medium tags / HN terms.
  The gaps: the map persists in gitignored `data/page-sources.json` (lost on
  fresh installs, invisible to users), has NO UI, and google-news queries +
  finance/crypto newsletter feed lists bypass it entirely.
- Settings UI is a sectioned panel (`SettingsView.tsx`) — a Sources section
  fits the existing pattern.
- `CreatePageModal` picks niches from a STATIC list; custom niches can't be
  created from the UI.
- Deployment is tsx-only; migrations can't run from dist; express does not
  serve the built web app; API has no auth.

## Decisions

1. Source map moves to the DB (`page_source_maps`, migration 007) — the
   disk cache becomes a read-only legacy import path (one-time migration of
   existing data/page-sources.json content at boot if table empty for that
   page).
2. A static `SOURCE_REGISTRY` manifest (id, label, description, category
   hints, needsKey + env var name, which map fields configure it) drives the
   UI generically — adding a future source = registry entry + adapter.
3. The map gains `googleNewsQueries: string[]` and `extraRssFeeds` stays as
   part of `rssFeeds` (user-editable). Finance-newsletter + crypto feed
   lists remain adapter defaults BUT both adapters accept an optional
   override list from the map (`financeFeeds`, `cryptoFeeds` string arrays,
   empty = defaults). Everything a user can see, a user can edit.
4. Custom niches: `POST /api/niches` (name, keywords, monetizationKeywords,
   negativeKeywords, targetPersona) + CreatePageModal gains a "Custom
   niche" path feeding it; page creation then triggers source-map
   generation (existing generateSourceMap) and deep-links to the Sources
   settings section.
5. Tunables move to configStore (existing key/value infra) with current
   values as defaults: `AUTOMATION_THRESHOLDS` (react multiplier/min
   samples, recycle cooldown days/multiplier, trend spike sources/window/
   velocity) and `SOURCE_QUALITY_OVERRIDES` (per-source multiplier map).
   Pure domain modules stay pure: overrides are injected at boot via an
   explicit `applyAutomationOverrides()` / `applySourceQualityOverrides()`
   setter called by worker + api startup. Settings UI exposes them in an
   "Advanced" subsection with reset-to-default.
6. Packaging: multi-stage `Dockerfile` (deps → build → runtime with
   migrations .sql copied and web dist served), compose gains an optional
   `app` service (profile: full) alongside postgres/redis; express serves
   `dist-web` statically in production (NODE_ENV=production + fallback to
   index.html for the SPA); `runMigrations` resolves the migrations dir in
   both tsx and dist layouts.
7. Optional API auth: `API_TOKEN` env — when set, all `/api/*` except
   `/api/health` require `Authorization: Bearer <token>`; the web client
   reads a token from `localStorage` (prompt once via Settings) and attaches
   it. Unset = current open behavior (local dev unchanged).
8. Docs for strangers: README rewritten as a quickstart (docker compose up
   → open UI → wizard), LICENSE file (AGPL-3.0), .env.example audited so
   every variable is documented, SECURITY note (tokens at rest, single-user
   scope).

## Non-goals (deferred)

- Multi-user auth/tenancy (U2). Language-agnostic QA / plugin sources /
  band auto-calibration (U3). Hosted SaaS anything. Per-page posting-slot
  UI. Publishing the repo itself (user does that when ready).

## 1. Data + registry

Migration `007_page_source_maps.sql`:

```sql
CREATE TABLE IF NOT EXISTS page_source_maps (
  page_id    UUID PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  map        JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`src/services/ingestion/sourceRegistry.ts` — `SOURCE_REGISTRY: SourceMeta[]`
where `SourceMeta = { id, label, description, configFields: Array<{ key:
keyof PageSourceMap-ish, label, kind: 'strings' | 'feeds' }>, needsKey?:
{ env: string, label: string }, categories?: string[] }`. All 15 dispatched
source ids covered (reddit, rss, google_news, medium, hacker_news, devto,
substack, arxiv, crypto_news, pubmed, exploding_topics, product_hunt,
finance_newsletter, youtube_trends — plus google_trends/twitter if still
dispatched; verify against ingestForNiche and list exactly what exists).

`tag-generator.ts`: cache functions become DB-backed (async), JSON file
read once as seed. `PageSourceMap` gains `googleNewsQueries?`,
`financeFeeds?`, `cryptoFeeds?`.

`ingestForNiche`: google-news uses `cachedMap?.googleNewsQueries ??
GOOGLE_NEWS_QUERIES[category]`; finance/crypto adapters take optional
override lists.

## 2. Sources API

- `GET /api/pages/:id/sources` → `{ registry: SourceMeta[], map:
  PageSourceMap | null, effective: {...} }` where `effective` shows the
  values actually used (map override or category default) per source so the
  UI can display fallbacks grayed-out.
- `PUT /api/pages/:id/sources` → body = partial map (toggles + config
  arrays); validated (urls must parse for feeds), persisted to DB.
- `POST /api/pages/:id/sources/regenerate` → force `generateSourceMap`
  (existing) and return the fresh map.

## 3. Sources UI

New Settings section "Sources" (per selected page): one card per registry
entry — toggle, description, key-status pill when `needsKey` (reads whether
env var is present via existing settings plumbing), and editable chip-lists
for its configFields (add/remove strings; feeds validated as URLs).
"Regenerate with AI" button + unsaved-changes save bar consistent with the
existing per-section save pattern in SettingsView.

## 4. Custom niches + wizard step

- `POST /api/niches` (validated via zod like sibling routes) + niches list
  already served. CreatePageModal: alongside the static niche grid, a
  "Create custom niche" toggle revealing name/keywords/persona/monetization
  fields; submit creates niche then page as today; afterwards call
  regenerate-sources for the new page and show a toast linking to
  Settings → Sources.

## 5. Tunables

- configStore keys (JSON strings): `AUTOMATION_THRESHOLDS`,
  `SOURCE_QUALITY_OVERRIDES`.
- `src/domain/automation.ts`: constants become `let` internals with an
  exported `applyAutomationOverrides(partial)` (validated, clamped to sane
  ranges) — called at worker boot; `src/domain/scoring.ts` same for
  `applySourceQualityOverrides(map)`.
- Settings "Advanced" subsection: numeric inputs for the seven automation
  thresholds + a per-source multiplier editor; reset buttons; values load
  from/save to configStore; worker picks up changes on next boot (document
  this — no hot reload; acceptable).

## 6. Packaging + auth + docs

- `Dockerfile`: stage 1 npm ci + build (tsc + vite); stage 2 node:22-slim
  with dist, dist-web, src/db/migrations/*.sql copied to a path
  `runMigrations` can resolve from dist (make MIGRATIONS_DIR check both
  `../db/migrations` relative to compiled file AND `src/db/migrations`
  fallback; or env `MIGRATIONS_DIR`). Entrypoint runs migrations then
  `node dist/src/api/server.js` + `node dist/src/worker/index.js`
  (supervisor: simple `node scripts/start-all.js` spawning both, or two
  compose services from the same image — choose two services, cleaner).
- compose: `app-api` + `app-worker` services under `profiles: ["full"]` so
  `docker compose up` stays infra-only for dev, `--profile full` runs
  everything.
- server.ts: when `NODE_ENV=production`, serve `dist-web` static + SPA
  fallback (after API routes).
- API_TOKEN middleware + web client attach (api.ts reads
  `localStorage.tpce_token`; Settings gains a field to set it; 401s surface
  a toast prompting for it).
- README quickstart rewrite, LICENSE (AGPL-3.0 full text), .env.example
  audit, brief SECURITY.md.

## Testing

- Pure: registry completeness vs dispatched sources (test asserts every
  isEnabled() id in ingestForNiche has a registry entry — greppable list
  kept in sync by test); overrides setters (clamping, partial application,
  reset); map merge/validation logic for PUT.
- E2E dry-run: create custom niche + page via API → regenerate sources →
  toggle a source off + add a custom RSS feed via PUT → run ingest →
  verify the toggled source absent and custom feed hit (log check);
  automation threshold override changes reactor behavior (set multiplier
  99 → previously-firing fixture no longer fires); docker build succeeds
  and boots migrations (build-only check acceptable if slow).
