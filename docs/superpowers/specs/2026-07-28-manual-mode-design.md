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

## The switch — per page, not global

**Revised 2026-07-28 after the user asked the obvious question:** if the mode
is global and I choose manual, what happens when I later add a page I *do*
want automated?

The first draft punted on per-page, reasoning it would add branching to every
job. Reading the code shows that was wrong:

- `ingest()` already loops niches and already calls `listPages(niche.id)`.
  Skipping a niche whose pages all want manual is a two-line change at a
  boundary that exists.
- `score()` selects `WHERE state = 'IDEA'`. Manual topics are created as
  CONTENT_READY and skip scoring entirely, and a manual niche ingests nothing —
  so there are no IDEA topics from it. **`score` needs no gate.**
- `generate()` works from selected topics, of which a manual niche has none.
  **`generate` needs no gate either.**

So per-page is *simpler* than the global switch I first specced, not harder:
**one gate, in `ingest`, instead of three.**

`pages.brand.discovery` — `'auto'` (default) or `'manual'` — stored alongside
`tone` and `slideCount`, which already live there. No migration.

A niche is ingested when **any** page under it wants discovery. A niche backing
both an automated and a manual page still ingests; the manual page simply is
not where those topics are worked. That is the correct reading of "any page
wants this", and it avoids one page silently starving another.

### Where the gate goes

Inside `ingest()` in `jobs.ts`, not in the schedulers. Two runners invoke jobs
(`inProcessRunner` for desktop, the BullMQ `Worker` for server) and both call
`JOBS[name]()`, so gating at the job body covers both with no chance of one
path drifting from the other.

The skip logs one clear line per niche
(`[ingest] skipping "AI Tools" — all its pages are set to manual`), so a
puzzled user grepping logs finds the reason rather than silence.

## Being asked, not defaulted

Asked **twice, at the two moments it means something**:

**1. First run**, on the welcome screen — this sets the default for pages
created afterwards:

> **Where do your topics come from?**
> **○ Find them for me** *(recommended)* — ContentLoop watches your sources,
>   scores what's worth writing about, and drafts it. You approve.
> **○ I'll add them myself** — just the editor, scheduler and publisher.

**2. Per page**, in the create-page wizard's Branding step beside tone and
carousel length, pre-filled from that first-run answer. This is what makes the
user's case work: pick manual at first run, then create a second page and set
it to automatic, and discovery runs for that page's niche only.

Changeable afterwards from **Settings → Pipeline**, per page. The control must
state what changes, not merely its name.

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

**AI stays fully available, and this distinction matters.** Manual mode turns
off *unattended discovery*, not AI assistance. Everything on-demand keeps
working and stays visible:

- "Generate via connected LLM" for scripts and captions in the editor
- The subscription bridges (ChatGPT/Gemini for text, Veo/Canva/Runway for video)
- Whisper transcription for uploaded footage
- Settings → AI / LLM, unchanged and reachable

A manual creator can run with **no key at all**, or add one purely to write
captions for topics they chose themselves. Hiding AI settings in manual mode
would be a misreading of what the mode is for.

## Non-goals

- A global kill switch separate from the per-page setting. Per page is
  sufficient and there is no case for both.
- Removing or hiding the "+ Add" flow in auto mode — both coexist today and
  should continue to.
- Deleting already-ingested topics when switching to manual. Switching changes
  what happens next; it must not destroy existing work. A separate, clearly
  labelled "clear the pipeline" action already exists.
- Auto-publishing. Approval stays mandatory in both modes.

## Testing

- **Pure/unit (vitest):** `resolveDiscoveryMode(brand)` — unknown or missing
  values fall back to `auto`, never silently disabling the pipeline — and
  `shouldIngestNiche(pages)`, covering: no pages, all manual, all auto, and the
  mixed case where one automated page keeps the niche ingesting.
- **Live, this machine:** create two pages on different niches, one manual and
  one automatic, then run `ingest` and confirm it skips the manual niche by
  name, ingests the automatic one, and that `post`/`schedule` still run for
  both. Then add a topic by hand to the manual page and confirm it reaches the
  editor and can be scheduled and published.
- Flipping a page back to automatic must resume discovery on the next run with
  no restart — the setting lives in `pages.brand`, which is read per run.

## Order

```
1. resolveDiscoveryMode + shouldIngestNiche (pure, tested)
2. Gate ingest() only — score/generate need no change
3. First-run question + per-page control in the wizard + Settings
4. Honest empty states; hide Pipeline nav for a manual page
5. Live verification: manual page ingests nothing, automatic page still does,
   and a mixed niche keeps working
```

Steps 1–2 are the substance. Steps 3–4 are what stop it being another
capability nobody can find. Step 5's mixed case is the one most likely to
break and the one the user actually asked about.
