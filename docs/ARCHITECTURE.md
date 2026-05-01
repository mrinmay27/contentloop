# Architecture

## Modules

1. Trend ingestion
   - Google Trends adapter
   - Reddit hot-post adapter
   - RSS adapter
   - Twitter/X recent-search adapter with credential-free fallback

2. Topic scoring
   - Implements `S_topic = 0.20R + 0.20C + 0.20V + 0.15A + 0.15M + 0.10N`
   - `>= 0.75`: selected
   - `0.60-0.74`: backup
   - `< 0.60`: discarded

3. Content generation
   - OpenAI JSON generation when `OPENAI_API_KEY` is set
   - deterministic fallback for local dry runs
   - outputs 2 Reel scripts, 8-slide carousel, captions, and hashtags

4. QA gate
   - hook clarity
   - non-generic language
   - readability
   - CTA presence
   - carousel structure

5. Scheduler
   - 2-3 posts per page per day
   - minimum 3-hour gap
   - default slots: 12:00, 17:00, 21:00
   - manual approval required before scheduling

6. Platform integration
   - Instagram and YouTube Shorts adapters are dry-run by default
   - live adapters intentionally require credentials and policy review before enabling

7. Feedback loop
   - worker creates performance metric rows
   - `learning_signals` is reserved for ranking hook patterns and formats as real metrics accumulate

## Queue States

`IDEA -> SCORED -> CONTENT_READY -> QA_PASSED -> SCHEDULED -> POSTED -> ANALYZED`

## MVP Limits

- Seeded to 2 niches and 2 pages per niche
- No multi-user permissions
- No advanced video editing
- No live posting unless `POSTING_DRY_RUN=false` and adapters are completed with approved credentials
