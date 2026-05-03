# Theme Page Content Engine — Master Roadmap

> Living document. Updated 2026-05-03.
> Tracks all agreed workstreams, their priority, and their plan files.

---

## North Star

Turn TPCE from a topic-discovery pipeline into a full-stack content engine: ingest trends → generate branded visual content → publish to all major platforms. One tool, zero context switching.

---

## Content Creation Workflow

Two modes. Both produce the same final output — the path differs.

```
GUIDED MODE                           AUTO MODE
──────────────────────────────────────────────────────────
Step 1: Topic Gate                    ↓ (auto-accept scored topics)
  Accept / Reject topics              ↓
        ↓                             ↓
Step 2: Copy + Format                 ↓ (AI writes copy + picks format)
  Review AI-written copy              ↓
  Regenerate copy                     ↓
  Pick: Post / Carousel / Reel        ↓
     or AI Suggested (with reason)    ↓
  ← FORMAT LOCKED HERE →             ↓
        ↓                             ↓
Step 3: Image Generation              ↓ (auto-generates per format)
  Post     → 1 hero image             ↓
  Carousel → 1 image per slide        ↓
  Reel     → 3–5 key frame images     ↓
  View, regenerate individual         ↓
  or regenerate all                   ↓
        ↓                             ↓
Step 4: Assembly                      ↓ (auto-assembles)
  Post/Carousel → layout preview      ↓
  Reel → Remotion animated preview    ↓
        ↓                             ↓
──────────────────────────────────────────────────────────
              FINAL REVIEW  (both modes land here)
  Full preview: copy + images + reel/carousel
  Regenerate any step individually
  Switch format → restarts from Step 3 (copy stays)
  Approve → Publish (platform selector)
──────────────────────────────────────────────────────────
```

**Key rule:** Format (Post/Carousel/Reel) is locked at Step 2 because image generation depends on it. Switching format at Final Review only re-runs Steps 3–4, not copy.

---

## Provider Priority Chain

Users set an **ordered priority list** per generation type in Settings — not a single default. The engine walks the list and uses the first provider whose key is connected. If that provider fails (API error, rate limit, quota), it falls to the next.

```
Image request → Try #1 (key connected?) → use it
             → Try #2 (key connected?) → use it
             → Try #3 (key connected?) → use it
             → All failed → surface error
```

**Three priority lists in Settings:**
- Text / LLM priority (e.g. Gemini → OpenAI → Anthropic)
- Image generation priority (e.g. Ideogram → Imagen 3 → DALL-E 3 → Flux → Stability)
- Video generation priority (future Phase 3)

**Per-provider model preference:** each provider has one preferred model set in Settings (e.g. "when using fal.ai, use `fal-ai/ideogram/v2`"). Chain resolves *provider*, per-provider setting resolves *model*.

**ConfigStore shape:**
```json
IMAGE_PROVIDER_PRIORITY = ["fal", "google", "openai", "stability", "replicate"]
IMAGE_MODEL_PREFS       = {"fal": "fal-ai/ideogram/v2", "google": "imagen-3.0-generate-001", "openai": "dall-e-3"}
LLM_PROVIDER_PRIORITY   = ["google", "openai", "anthropic"]
LLM_MODEL_PREFS         = {"google": "gemini-2.0-flash", "openai": "gpt-4o"}
```

Settings UI: drag-and-drop ordered list. Connected providers show green dot. Unconnected providers are dimmed and skipped automatically.

---

## Phase 1 — Generation Engine (Current Sprint)

**Goal:** Give every content item a visual. Plain text carousels have declining reach across all platforms. Image-first content + short-form video reels are the baseline for audience growth in 2026.

### 1.1 Brand Kit
**Status:** Specced (Task 11 in generation plan)
**Plan:** `docs/superpowers/plans/2026-05-03-multi-provider-generation.md` → Task 11

| Feature | Detail |
|---|---|
| Logo Generator | BYOK — uses priority chain. Providers ranked by logo quality. Nudge CTA if fal.ai not connected. |
| Palette Generator | HSL-math based — 5-color palette from a base hex. No API cost. |
| Font Pairing | 30+ Google Fonts, 6 curated brand pairs. Static data, no API. |
| Brand variables | Colors + fonts flow into Remotion templates and generated image prompts automatically. |

### 1.2 AI Image Generation
**Status:** Specced (Tasks 1–10 in generation plan) — updated for priority chain architecture
**Plan:** `docs/superpowers/plans/2026-05-03-multi-provider-generation.md` → Tasks 1–10

| Feature | Detail |
|---|---|
| BYOK providers | OpenAI DALL-E 3, Google Imagen 3, Stability AI SD 3.5, fal.ai (Flux + Ideogram), Replicate |
| Priority chain | User sets ordered provider list in Settings. Engine uses first connected provider, falls back automatically on failure. |
| Per-provider model | One preferred model per provider set in Settings. Chain resolves provider → model resolves automatically. |
| Per-content override | Still available in Guided mode — pick provider/model manually for a specific piece |
| Format-aware generation | Post → 1 image, Carousel → N slide images, Reel → key frames. Auto-generated to match format. |
| Persistence | Generated URLs stored in `content_items.payload` JSONB — no schema migration needed |
| Brand-aware prompts | Auto-built from topic + brand kit (colors, style, niche) — no manual prompt writing in Auto mode |

### 1.3 Remotion Reel Builder
**Status:** Stub specced (Task 12 in generation plan). Full plan TBD.
**Plan:** `docs/superpowers/plans/2026-05-03-multi-provider-generation.md` → Task 12 (stub)
**Full plan:** `docs/superpowers/plans/2026-05-xx-remotion-reel-builder.md` ← to be written

| Feature | Detail |
|---|---|
| Programmatic MP4 | React → animated MP4 via Remotion renderer. No per-render API cost. |
| Templates | CarouselSlide, QuoteCard, ProductSpotlight, Countdown, Logo Outro |
| Brand injection | Colors, fonts, logo from Brand Kit flow into every template automatically |
| Image integration | Generated images from Phase 1.2 used as per-slide visuals |
| Formats | 1080×1920 (Reels/Shorts), 1080×1080 (Feed), 1920×1080 (LinkedIn) |
| Editor panel | ReelBuilder in ContentEditor — pick template, reorder slides, preview, export |
| Server-side render | `POST /api/render/reel` → render queue → MP4 download |

---

## Phase 2 — Multi-Platform Distribution

**Goal:** One-click publish from TPCE to every platform the user is active on, formatted correctly for each.
**Status:** Stub specced (Task 13 in generation plan). Full plan TBD.
**Plan:** `docs/superpowers/plans/2026-05-03-multi-provider-generation.md` → Task 13 (stub)
**Full plan:** `docs/superpowers/plans/2026-05-xx-multi-platform-distribution.md` ← to be written

### Platforms

| Platform | Content types | Auth |
|---|---|---|
| Instagram | Feed image, Carousel, Reel | Meta Graph API (existing token in Settings) |
| LinkedIn | Text post, Image post, Carousel PDF | OAuth 2.0 — UGC Posts API |
| Twitter / X | Tweet, Image tweet, Thread | OAuth 2.0 — v2 API |
| Reddit | Text post, Link post, Image post | OAuth 2.0 — submit API |
| Facebook | Page post, Image, Reel | Meta Graph API — Page token |
| ProductHunt | Ship post | GraphQL API — PH token (already in Settings) |

### Features

| Feature | Detail |
|---|---|
| Platform formatter | Per-platform: character truncation, hashtag injection, image resize to spec |
| Publish panel | In-editor — platform checkboxes, formatted preview per platform, publish button |
| Publish jobs table | `publish_jobs` DB table — tracks status, external URL, errors per platform |
| Parallel publish | All selected platforms fire simultaneously, per-platform status badges |
| Scheduling | Queue a publish for a future time (cron-based, Phase 2.5) |

---

## Phase 3 — Cinematic AI Video (Future)

**Goal:** Premium tier for users who want AI-generated video (presenter avatars, product demos, cinematic clips) — different from Remotion reels, which are programmatic.
**Status:** Fully specced in generation plan but deferred.
**Plan:** `docs/superpowers/plans/2026-05-03-multi-provider-generation.md` → Tasks 2, 4, 6–7, 9–10

| Provider | Use case |
|---|---|
| RunwayML Gen-3 | Cinematic text-to-video, product showcase clips |
| HeyGen Avatar v2 | AI presenter / spokesperson talking-head videos |
| Kling AI via fal.ai | High-motion video, lifestyle content |

**Why deferred:** Remotion covers 80% of social reel needs at zero marginal cost. API video is $0.50–2.00 per clip with 30–90s generation time — the right tool for premium content, not the daily posting workflow.

---

## Phase 4 — Analytics & Optimization

**Goal:** Close the loop — track what performs, feed signals back into ingestion scoring and content generation.

| Feature | Detail |
|---|---|
| Per-post analytics | Likes, reach, engagement rate pulled from platform APIs after publish |
| Topic performance scoring | Posts that perform well boost their source topic's score in DB |
| A/B testing | Publish two variants of an image/caption, track which wins |
| Best-time suggestions | Platform-specific posting time recommendations from historical data |
| Content calendar | Visual week/month view of scheduled + published posts |

---

## Phase 5 — Platform Expansion

**Goal:** Broader niche coverage and reach beyond theme pages.

| Feature | Detail |
|---|---|
| TikTok publishing | TikTok Content Posting API (needs business account) |
| YouTube Shorts | Shorts upload API — Remotion MP4 → auto-upload |
| Pinterest | Pin creation API (if partner access becomes available) |
| Newsletter export | Generate a Substack/Beehiiv-compatible email from weekly top topics |
| White-label | Multi-tenant mode — agency manages multiple brand accounts |

---

## Ingestion Sources Status (Reference)

| Source | Status | Notes |
|---|---|---|
| Reddit | Live | Free |
| Google News | Live | Free |
| Google Trends | Live | Free |
| Hacker News | Live | Free |
| Medium | Live | Free (RSS) |
| Substack | Live | Free (RSS) |
| RSS (custom) | Live | Free |
| Product Hunt | Live | Token optional — boosts rate limits |
| YouTube Trends | Live | Requires `YOUTUBE_API_KEY` |
| Exploding Topics | Live | Requires Pro subscription API key |
| Twitter / X | Live | Requires Bearer Token (paid tier) |
| arXiv | Live | Free |
| PubMed | Live | Free |
| Crypto News | Live | Free (RSS — CoinDesk, Decrypt, CoinTelegraph) |
| Finance Newsletters | Live | Free (RSS — CNBC, NYT Business, Entrepreneur, NerdWallet) |
| Pinterest Trends | Removed | Partner-approval only — no self-serve API |
| Dev.to | Configured | RSS available |

---

## Decision Log

| Date | Decision | Reason |
|---|---|---|
| 2026-05-03 | Remove Pinterest | No self-serve API — requires partner approval + active ad spend |
| 2026-05-03 | Defer API video gen (Runway/HeyGen/Kling) to Phase 3 | Remotion covers social reel needs at zero cost; API video is premium/cinematic use case |
| 2026-05-03 | Prioritize image generation + Remotion over text-only carousels | Text carousels have declining reach; image-first content is the engagement baseline in 2026 |
| 2026-05-03 | BYOK for all generation — no locked providers | Users already have API keys from LLM work; reusing them for images is zero added cost |
| 2026-05-03 | Ideogram via fal.ai = recommended logo provider | Best text-in-image fidelity; fal.ai key also unlocks Flux + Kling — one key, three providers |
| 2026-05-03 | Store generated assets in `payload` JSONB | No schema migration needed; flexible for future asset types |
| 2026-05-03 | Provider priority chain instead of single default | Resilience (auto-fallback on API failure) + cost control (cheapest first) + works with Auto mode zero-touch |
| 2026-05-03 | Per-provider model preference (one model per provider) | Chain resolves provider, preference resolves model — clean separation, no per-generation config needed |
| 2026-05-03 | Format (Post/Carousel/Reel) locked at copy step | Image generation depends on format — 1 hero vs N slides vs key frames are fundamentally different outputs |
| 2026-05-03 | Guided mode + Auto mode | Auto mode = zero-touch → Final Review. Guided mode = step-by-step review gates. Both land at same Final Review. |
| 2026-05-03 | Gemini API (Imagen 3) is day-one image provider | User already has GOOGLE_AI_API_KEY connected — no additional cost or key needed to start generating |
