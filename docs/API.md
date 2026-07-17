# API

Base URL: `http://localhost:4000/api`

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

`GET /pages`

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

## Approval

`POST /content/:id/approve`

`POST /content/:id/reject`

## Scheduling

`POST /schedule/approved`

Schedules all approved content items that do not already have a publish job.
