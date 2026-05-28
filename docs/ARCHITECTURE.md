# Architecture

## Modules

1. Trend ingestion
   - Google Trends adapter
   - Reddit hot-post adapter
   - RSS adapter
   - Twitter/X recent-search adapter with credential-free fallback
   - 21 total sources: HackerNews, arXiv, PubMed, Product Hunt, YouTube Trends, etc.

2. Topic scoring
   - Multi-factor scoring: recency, cross-source, velocity, audience relevance, monetization, novelty
   - Source quality multipliers (HN: 1.30, arXiv: 1.25, Google Trends: 0.80)
   - Seasonal context adjustment
   - `>= 0.50`: selected, `0.35-0.49`: backup, `< 0.35`: discarded

3. Content generation
   - Multi-LLM support (Groq, OpenRouter, OpenAI, or any OpenAI-compatible endpoint)
   - deterministic fallback for local dry runs
   - outputs 2 Reel scripts, 8-slide carousel, captions, and hashtags
   - Format suggestion AI (post vs. carousel vs. reel)

4. QA gate
   - hook clarity, non-generic language, readability, CTA presence, carousel structure
   - Niche-specific gates: health (no miracle claims), finance (no guaranteed returns), food (allergen caution)

5. **Media pipeline** *(new — inspired by MoneyPrinterTurbo)*
   - **TTS voice synthesis**: Azure Edge TTS (free, no API key) with niche-aware voice presets
   - **Stock footage sourcing**: Pexels API for auto-downloading royalty-free B-roll by keyword
   - **Subtitle generation**: Word-boundary SRT from TTS timing
   - **Background music**: Random or specified BGM from `data/bgm/` library

6. **Video rendering** *(new — inspired by MoneyPrinterTurbo)*
   - **Remotion composition**: slide-based Reel with word-by-word animations, Ken Burns zoom, progress HUD
   - **MP4 export**: Remotion renderer → silent video → ffmpeg audio muxing
   - **Audio mixing**: TTS voice at full volume + BGM at configurable volume (default 15%)
   - **Subtitle burning**: SRT → ffmpeg hardcoded subtitles (styled: white text, dark outline, background box)
   - **Multi-aspect-ratio**: portrait (1080×1920), landscape (1920×1080), square (1080×1080)
   - **Transitions**: fade, slide, zoom, wipe, hard cut — configurable per content item
   - **Batch generation**: render N variants (different transitions/aspects) for A/B testing
   - Fallback to ffmpeg slideshow when Remotion/Chromium unavailable

7. Scheduler
   - 2-3 posts per page per day
   - minimum 3-hour gap
   - default slots: 12:00, 17:00, 21:00
   - manual approval required before scheduling

8. Platform integration
   - Instagram Graph API (OAuth + media container publishing)
   - YouTube Shorts (OAuth, dry-run by default)
   - Dry-run by default — live adapters require credentials and policy review

9. Feedback loop
   - worker creates performance metric rows
   - `learning_signals` is reserved for ranking hook patterns and formats as real metrics accumulate

## Queue States

`IDEA → SCORED → CONTENT_READY → QA_PASSED → [MEDIA → RENDER] → SCHEDULED → POSTED → ANALYZED`

## API Endpoints (Media)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tts/voices` | List available TTS voices + presets |
| POST | `/api/tts/preview` | Preview a voice on a text snippet (returns MP3) |
| GET | `/api/content/:id/media` | Get media status (audio, footage, video) |
| POST | `/api/content/:id/synthesize` | Trigger TTS synthesis for a content item |
| POST | `/api/content/:id/render` | Trigger video rendering for a content item |
| POST | `/api/content/:id/batch-render` | Render N variants with different transitions/aspects |
| GET | `/api/content/:id/variants` | List all variants in a batch group |
| GET | `/api/media/options` | Available aspect ratios and transitions |
| POST | `/api/jobs/media` | Run media worker manually |
| POST | `/api/jobs/render` | Run render worker manually |

## MVP Limits

- Seeded to 2 niches and 2 pages per niche
- No multi-user permissions
- No live posting unless `POSTING_DRY_RUN=false` and adapters are completed with approved credentials

