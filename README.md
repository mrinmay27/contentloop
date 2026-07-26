# Theme Page Content Engine (TPCE)

TPCE is a self-hosted content-operations tool for running "theme page" social
accounts (Instagram, YouTube Shorts, and similar) without babysitting every
step by hand. It watches trend sources for your niche, scores what's worth
writing about, drafts captions/reels/carousels with an LLM (or a
deterministic fallback if you don't have one), and learns from what actually
performs — but nothing goes out the door without you approving it first.

**Pipeline:** ingest → score → generate → QA → **you approve** → publish → learn

## Quickstart (Docker)

```bash
git clone <this-repo-url>
cd theme-page-content-engine
cp .env.example .env
docker compose --profile full up
```

This starts Postgres, Redis, the API, and a worker in one command, runs
migrations automatically, and serves the built dashboard from the API
process — no separate frontend server needed.

Open **http://localhost:4000**, walk through the wizard to create your first
page (pick a built-in niche or define a custom one), then check
**Settings → Sources** to see what TPCE will actually pull from for that
page and tune it.

> **Note on keys with Docker:** `docker compose --profile full up` only
> forwards `DATABASE_URL`, `REDIS_URL`, and `TPCE_ROLE` into the `app-api` /
> `app-worker` containers — it does **not** auto-forward the rest of your
> `.env` file into those containers. The simplest path is to leave `.env`
> mostly empty and enter optional provider keys through the in-app
> **Settings** page once TPCE is running (see BYOK table below); those are
> stored in `data/app.config.json` inside the container. If you'd rather
> drive everything from `.env`, add `env_file: .env` to the `app-api` and
> `app-worker` services in `docker-compose.yml`.

TPCE runs perfectly well with **no keys at all**: content generation falls
back to a deterministic template, scoring falls back to keyword-only
matching, and every ingestion source that needs a credential is simply
skipped (see the BYOK table below for which ones those are).

## Desktop mode (no Docker)

For a single user who'd rather not run containers at all:

```bash
npm install
npm run build
npm run desktop
```

This boots an embedded Postgres cluster inside your OS's app-data folder
(override with `TPCE_DATA_DIR`), applies migrations, and serves the built
dashboard — all from one process, no Redis. Background jobs run in-process
on an elapsed-time schedule (not wall-clock cron) with a catch-up pass at
launch, so a post scheduled for 17:00 still goes out the next time you open
the app, even if that's 10am the next day. Open **http://localhost:4173**
(override with `PORT`).

First launch takes about a minute while Postgres initializes; later
launches reuse the existing cluster and are up in well under 30 seconds.
The Docker quickstart above is still the better fit for multi-page/team
deployments — desktop mode is the easiest path for running TPCE for
yourself.

## Dev setup

For active development (hot reload, no Docker image build):

```bash
npm install
cp .env.example .env   # optional — dev defaults work keyless
npm run dev
```

`npm run dev` starts Postgres/Redis via Docker Compose for you, applies
pending migrations automatically, then runs the API, worker, and Vite dev
server together. Open **http://localhost:5173** for the dashboard (the API
listens separately on `:4000`). `npm run seed` will additionally load two
demo niches/pages if you want sample data instead of starting from the
wizard.

```bash
npm run db:init      # apply migrations (also run automatically by npm run dev)
npm run seed         # optional: seed 2 demo niches / 4 demo pages
npm run dev           # API + worker + dashboard, hot reload
npm test              # vitest suite
npm run build         # type-check + build the dashboard (dist-web/)
```

## BYOK — bring your own keys (all optional)

TPCE is keyless by default. Every credential below unlocks one specific
feature; nothing is required to run the pipeline end-to-end in dry-run.

| Env var | Unlocks | Without it |
|---|---|---|
| `LLM_API_KEY` (+ `LLM_PROVIDER`, `LLM_MODEL`) or `OPENAI_API_KEY` | Real LLM content generation (reel scripts, carousels, captions, format suggestion) via Groq, OpenAI, OpenRouter, or any OpenAI-compatible endpoint | Deterministic template-based generation — no live LLM calls |
| `YOUTUBE_API_KEY` | YouTube Trends ingestion source | Source is skipped |
| `EXPLODING_TOPICS_API_KEY` | Exploding Topics ingestion source (Pro tier) | Source is skipped |
| `PRODUCT_HUNT_TOKEN` | Higher rate limits on Product Hunt ingestion | Source still runs, unauthenticated (public API), lower limits |
| `PEXELS_API_KEY` | Stock B-roll footage for rendered Reels | Rendering falls back without stock footage |
| `INSTAGRAM_ACCESS_TOKEN` (or Settings → Publishing → Instagram OAuth) | Live Instagram publishing | Publishing stays in dry-run/stub mode |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | YouTube Shorts OAuth publishing | Publishing stays in dry-run/stub mode |
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` | Canva OAuth for brand asset export | Feature unavailable |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Marks Reddit as "connected" in Settings | Reddit ingestion already works keyless (public JSON endpoint) — these are for future authenticated use |
| `API_TOKEN` | Requires a bearer token on `/api/*` (self-host security) | API is open — fine for local dev, **not** for a public deployment (see `SECURITY.md`) |

Every other ingestion source (Reddit, RSS, Google News, Medium, Hacker News,
Dev.to, Substack, arXiv, crypto news, PubMed, finance newsletters) works
out of the box with no credentials. Additional per-provider keys (extra LLM
providers, image-generation providers, YouTube/Instagram OAuth apps) can be
configured entirely through the Settings UI instead of `.env` — see
`.env.example` for the full list of what's read from environment variables.

## Configuration

- **Settings → Sources**: per-page, per-source control — toggle any of the
  14 ingestion sources on/off, edit their subreddits/tags/search
  phrases/feed lists, add your own custom RSS feeds, and regenerate the
  whole map with AI. Backed by `GET/PUT /api/pages/:id/sources` and
  `POST /api/pages/:id/sources/regenerate`.
- **Settings → Advanced**: tuning knobs that used to be hardcoded constants
  — automation thresholds (react/recycle/trend-alert sensitivity) and
  per-source scoring quality multipliers — plus the self-host API token
  field. Workers pick up changes on their next restart.
- **`API_TOKEN`**: unset by default (open API, matching local-dev
  behavior). Set it before exposing TPCE beyond `localhost` — see
  `SECURITY.md`.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full module
breakdown (ingestion, scoring, generation, QA, media/render, scheduler,
feedback loop, growth automation, and self-host configurability) and
[`docs/API.md`](docs/API.md) for the HTTP API reference.

## License

AGPL-3.0 — see [`LICENSE`](LICENSE). In short: you're free to run, modify,
and redistribute TPCE, but if you run a modified version as a network
service for others, you must make that modified source available to them
too.
