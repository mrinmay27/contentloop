# YouTube Shorts Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rendered reel actually publishes to YouTube Shorts on schedule, on the right channel, for the right page.

**Architecture:** Finish a feature that is ~70% built. OAuth, refresh-token capture, status/disconnect, the Settings card, MP4 rendering and the caption formatter already exist. This adds per-page token storage (fixing a flaw where a second page silently steals the first page's channel), token refresh, the video reaching the publisher, and the resumable upload itself. Spec: `docs/superpowers/specs/2026-07-27-publishing-and-remix-design.md` (Part 1).

**Tech Stack:** TypeScript ESM (`.js` suffixes in `src/`), YouTube Data API v3 resumable upload, Google OAuth refresh, vitest.

**Conventions:** gates = `npx vitest run` (336 currently) + `npx tsc -p tsconfig.json --noEmit` + `npm run build`. READ every file before modifying. Commit per task. Never bind port 4000; test on a spare port with a temp `CONTENTLOOP_DATA_DIR`.

**Cannot be verified here:** a real upload needs the user's channel and a Google Cloud OAuth app. Report that plainly rather than implying it was tested — the standard already applied to the Windows launcher and Veo.

---

### Task 1: Pure upload helpers (TDD)

The parts that are wrong-able without a network: title limits, Shorts eligibility, and when a token needs refreshing.

**Files:**
- Create: `src/domain/youtube.ts`
- Test: `tests/youtube.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_TITLE, MAX_SHORT_SECONDS, needsRefresh,
  buildTitle, describeShortRejection,
} from "../src/domain/youtube.js";

describe("buildTitle", () => {
  it("passes a short hook through", () => {
    expect(buildTitle("Three AI tools that save hours")).toBe("Three AI tools that save hours");
  });
  it("truncates on a word boundary, not mid-word", () => {
    const long = "word ".repeat(40).trim();
    const out = buildTitle(long);
    expect(out.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(out.endsWith("wor")).toBe(false);
  });
  it("never exceeds YouTube's limit", () => {
    expect(buildTitle("x".repeat(500)).length).toBeLessThanOrEqual(MAX_TITLE);
  });
  it("falls back rather than sending an empty title", () => {
    // The API rejects an empty title, which would fail the whole publish.
    expect(buildTitle("").length).toBeGreaterThan(0);
    expect(buildTitle("   ").length).toBeGreaterThan(0);
  });
});

describe("describeShortRejection", () => {
  it("accepts a vertical clip within the limit", () => {
    expect(describeShortRejection({ width: 1080, height: 1920, durationSec: 45 })).toBeNull();
  });
  it("explains a too-long clip in plain language", () => {
    const msg = describeShortRejection({ width: 1080, height: 1920, durationSec: 400 });
    expect(msg).toMatch(/3 min|too long/i);
  });
  it("explains a non-vertical clip", () => {
    expect(describeShortRejection({ width: 1920, height: 1080, durationSec: 30 }))
      .toMatch(/vertical|9:16/i);
  });
  it("accepts unknown duration rather than guessing", () => {
    expect(describeShortRejection({ width: 1080, height: 1920, durationSec: null })).toBeNull();
  });
});

describe("needsRefresh", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  it("refreshes when the token has already expired", () => {
    expect(needsRefresh(new Date("2026-07-28T11:00:00Z"), now)).toBe(true);
  });
  it("refreshes inside the safety window, before it actually expires", () => {
    // A token valid for 2 more minutes will die mid-upload.
    expect(needsRefresh(new Date("2026-07-28T12:02:00Z"), now)).toBe(true);
  });
  it("does not refresh a comfortably valid token", () => {
    expect(needsRefresh(new Date("2026-07-28T12:59:00Z"), now)).toBe(false);
  });
  it("refreshes when expiry is unknown", () => {
    // Safer to refresh needlessly than to attempt an upload with a dead token.
    expect(needsRefresh(null, now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/youtube.test.ts`

- [ ] **Step 3: Implement**

```ts
/** Pure rules for publishing to YouTube Shorts. No I/O. */

/** YouTube truncates titles beyond this. */
export const MAX_TITLE = 100;
/** Longer than this and YouTube treats it as a normal video, not a Short. */
export const MAX_SHORT_SECONDS = 180;
/** Refresh this far ahead of expiry so a token cannot die mid-upload. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export function buildTitle(hook: string): string {
  const clean = (hook ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "New Short";           // the API rejects an empty title
  if (clean.length <= MAX_TITLE) return clean;
  const cut = clean.slice(0, MAX_TITLE);
  const lastSpace = cut.lastIndexOf(" ");
  // Word boundary if there is a sensible one, else a hard cut.
  return (lastSpace > MAX_TITLE * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

export function describeShortRejection(probe: {
  width: number; height: number; durationSec: number | null;
}): string | null {
  if (probe.height <= probe.width) {
    return "This video is landscape or square — Shorts need vertical (9:16).";
  }
  if (probe.durationSec !== null && probe.durationSec > MAX_SHORT_SECONDS) {
    return `This video is ${Math.round(probe.durationSec)}s — too long for a Short (max 3 min).`;
  }
  return null;
}

/** Unknown expiry refreshes: safer than attempting an upload with a dead token. */
export function needsRefresh(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() <= REFRESH_WINDOW_MS;
}
```

- [ ] **Step 4: Tests pass + `npx tsc -p tsconfig.json --noEmit`**
- [ ] **Step 5: Commit** — `feat(youtube): pure title, Shorts eligibility and refresh rules`

---

### Task 2: Per-page tokens + migration that adopts the existing one

**The blocking flaw.** `/auth/youtube/callback` writes `YOUTUBE_ACCESS_TOKEN`,
`YOUTUBE_REFRESH_TOKEN` and `YOUTUBE_PAGE_ID` into `configStore` — one slot for
the whole install. Connecting a second page silently overwrites the first
page's channel, and `/status` only reports connected for whichever won.

**Files:**
- Create: `src/db/migrations/009_youtube_tokens.sql`
- Modify: `src/api/server.ts` (callback, status, disconnect)
- Create: `src/services/youtubeTokens.ts`

- [ ] **Step 1: Migration, mirroring canva_tokens exactly**

```sql
-- YouTube OAuth tokens, one per page. Mirrors canva_tokens, which already
-- gets this right; YouTube was the only provider storing a single global
-- token, so a second page silently stole the first page's channel.
CREATE TABLE IF NOT EXISTS youtube_tokens (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id        UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT,
  expires_at     TIMESTAMPTZ,
  channel_id     TEXT,
  scope          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(page_id)
);
```

**Adoption is required, not optional.** An existing install may already have a
working token in `configStore`. Silently disconnecting someone who had YouTube
connected is not acceptable, and the migration cannot read `configStore`
(it is a JSON file, not a table). So adoption happens in code: on boot, if
`YOUTUBE_ACCESS_TOKEN` and `YOUTUBE_PAGE_ID` are both set and no row exists for
that page, insert one and blank the config keys. Log it.

Put that in `src/services/youtubeTokens.ts` as `adoptLegacyToken()`, called
once from server startup after migrations.

- [ ] **Step 2: Token service**

`src/services/youtubeTokens.ts` exports:
- `getToken(pageId)` → row or null
- `saveToken(pageId, { accessToken, refreshToken, expiresAt, scope })` — upsert
  on `page_id`
- `deleteToken(pageId)`
- `adoptLegacyToken()` as above

- [ ] **Step 3: Rewire the three routes**

READ `src/api/server.ts` around line 1524-1580 first.
- `/auth/youtube/callback` — `saveToken(entry.pageId, …)` with
  `expiresAt = new Date(Date.now() + token.expires_in * 1000)` instead of
  `configStore.set`.
- `GET /api/pages/:id/youtube/status` — `connected: !!(await getToken(id))`,
  not a global comparison.
- `DELETE /api/pages/:id/youtube` — `deleteToken(id)`.

- [ ] **Step 4: Verify the migration and adoption run**

```bash
npm run build
FRESH=$(mktemp -d)
CONTENTLOOP_DATA_DIR="$FRESH" PORT=4781 CONTENTLOOP_MODE=desktop \
  nohup node dist/src/desktop/main.js > "$FRESH/app.log" 2>&1 &
until curl -fsS http://localhost:4781/api/health >/dev/null 2>&1; do sleep 2; done
grep -E "migrate|youtube" "$FRESH/app.log" | head
```
Expected: `009_youtube_tokens.sql` applied. Then confirm two different pages
report `connected:false` independently rather than sharing one answer.

- [ ] **Step 5: Commit** — `fix(youtube): per-page tokens; a second page no longer steals the first page's channel`

---

### Task 3: Token refresh

Google access tokens last ~1 hour. The refresh token is already captured and
has never been used, so **a post scheduled for 21:00 on a channel connected at
09:00 always fails today.**

**Files:** Modify `src/services/youtubeTokens.ts`

- [ ] **Step 1: `ensureFreshToken(pageId)`**

Returns a usable access token, refreshing first when `needsRefresh(expiresAt)`:

```ts
const res = await fetch(GOOGLE_TOKEN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    refresh_token: row.refresh_token, grant_type: "refresh_token",
  }),
});
```

On success, persist the new access token and expiry and return it.

On `invalid_grant` — the user revoked access — throw an error whose message
names the fix: **"YouTube access was revoked. Reconnect YouTube in Settings."**
Never surface the raw Google payload; the publisher puts this text straight in
front of the user.

- [ ] **Step 2: Typecheck + commit** — `feat(youtube): refresh access tokens before they expire`

---

### Task 4: Get the video to the publisher

`PublishJobInput` carries `imageUrls` but no video, so the publisher cannot
reach the rendered MP4.

**Files:** Modify `src/services/platforms/publisher.ts`, `src/api/server.ts`

- [ ] **Step 1: Three exact change points**

1. `publisher.ts` — the payload query is
   `SELECT id, payload FROM content_items`; add `video_url`.
2. `buildPublishJobInput` — accept and pass `videoUrl` through on
   `PublishJobInput`.
3. `server.ts` publish-now path — it builds from a **different** query
   (`rows[0]`); that one needs `video_url` too, or manual publish fails while
   scheduled publish works. Easy to miss — grep for `buildPublishJobInput` and
   fix every caller.

- [ ] **Step 2: Typecheck + commit** — `feat(youtube): carry the rendered video through to the publisher`

---

### Task 5: The upload

**Files:** Create `src/services/youtube.ts`; modify `src/services/platforms/publisher.ts`

- [ ] **Step 1: Resumable upload**

Reels are tens of MB, so the simple endpoint is unreliable. Two steps:

1. `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
   with the metadata body → the upload URL comes back in the `Location` header.
2. `PUT` the file bytes to that URL.

Snippet: `title` from `buildTitle(hook)`, `description` from the formatted
caption, `tags` from hashtags. Status: `privacyStatus` from a new
`YOUTUBE_PRIVACY` config key defaulting to **`private`** — a first upload
going straight to a real audience is not a safe default; the user opts in.

Guard with `describeShortRejection` **before** uploading, using `probeVideo`.
Failing after a 20 MB upload wastes the user's quota.

- [ ] **Step 2: Wire the publisher case**

Replace the `throw` at `publisher.ts:99`. Refuse early and clearly when
`videoUrl` is null: *"This reel has no rendered video yet — run the render job
first."* That is the most likely failure and deserves a real sentence.

- [ ] **Step 3: Quota handling**

YouTube allows **10,000 units/day** and `videos.insert` costs **1,600** — about
**6 uploads per day**. On a `quotaExceeded` error, mark the job failed with
*"YouTube daily upload limit reached — this will retry tomorrow"* and leave it
retryable rather than burning the attempt. Do **not** build a local quota
counter; Google's accounting is authoritative and a mirror would drift.

Surface the ceiling in the connect card: *"YouTube allows about 6 uploads per
day."*

- [ ] **Step 4: Dry-run must stay honest**

`dispatchPublishJob(input, dryRun)` already stubs. For YouTube, dry-run must
verify everything except the upload — token present and refreshable, video file
exists, passes `describeShortRejection`, title and description build — so a
passing dry run means a real run would work. A dry run that skips validation is
worthless.

- [ ] **Step 5: Typecheck, build, commit**

---

### Task 6: Verification, and honest reporting

**Files:** none

- [ ] **Step 1: What can be verified here**

On a temp instance: migration applies; two pages report connection state
independently; publishing a reel with no `video_url` returns the "run the
render job first" message; dry-run passes its checks; a landscape or
over-long clip is rejected by `describeShortRejection` **before** any upload.

- [ ] **Step 2: What cannot**

A real upload needs the user's YouTube channel and a Google Cloud OAuth app
with `YOUTUBE_CLIENT_ID`/`SECRET`. **Say so plainly.** Do not describe the
feature as tested. The same standard was applied to the Windows launcher and
to Veo.

- [ ] **Step 3: Full gates + commit**

```bash
npx vitest run && npx tsc -p tsconfig.json --noEmit && npm run build
docker compose ps
```
