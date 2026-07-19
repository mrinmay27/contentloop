# Security

TPCE is built for **single-user, self-hosted** use — one operator running
their own instance, not a multi-tenant SaaS. That scope shapes the security
model below; if you need multi-user isolation, you'll need to add it.

## Where secrets live

- **Local Postgres database**: OAuth tokens (Instagram, YouTube, Canva),
  and anything the app writes to the DB, are stored **unencrypted**.
- **`data/app.config.json`**: LLM API keys, Reddit/Twitter/Product
  Hunt/Exploding Topics credentials, and other Settings-page values entered
  via the UI are persisted here **unencrypted** (this file is gitignored,
  but it is plain JSON on disk).
- **`.env`**: bootstrap defaults (also unencrypted, also gitignored).

None of this is hashed, salted, or encrypted at rest. Treat the machine (or
container/volume) running TPCE as sensitive — anyone with filesystem or DB
access has your keys.

## Do not expose this publicly without protection

The API has no authentication by default (matching today's local-dev
behavior). Before putting TPCE behind a public URL:

1. Set `API_TOKEN` (see `.env.example`) so `/api/*` requires
   `Authorization: Bearer <token>` (except `/api/health`).
2. Put a reverse proxy (nginx, Caddy, Traefik, etc.) in front with TLS —
   TPCE itself does not terminate HTTPS.
3. Don't rely on `API_TOKEN` alone as your only defense on the open
   internet; it's a single static bearer token, not a full auth system.

## Reporting a vulnerability

This is a small self-hosted project without a dedicated security team.
Please report issues via [GitHub Issues](../../issues) on this repository.
Avoid posting real credentials or exploit details for a live public
instance in a public issue — describe the class of issue and we'll follow
up for specifics if needed.

Note: with `API_TOKEN` set, the Bull Board dashboard at `/queues` requires the
same token (`Authorization: Bearer <token>` or `?token=<token>` in the browser).
When exposing TPCE through a reverse proxy, consider blocking `/queues` entirely.
