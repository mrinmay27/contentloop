# Sprint E — YouTube Shorts Publishing + Remix & Competitor Signal: Design Spec

> Status: Draft for approval, 2026-07-27
> Follows v0.1.0. Two independent subsystems → **two separate plans**, executed
> in the order below. Each ships working software on its own.

---

## Discovery: how much already exists

I audited before designing, and the scope is much smaller than my earlier
estimate ("real OAuth, upload APIs, quota handling" — most of that is done).

**YouTube Shorts is roughly 70% built:**

| Piece | State |
|---|---|
| OAuth start + callback, `access_type=offline` | ✅ `server.ts:1192-1236` |
| Refresh token captured | ✅ stored, but **never used** |
| Status + disconnect endpoints | ✅ |
| Settings connect card | ✅ `OAuthConnectCard` already lists `youtube` |
| Reel rendering → MP4 | ✅ Remotion, `content_items.video_url` |
| `youtube_shorts` caption formatter | ✅ `platformFormatter.ts` |
| `youtube_shorts` in DB CHECK constraints | ✅ `001_baseline.sql:17,65` |
| **The actual upload** | ❌ `publisher.ts:99` throws "not implemented" |
| **Token refresh** | ❌ access tokens die after ~1h |
| **Video reaches the publisher** | ❌ `PublishJobInput` has `imageUrls`, no video |
| **Per-page tokens** | ❌ single global config slot |

So this is *finishing* a feature, not building one.

**Remix + competitor ingestion is greenfield**, but `automation/recycler.ts`
is a close structural analogue to follow (claim-once via `automation_events`,
`UNIQUE(kind, subject_id)`).

---

## Part 1 — YouTube Shorts publishing

### 1.1 The blocking design flaw: tokens are global

`/auth/youtube/callback` does:

```ts
configStore.set({ YOUTUBE_ACCESS_TOKEN, YOUTUBE_REFRESH_TOKEN, YOUTUBE_PAGE_ID })
```

One slot for the whole install. Connecting a second theme page silently
overwrites the first page's channel, and `/status` only reports `connected`
for whichever page won. Instagram and Canva both already do this correctly
with per-page token tables.

**Fix:** `youtube_tokens` table mirroring `canva_tokens` exactly
(`UNIQUE(page_id)`, `refresh_token`, `expires_at`).

**Migration safety (required):** an existing install may already have a token
in `configStore`. Migration `009` must copy it into the new table for the page
named in `YOUTUBE_PAGE_ID`, then blank the config keys. Silently disconnecting
someone who had YouTube working is not acceptable.

### 1.2 Token refresh

Google access tokens last ~1 hour; a scheduled post at 21:00 connected at
09:00 will always fail without refresh. `refresh_token` is already captured.

`ensureFreshToken(pageId)`: if `expires_at` is within 5 minutes, POST to
`GOOGLE_TOKEN_URL` with `grant_type=refresh_token`, persist the new access
token and expiry, return it. All uploads go through it.

If refresh fails with `invalid_grant` (user revoked access), mark the job
failed with a message naming the fix — "reconnect YouTube in Settings" — not
the raw Google error.

### 1.3 Getting the video to the publisher

`PublishJobInput` gains `videoUrl: string | null`. Three exact change points,
confirmed by reading the code:

1. `publisher.ts:154` — the payload query is `SELECT id, payload FROM
   content_items`; it must also select `video_url`.
2. `buildPublishJobInput` (`publisher.ts:108`) — accept and pass it through.
3. `server.ts:1585` — the publish-now path builds its input from a different
   row (`rows[0]`); that query needs `video_url` too, or manual publish will
   fail while scheduled publish works. Easy to miss.

`publishToYouTube` refuses early and clearly when it's null: *"This reel has
no rendered video yet — run the render job first."* A publish attempt on an
unrendered reel is the most likely failure and deserves a real sentence.

### 1.4 The upload

`src/services/youtube.ts`:

- **Resumable upload** (`uploadType=resumable`) — the simple endpoint is
  unreliable above a few MB and reels are tens of MB.
  1. `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
     with metadata → returns an upload URL in the `Location` header
  2. `PUT` the file bytes to that URL
- **Snippet:** `title` from hook (YouTube caps at 100 chars — truncate on a
  word boundary, don't hard-slice mid-word), `description` from the formatted
  caption, `tags` from hashtags.
- **Shorts eligibility is implicit**: vertical + ≤180s. Remotion already
  renders 1080×1920. Add a duration guard so an over-long reel fails with
  "too long for Shorts (max 3 min)" rather than silently becoming a normal
  video.
- **`privacyStatus`**: from a new `YOUTUBE_PRIVACY` config (`public` /
  `unlisted` / `private`), defaulting to **`private`**. A first upload going
  straight to a real audience is not a safe default; the user opts in.
- Return `{ videoId, url: https://youtube.com/shorts/<id> }` → `external_url`.

### 1.5 Quota — a hard limit users must see

YouTube Data API: **10,000 units/day**, and `videos.insert` costs **1,600**.
That is **6 uploads per day**, full stop, and it is not obvious to anyone.

- Surface it in the connect card: "YouTube allows about 6 uploads per day."
- On a `quotaExceeded` error, mark the job failed with "YouTube daily upload
  limit reached — this will retry tomorrow" and leave it retryable, rather
  than burning the attempt.
- Do **not** build a quota counter — Google's own accounting is authoritative
  and a local mirror would drift.

### 1.6 Dry-run must stay honest

`dispatchPublishJob(input, dryRun)` already stubs. Dry-run for YouTube must
verify everything except the upload — token present and refreshable, video
exists, title/description build cleanly — so a dry run that passes means a
real run would too. A dry-run that skips validation is worthless.

### Non-goals (Part 1)

- LinkedIn / Twitter / Reddit / Facebook publishing. Each is its own OAuth app
  and review process; Twitter's write API is paid. They stay stubs with the
  "connect via Settings first" message.
- Long-form YouTube, thumbnails, playlists, captions/subtitles upload.
- Quota accounting beyond reacting to Google's error.

---

## Part 2 — Remix + competitor signal

### 2.1 Remix: a new angle on a proven topic

Distinct from `recycler.ts`, which re-surfaces an old *post* for reposting.
**Remix generates new content from a topic that already performed**, in a
different format or angle — the natural payoff now that format performance is
legible (`formatInsight.ts`).

- Candidates: topics whose posts cleared an engagement threshold, cooled off
  (older than `remixCooldownDays`), and haven't been remixed before.
- One LLM call: original title + what performed + target format → a new angle,
  explicitly *not* a reword of the original.
- Creates a **new topic** with `source: 'remix'`, linked via
  `remixed_from_topic_id`, entering the normal scoring → QA → approval path.
  It is not auto-published; it is a draft like anything else.
- Claim-once through `automation_events` (`kind='remix'`, subject = source
  topic id), matching reactor/recycler.
- Target format = the learned winner from `summariseFormatPerformance`, so a
  carousel-winning niche remixes a strong post into a carousel.

### 2.2 Competitor signal

**Scope deliberately narrow, and legal.** Instagram's Graph API provides
`business_discovery`, which returns another *business/creator* account's
public posts (media, captions, like/comment counts) using your own token. No
scraping, no ToS violation, no extra credentials.

- Settings → per page, a list of competitor handles.
- A job fetches recent posts for each handle, computes each account's median
  engagement, and flags posts significantly above their own median — the
  signal is "this outperformed *for them*", which is comparable across
  accounts of different sizes. Raw like counts are not.
- Output is **`competitor_posts` rows used as a trend signal**, not content:
  they boost the score of our topics whose keywords overlap, exactly as
  Pinterest trends do. They never become topics themselves.
- **Explicitly not** copying captions or creative. The value is knowing *what
  themes* are landing, not reproducing someone's post.

Requires a connected Instagram business account. Degrades to "no competitor
data" without one — never fabricates, per the `google-trends.ts` lesson.

### Non-goals (Part 2)

- Scraping any platform without an API, or any competitor source beyond
  Instagram business_discovery.
- Auto-publishing remixes.
- Copying competitor captions or images.

---

## Testing

- **Pure/unit (vitest):** title truncation on word boundaries, Shorts duration
  guard, token-expiry decision (`needsRefresh(expiresAt, now)`), remix
  candidate selection, competitor outlier maths (median + threshold). These
  are where the real logic lives.
- **Live, this machine:** migration 009 adopting an existing config token;
  publisher rejecting a null `videoUrl`; dry-run passing end to end.
- **Cannot be verified here:** a real YouTube upload (needs the user's channel
  + a Google Cloud OAuth app) and `business_discovery` (needs a connected
  Instagram business account). Both must be reported as untested, and the
  README must not imply otherwise — same standard applied to the Windows and
  Linux launchers.

## Execution order

```
Part 1 (YouTube Shorts)          ← finishes a 70%-built feature, high value
  1.1 tokens table + migration → 1.2 refresh → 1.3 videoUrl → 1.4 upload
  → 1.5 quota messaging → 1.6 dry-run
Part 2 (Remix + competitor)      ← separate plan, greenfield
  2.1 remix → 2.2 competitor signal
```

Part 1 is the smaller and more valuable of the two: it removes the sharpest
limitation in v0.1.0 (an engine that drafts for platforms it cannot reach).
