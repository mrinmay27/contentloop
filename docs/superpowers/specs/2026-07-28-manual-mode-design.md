# Manual Mode — Topic Discovery as a Choice: Design Spec

> Status: Draft for approval, 2026-07-28
> Goal: a creator who already knows what they want to post can use ContentLoop
> as an editor → scheduler → publisher, without being handed a queue of topics
> they never asked for.

---

## The problem, as it stands today

`ingest`, `score` and `generate` run on **every launch** (the catch-up pass in
`inProcessRunner.ts:25`) and again every 20 hours. There is **no way to turn
them off** — no config key, no setting, no flag.

So a creator who wants manual control downloads ContentLoop, opens it, and is
immediately handed a queue of topics they did not ask for, with LLM calls
running in the background for content they never wanted. For that audience the
product is actively hostile on first run.

Manual topic entry already exists (`POST /api/topics/manual`, the "+ Add"
button, Phase 1.5) and lands topics ready to edit. What is missing is the
ability to say "only mine".

## What this is NOT

**Not a second product.** One product, one switch. Every downstream capability
— editor, media spine, captions, scheduling, publishing, the learning loop —
is identical in both modes. Only whether topics arrive by themselves changes.

**Not the new default.** Discovery is the differentiator; without it
ContentLoop is a scheduler with an editor, competing with Buffer and Later on
their turf. Automatic stays recommended. The user is *asked*, not defaulted
into manual.

**Not a UI-only hide.** If the pipeline UI were hidden while the jobs still
ran, LLM calls would burn quietly in the background for content nobody sees —
worse than the current behaviour, not better.

## The switch

A single config key, `TOPIC_DISCOVERY`, values `auto` (default) or `manual`.

**Global, not per page.** Ingestion loops niches, and a niche can back several
pages, so a per-page flag has no clean meaning at the point the job runs.
Global matches the target user — one creator, self-hosting, one or two pages.
A per-page override can come later if multi-page users ask; guessing at it now
would add branching to every job for a case nobody has reported.

### Where the gate goes

**Inside the job bodies in `jobs.ts`, not in the schedulers.** Two runners
invoke jobs — `inProcessRunner` (desktop) and the BullMQ `Worker`
(server) — and both call `JOBS[name]()`. Gating at the job body means one
change covers both, with no way for one path to be missed. Gating in the
runners would need two edits kept in sync forever.

Gated: `ingest`, `score`, `generate`.
Not gated: `media`, `render`, `schedule`, `post`, `analyze` — those serve
content the user created by hand and must keep working.

Each gated job returns early with one clear log line
(`[ingest] skipped — topic discovery is set to manual`), so a puzzled user
grepping logs finds the reason rather than silence.

## Being asked, not defaulted

The question appears **once, on the welcome screen** — the first-run state
introduced when the empty-install dead end was fixed:

> **Where do your topics come from?**
> **○ Find them for me** *(recommended)* — ContentLoop watches your sources,
>   scores what's worth writing about, and drafts it. You approve.
> **○ I'll add them myself** — just the editor, scheduler and publisher. Add
>   topics with the + button whenever you have an idea.

Placed on the welcome screen rather than in the create-page wizard, because it
is an app-level mode, not a property of a page. Putting it in the wizard would
imply per-page behaviour the implementation does not have.

Always reversible, from **Settings → Pipeline → Topic discovery**, so a manual
user can graduate once they trust the automated path. The setting must state
what changes, not just its name.

## Honest empty states

Manual mode changes what "no topics" means, and the UI must say the right
thing rather than implying something is still coming:

| Surface | Auto mode | Manual mode |
|---|---|---|
| Inbox, nothing yet | "Nothing needs you right now" | "No topics yet — add one with + to get started" |
| Topics, empty | "Discovery hasn't run yet" | "You haven't added any topics yet" |
| Pipeline view | Stage counts and Run buttons | Hidden — those stages do not run |

**The Pipeline nav item is hidden in manual mode.** Leaving a "Run Next Step"
button that silently does nothing would recreate exactly the dead-control
failure this project has spent a week removing.

## What manual users keep

Everything downstream, unchanged: the content editor, all four media routes
(own footage, Pexels stock, AI-generated, Canva), captions, approval,
scheduling, publishing, and — importantly — **the learning loop**. It feeds on
published performance, not on ingestion, so a manual creator still accumulates
format and keyword learning. The differentiator survives the switch.

They also need **no API key at all** unless they want AI-written captions.

## Non-goals

- Per-page discovery settings (revisit only if multi-page users ask).
- Removing or hiding the "+ Add" flow in auto mode — both coexist today and
  should continue to.
- Deleting already-ingested topics when switching to manual. Switching changes
  what happens next; it must not destroy existing work. A separate, clearly
  labelled "clear the pipeline" action already exists.
- Auto-publishing. Approval stays mandatory in both modes.

## Testing

- **Pure/unit (vitest):** the mode resolver (`resolveDiscoveryMode`) including
  an unknown stored value falling back to `auto` rather than silently
  disabling the pipeline, and `shouldRunJob(job, mode)` covering which jobs are
  gated.
- **Live, this machine:** with `TOPIC_DISCOVERY=manual`, launch a fresh
  instance and confirm the catch-up pass logs the skip for ingest/score/
  generate, that no topics appear, that `post`/`schedule` still run, and that a
  manually added topic still reaches the editor and can be scheduled.
- Flipping back to `auto` must resume discovery on the next run with no
  restart required (configStore already writes through without one).

## Order

```
1. resolveDiscoveryMode + shouldRunJob (pure, tested)
2. Gate the three job bodies + config key
3. Welcome-screen question + Settings toggle
4. Honest empty states; hide Pipeline nav in manual mode
5. Live verification both ways
```

Steps 1–2 are the substance: without them the switch is cosmetic. Steps 3–4
are what stop it being another capability nobody can find.
