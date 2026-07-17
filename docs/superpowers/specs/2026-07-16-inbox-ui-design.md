# Sprint D-UI — Inbox: Design Spec

> Status: Approved design, 2026-07-16 (user-driven UX review, 3 iteration rounds)
> Scope: inbox-first home screen, rapid approve, navigation rework, outcome
> chips, Topics-view quick wins.

## Problem

The dashboard is organized around the machine's pipeline (which now runs
itself on cron after Sprints A–C) instead of the human's task. The same
funnel renders three times with irreconcilable numbers; the one human task
("3 awaiting review") is buried; the right rail duplicates the main list;
score colors read backwards.

## Decisions (user-confirmed through iteration)

1. **Inbox-first**: home screen = a cross-page inbox, NOT a dashboard.
2. **Two fixed lanes, never interleaved**: "Needs you" (clearable, pinned on
   top) and "Activity" (informational, below). An inbox you can finish.
3. **Needs-you = drafts awaiting approval + failed publishes.** Trend alerts
   and automation actions are Activity (no action to clear = not needs-you).
4. **Rapid approve renders the REAL artifact** — platform-formatted caption
   (`formatCaption`) + image, not the internal draft. Approve/Edit/Reject on
   the card; A/R keyboard keys; Edit deep-links to the existing ContentEditor.
5. **Digest header + smart empty state**: "Since yesterday: X posted, Y
   automation actions, Z topics scored" + next scheduled posts. Inbox-zero
   shows the same block — confirmation, not emptiness.
6. **Outcome chips**: posted Activity items show 24h engagement vs niche
   average once captured, colored. Makes the Sprint A loop visible.
7. **Manual topic entry stays one click away**: "Add topic" button in the
   inbox header opens the existing AddTopicDrawer.
8. **Nothing is deleted**: old Dashboard becomes "Topics", Pipeline stays
   (debug), Scheduler → "Calendar" label, Analytics → "Performance" label.
   "Run Pipeline" stays in the Topics view only.
9. Quick wins ride along: score-ring colors tied to decision thresholds
   (green ≥0.50 selected / amber 0.35–0.49 backup / red < 0.35), and the
   Recent Topics right rail is removed from the Topics view.

## 1. Inbox API — `GET /api/inbox`

One endpoint returns everything the view needs (single round trip):

```ts
{
  needsYou: Array<
    | { kind: "draft"; contentItemId: string; type: "post"|"carousel"|"reel";
        pageId: string; pageName: string; platform: string;
        topic: Topic;                     // full mapTopic shape — editor needs it
        hook: string; formattedCaption: string;  // formatCaption output for the page's platform
        imageUrl: string | null;          // first payload image if any
        createdAt: string }
    | { kind: "failed_publish"; publishJobId: string; contentItemId: string;
        pageId: string; pageName: string; platform: string; topicTitle: string;
        error: string | null; scheduledAt: string | null }
  >,
  activity: Array<{                        // newest first, limit 30
    id: string; kind: "cross_post"|"fast_track"|"recycle"|"trend_alert"|"posted";
    title: string; createdAt: string;
    pageName: string | null;
    outcome?: { engagementRate: number; nicheAvg: number } // posted items w/ 24h metric
  }>,
  digest: { postedSinceYesterday: number; automationSinceYesterday: number;
            topicsScoredSinceYesterday: number },
  nextScheduled: Array<{ publishJobId: string; topicTitle: string;
                         pageName: string; platform: string; scheduledAt: string }> // ≤3, soonest first
}
```

- `needsYou.draft`: content_items with status `qa_passed`, ALL pages, joined
  to topics + pages; formattedCaption computed server-side via formatCaption.
- `needsYou.failed_publish`: publish_jobs with status `failed`, joined for
  topic title. Retry reuses `PATCH /api/publish-jobs/:id` `publish-now`
  (already allows `failed`). Dismiss is a NEW `{"action":"dismiss"}` branch
  on that PATCH handler that deletes the row, allowed only when
  status='failed' (the existing `cancel` action only deletes `scheduled`
  jobs and is left unchanged).
- `activity`: automation_events UNION published publish_jobs (kind 'posted',
  title built server-side: `✓ Posted "{topic}" · {page}`), newest-first
  LIMIT 30 combined. Outcome joined from performance_metrics 24h + the same
  source-disciplined niche average used by the recycler (reuse/extract that
  CTE into a helper or duplicate it — implementation's choice, but the
  numbers must match the recycler's definition).
- `digest`: posted = publish_jobs with published_at > now()-24h; automation
  = automation_events with created_at > now()-24h; topicsScored = topics
  with `decision IS NOT NULL AND created_at > now()-24h` — i.e. NEW topics
  that got scored. (topics has no scored_at column and we deliberately add
  no schema for a digest line; re-scores of old topics aren't counted.
  Documented approximation.)
- Marking seen: opening the inbox marks automation events seen (reuse
  `POST /api/alerts/seen`). The bell stays (global affordance) and now
  agrees with the inbox.

## 2. InboxView — `src/web/views/InboxView.tsx`

Layout (single column, max-width ~760px, centered):

1. **Header row**: "Inbox" title + "Add topic" button (opens AddTopicDrawer,
   reused from components/pipeline/) + refresh.
2. **Digest strip** (always visible): "Since yesterday: **2** posted ·
   **5** automation actions · **32** topics scored" and, on a second line,
   next scheduled: "Next: {title} → {page} at {time}" (≤3).
3. **Needs-you lane**: heading "Needs you (N)". Draft cards:
   - page chip + type chip + topic title
   - rendered preview: image (if any) + formatted caption (clamped ~6 lines,
     expandable)
   - buttons: ✓ Approve · ✎ Edit · ✕ Reject
   - keyboard: A approve / R reject on the FOCUSED card; ↑/↓ or j/k move
     focus. Focus ring visible.
   - optimistic removal on approve/reject (rollback + toast on API error).
   Failed-publish cards: red-tinted, error text, Retry + Dismiss buttons.
   Empty lane: "Nothing needs you ✓" line (digest strip above carries the
   rest of the empty state).
4. **Activity lane**: heading "Activity", collapsed to the latest 10 with
   "Show all"; icon per kind (reuse AlertsBell mapping), relative time,
   page name, outcome chip (`6.4% eng`, green when ≥ nicheAvg, red below)
   on posted items that have one.

Approve → `POST /api/content/:id/approve` (existing; the schedule worker
picks it up within 30 min — the card's success toast says "Approved — will
be scheduled shortly"). Reject → existing `/reject`. Edit → `onOpenEditor(topic)`
(topic object comes from the inbox payload; editor return path = inbox).

## 3. Navigation rework

- `NavKey` gains `'inbox'`; default `activeNav` = `'inbox'`.
- Sidebar order + labels: **Inbox**, **Calendar** (key `scheduler`),
  **Performance** (key `analytics`), **Topics** (key `dashboard`),
  **Pipeline**, **Settings**. Keyboard: ⌘1 inbox, ⌘2 topics, ⌘3 calendar,
  ⌘4 performance, ⌘5 pipeline, ⌘, settings.
- The inbox is cross-page: it does NOT react to the sidebar page selector
  (a subtle "All pages" note in its header). All other views keep their
  per-page behavior.
- Editor `sourceNav` continues to work (returns to inbox when launched
  from inbox).

## 4. Topics-view quick wins

- ScoreRing colors by decision threshold: ≥50 → `var(--green)`,
  35–49 → amber, <35 → red (locate the ring's color logic; thresholds
  imported/mirrored from `topicDecision`'s 0.50/0.35 — UI scores are ×100).
- Remove the Recent Topics right rail from the Topics (Dashboard) view;
  the main list takes the full width. The rail component stays in the tree
  (unused) only if other views import it — otherwise delete the file.

## 5. Testing & verification

- Pure/unit: none of the new logic is pure enough to warrant new vitest
  suites EXCEPT the inbox repo's digest/activity SQL — verified live instead
  (same convention as other repo layers).
- E2E dry-run: seed a qa_passed draft + a failed job + events (some exist);
  GET /api/inbox returns all four sections correctly; approve from the
  API removes the draft from needsYou; failed job Retry flips it to
  publishing/published (stub); build + full suite green; visual pass via
  vite for the lanes/digest/keyboard flow.

## Out of scope

- Mobile layout, push notifications, per-rule automation config.
- Approve-all / bulk approve (judgment stays per-item).
- Removing the old Dashboard/Pipeline views (deliberately kept).
- Sprint D features (remixing, competitor ingestion).
