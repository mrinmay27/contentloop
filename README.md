<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-dark.png">
    <img src="public/logo.png" alt="ContentLoop" width="320">
  </picture>
</p>

<p align="center">
  <em>Discover → score → draft → publish → <strong>learn</strong> → repeat.</em><br>
  A self-hosted content engine for theme pages that gets smarter from your own results.<br>
  <em>Or skip discovery entirely and use it as a video editor, scheduler and publisher.</em>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-20%2B-brightgreen">
  <img alt="tests" src="https://img.shields.io/badge/tests-387%20passing-brightgreen">
</p>

ContentLoop is a self-hosted content-operations tool for running "theme page" social
accounts (Instagram, YouTube Shorts, and similar) without babysitting every
step by hand. It watches trend sources for your niche, scores what's worth
writing about, drafts captions/reels/carousels with an LLM (or a
deterministic fallback if you don't have one), and learns from what actually
performs — but nothing goes out the door without you approving it first.

**Pipeline:** ingest → score → generate → QA → **you approve** → publish → learn

**Or don't use the pipeline at all.** Set a page to *manual* and ContentLoop
stops looking for topics — you add them yourself and use it purely as an
editor, scheduler and publisher. Per page, so one page can be manual while
another stays automatic. Everything downstream is identical either way.

## Get started (no terminal needed)

**Option A — download and run**

1. Download the file for your computer from the
   [latest release](https://github.com/mrinmay27/contentloop/releases/latest):
   `…macos-arm64.zip`, `…windows-x64.zip` or `…linux-x64.zip`
2. Unzip it.
3. Double-click **Start ContentLoop**.

Your browser opens when it's ready. Everything runs on your own computer.

> **macOS only, first time:** if you see *"cannot be opened because it is from
> an unidentified developer"*, right-click **Start ContentLoop** → **Open** →
> **Open**. You only do this once. (ContentLoop is free and open-source, so it
> isn't signed with a paid Apple certificate — this is macOS's normal warning
> for that, not a sign anything is wrong.)

**Option B — clone the repo** (no security prompt, needs internet on first run)

```bash
git clone https://github.com/mrinmay27/contentloop.git
cd contentloop
```

Then double-click **Start ContentLoop.command** (macOS),
**Start ContentLoop.bat** (Windows) or **start-contentloop.sh** (Linux).
The first launch downloads Node.js and installs ContentLoop (a few minutes);
later launches take seconds.

### What you need

Nothing to install — no Docker, no Node.js, no database. ContentLoop bundles
its own Postgres and runs entirely on your machine.

AI features (writing captions and scripts, matching sources to your niche) need
a free API key from Groq or Google AI Studio, which you paste into **Settings**
after the app opens. Without a key everything still runs — discovery, scoring,
scheduling, video and publishing all work, with simpler generated text. In
manual mode you can run with no key at all.

> **Tested on:** macOS (Apple Silicon). The Windows and Linux launchers are
> built and installed by CI on those platforms, but have not been hand-tested
> — please open an issue if something breaks.

---

## Making video

Four ways to put video in a reel, all landing in the same place and rendered
the same way:

| Route | What it is | Needs |
|---|---|---|
| **Stock video** | Real Pexels footage behind your captions, searchable and pickable per slide, with photographer attribution | Free Pexels key |
| **Your own footage** | Upload what you filmed; captions are transcribed with Whisper and burned in | Groq key for auto-captions, or type them |
| **AI-generated** | Build a prompt, generate in Google AI Studio (Veo), Canva, Higgsfield, Runway or Luma on a subscription you already pay for, then drop the file back in | Your own subscription — no API cost |
| **Canva** | Autofill a branded template, export, and use it as the whole reel or one slide's background | Canva account |

Posts and carousels work the same way, with generated or pasted images and a
configurable slide count.

---

## Publishing

| Platform | Status |
|---|---|
| Instagram | Working — verified end to end |
| YouTube Shorts | Working — verified end to end on a live channel |
| LinkedIn, X, Reddit, Facebook | Not implemented |

Nothing publishes without you approving it first, in either mode. Uploads
default to **private** on YouTube, so a first post never lands in front of an
audience by accident.

**Performance data comes back from Instagram and YouTube.** Views, likes and
comments are read back automatically and feed the learning loop. Platforms
with no provider record nothing at all rather than inventing numbers, and the
Performance page says so instead of showing a zero that reads like a flop.

---

## Quickstart (Docker)

For servers, teams, or anyone who already runs containers:

```bash
git clone https://github.com/mrinmay27/contentloop.git
cd contentloop
cp .env.example .env
docker compose --profile full up
```

This starts Postgres, Redis, the API, and a worker in one command, runs
migrations automatically, and serves the built dashboard from the API
process — no separate frontend server needed.

Open **http://localhost:4000**, walk through the wizard to create your first
page (pick a built-in niche or define a custom one), then check
**Settings → Sources** to see what ContentLoop will actually pull from for that
page and tune it.

> **Note on keys with Docker:** `docker compose --profile full up` only
> forwards `DATABASE_URL`, `REDIS_URL`, and `CONTENTLOOP_ROLE` into the `app-api` /
> `app-worker` containers — it does **not** auto-forward the rest of your
> `.env` file into those containers. The simplest path is to leave `.env`
> mostly empty and enter optional provider keys through the in-app
> **Settings** page once ContentLoop is running (see BYOK table below); those are
> stored in `data/app.config.json` inside the container. If you'd rather
> drive everything from `.env`, add `env_file: .env` to the `app-api` and
> `app-worker` services in `docker-compose.yml`.

ContentLoop runs perfectly well with **no keys at all**: content generation falls
back to a deterministic template, scoring falls back to keyword-only
matching, and every ingestion source that needs a credential is simply
skipped (see the BYOK table below for which ones those are).

## Desktop mode (no Docker)

This is what the one-click launcher above runs for you. To drive it by hand:

```bash
npm install
npm run build
npm run start:desktop   # or `npm run desktop` to run from source via tsx
```

This boots an embedded Postgres cluster inside your OS's app-data folder
(override with `CONTENTLOOP_DATA_DIR`), applies migrations, and serves the built
dashboard — all from one process, no Redis. Background jobs run in-process
on an elapsed-time schedule (not wall-clock cron) with a catch-up pass at
launch, so a post scheduled for 17:00 still goes out the next time you open
the app, even if that's 10am the next day. Open **http://localhost:4173**
(override with `PORT`).

First launch takes about a minute while Postgres initializes; later
launches reuse the existing cluster and are up in well under 30 seconds.
The Docker quickstart above is still the better fit for multi-page/team
deployments — desktop mode is the easiest path for running ContentLoop for
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

ContentLoop is keyless by default. Every credential below unlocks one specific
feature; nothing is required to run the pipeline end-to-end in dry-run.

| Env var | Unlocks | Without it |
|---|---|---|
| `LLM_API_KEY` (+ `LLM_PROVIDER`, `LLM_MODEL`) or `OPENAI_API_KEY` | Real LLM content generation (reel scripts, carousels, captions, format suggestion) via Groq, OpenAI, OpenRouter, or any OpenAI-compatible endpoint | Deterministic template-based generation — no live LLM calls |
| `YOUTUBE_API_KEY` | YouTube Trends ingestion source | Source is skipped |
| `EXPLODING_TOPICS_API_KEY` | Exploding Topics ingestion source (Pro tier) | Source is skipped |
| `PRODUCT_HUNT_TOKEN` | Product Hunt ingestion | Source is skipped — Product Hunt's API v2 rejects unauthenticated requests with a 401, so this is required, not merely a rate-limit upgrade |
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
  behavior). Set it before exposing ContentLoop beyond `localhost` — see
  `SECURITY.md`.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full module
breakdown (ingestion, scoring, generation, QA, media/render, scheduler,
feedback loop, growth automation, and self-host configurability) and
[`docs/API.md`](docs/API.md) for the HTTP API reference.

## License

AGPL-3.0 — see [`LICENSE`](LICENSE). In short: you're free to run, modify,
and redistribute ContentLoop, but if you run a modified version as a network
service for others, you must make that modified source available to them
too.
