# Theme Page Content Engine

Production-ready MVP for semi-automated theme-page content operations:

- trend ingestion from Google Trends, Reddit, RSS, and Twitter/X-compatible keyword feeds
- niche-aware topic scoring
- LLM content generation for Reels, carousels, captions, and hashtags
- quality gates before approval
- Redis queue workers for ingestion, generation, scheduling, and metric analysis
- manual approval before posting
- basic React dashboard

## Quick Start

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:init
npm run seed
npm run dev
```

Open:

- Dashboard: http://localhost:5173
- API health: http://localhost:4000/api/health
- Queue board: http://localhost:4000/queues

## MVP Boundaries

This project intentionally supports two seeded niches and two pages per niche. Posting adapters run in dry-run mode by default. Set `POSTING_DRY_RUN=false` only after adding platform credentials and validating platform policies/rate limits.

## Main Commands

```bash
npm run db:init      # create schema
npm run seed         # seed 2 niches and 4 pages
npm run dev          # API + worker + dashboard
npm test             # scoring and scheduler unit tests
npm run build        # type-check and build dashboard
```
