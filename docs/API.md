# API

Base URL: `http://localhost:4000/api`

If the server was started with `API_TOKEN` set (see `.env.example` /
`SECURITY.md`), every route below except `/health` requires
`Authorization: Bearer <API_TOKEN>`; unset (the default) leaves the API
open, matching local-dev behavior.

## Health

`GET /health`

## Pipeline Jobs

`POST /jobs/ingest`

`POST /jobs/score`

`POST /jobs/generate`

`POST /jobs/post`

`POST /jobs/analyze`

## Dashboard Data

`GET /stats`

`GET /niches`

`POST /niches`

Creates a custom niche: `{name, keywords (>=2), targetPersona, monetizationKeywords?, negativeKeywords?}`. Used by the wizard's "+ Custom niche" path. 400 on validation failure, 409 if the name already exists.

`GET /pages`

`POST /pages`

Creates a page under a niche: `{nicheId, name, platform?, handle?, brand?}`. 400 on validation failure or unknown `nicheId`, 409 on a duplicate handle within the niche.

`GET /topics`

`GET /content`

`GET /pages/:id/analytics`

Per-post metrics (1h/24h/7d capture points) plus content-type breakdown and a `simulated` flag.

`GET /pages/:id/learning`

Learned keyword/format signals for the page's niche, plus `mode` (`real` | `simulated`).

`GET /alerts`

Automation activity feed (cross-posts, fast-tracks, recycles, trend alerts) plus unseen count.

`POST /alerts/seen`

Marks all feed events as seen.

`GET /inbox`

Aggregated inbox payload: needs-you items (drafts + failed publishes), activity with outcome chips, since-yesterday digest, next scheduled posts.

`PATCH /publish-jobs/:id` also accepts `{"action":"dismiss"}` for failed jobs (404 unknown id, 409 non-failed status).

## Sources (per-page ingestion config)

`GET /pages/:id/sources`

Returns `{registry, map, keyPresent}` — the static `SOURCE_REGISTRY` manifest (every ingestion source, its config fields, and any env key it needs), the page's current `PageSourceMap` (or `null` if never generated), and which `needsKey` env vars are actually set on the server.

`PUT /pages/:id/sources`

Validated partial update (`sourceEnabled` toggles, subreddit/tag/query lists, RSS feed URLs, etc. — see `sourceMapValidation.ts`). 400 on invalid input (e.g. a malformed feed URL), 404 if no source map exists yet (regenerate first).

`POST /pages/:id/sources/regenerate`

Re-runs AI source-map generation for the page and merges the result with any existing user config (enabled/disabled toggles and custom feed overrides survive; the fresh AI-picked subreddits/tags/etc. otherwise win). 404 if the page doesn't exist.

## Approval

`POST /content/:id/approve`

`POST /content/:id/reject`

## Scheduling

`POST /schedule/approved`

Schedules all approved content items that do not already have a publish job.
