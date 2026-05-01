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

`GET /posts`

## Approval

`POST /content/:id/approve`

`POST /content/:id/reject`

## Scheduling

`POST /schedule/approved`

Schedules all approved content items that do not already have a post.
