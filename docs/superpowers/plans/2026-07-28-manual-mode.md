# Manual Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator can set a page to manual so ContentLoop stops looking for topics for it, while everything downstream — editor, media, captions, scheduling, publishing, AI on demand — works exactly as before.

**Architecture:** One flag, `pages.brand.discovery` (`auto` | `manual`), read at run time. A single gate in `ingest()` skips a niche when **all** its pages are manual; `score` and `generate` need no change because a manual niche produces no `IDEA` topics. Spec: `docs/superpowers/specs/2026-07-28-manual-mode-design.md`.

**Tech Stack:** TypeScript ESM (`.js` suffixes in `src/`), React, vitest.

**Conventions:** gates = `npx vitest run` (328 currently) + `npx tsc -p tsconfig.json --noEmit` + `npm run build`. READ every file before modifying. Commit per task. Never bind port 4000; test on a spare port with a temp `CONTENTLOOP_DATA_DIR`.

---

### Task 1: Discovery mode resolution (TDD)

**Files:**
- Create: `src/domain/discovery.ts`
- Test: `tests/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveDiscoveryMode, shouldIngestNiche } from "../src/domain/discovery.js";

describe("resolveDiscoveryMode", () => {
  it("defaults to auto when unset", () => {
    expect(resolveDiscoveryMode(undefined)).toBe("auto");
    expect(resolveDiscoveryMode({})).toBe("auto");
  });
  it("reads a stored choice", () => {
    expect(resolveDiscoveryMode({ discovery: "manual" })).toBe("manual");
  });
  it("falls back to auto on an unknown value, never silently disabling", () => {
    // Disabling the pipeline by accident is far worse than ignoring junk.
    expect(resolveDiscoveryMode({ discovery: "nonsense" })).toBe("auto");
  });
});

describe("shouldIngestNiche", () => {
  const page = (discovery?: string) => ({ brand: discovery ? { discovery } : {} });
  it("ingests when a page wants discovery", () => {
    expect(shouldIngestNiche([page("auto")])).toBe(true);
  });
  it("skips when every page is manual", () => {
    expect(shouldIngestNiche([page("manual"), page("manual")])).toBe(true === false);
  });
  it("ingests a mixed niche — one automatic page must not be starved by a manual one", () => {
    expect(shouldIngestNiche([page("manual"), page("auto")])).toBe(true);
  });
  it("ingests when a niche has no pages yet, since nothing has opted out", () => {
    expect(shouldIngestNiche([])).toBe(true);
  });
  it("treats a page with no brand as automatic", () => {
    expect(shouldIngestNiche([{} as any])).toBe(true);
  });
});
```

**Note:** `toBe(true === false)` above is awkward — write `toBe(false)`.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/discovery.test.ts`

- [ ] **Step 3: Implement**

```ts
/** Whether ContentLoop looks for topics on its own for a given page.
 *
 *  Manual turns off unattended DISCOVERY only. On-demand AI — script and
 *  caption generation, the subscription bridges, Whisper transcription — stays
 *  fully available, as do scheduling, publishing and the learning loop.
 *
 *  Pure — no I/O.
 */

export type DiscoveryMode = "auto" | "manual";

export function resolveDiscoveryMode(brand: { discovery?: string } | undefined): DiscoveryMode {
  // Anything unrecognised resolves to auto: accidentally disabling a user's
  // pipeline is far worse than ignoring a junk value.
  return brand?.discovery === "manual" ? "manual" : "auto";
}

/** A niche is ingested when ANY page under it wants discovery, so one
 *  automatic page is never starved by a manual sibling. A niche with no pages
 *  still ingests — nothing has opted out. */
export function shouldIngestNiche(pages: Array<{ brand?: { discovery?: string } }>): boolean {
  if (pages.length === 0) return true;
  return pages.some((page) => resolveDiscoveryMode(page.brand) === "auto");
}
```

- [ ] **Step 4: Run tests + `npx tsc -p tsconfig.json --noEmit`**
- [ ] **Step 5: Commit** — `feat(discovery): per-page discovery mode resolution`

---

### Task 2: Gate ingest()

**Files:** Modify `src/worker/jobs.ts`

- [ ] **Step 1: Add the gate**

READ `src/worker/jobs.ts`. `ingest()` already loops niches and calls
`listPages(niche.id)`. Reorder so pages are fetched before the skip check:

```ts
export async function ingest(): Promise<void> {
  const { shouldIngestNiche } = await import("../domain/discovery.js");
  const niches = await listNiches();
  for (const niche of niches) {
    const pages = await listPages(niche.id);
    // Skip a niche only when every page under it is set to manual. Logged by
    // name so a puzzled user grepping logs finds the reason, not silence.
    if (!shouldIngestNiche(pages)) {
      console.log(`[ingest] skipping "${niche.name}" — all its pages are set to manual`);
      continue;
    }
    const pageId = pages[0]?.id;
    const trends = await ingestForNiche(niche, pageId);
    for (const trend of trends) {
      await upsertRawTrend(niche.id, trend);
    }
  }
}
```

Do **not** gate `score` or `generate` — a manual niche produces no `IDEA`
topics, so they already do nothing for it. Adding gates there would be dead
code.

- [ ] **Step 2: Typecheck + build + commit** — `feat(discovery): skip ingestion for niches whose pages are all manual`

---

### Task 3: Per-page control in Settings → Sources

**Files:** Modify `src/web/components/settings/SourcesPanel.tsx`

- [ ] **Step 1: Add the toggle above the source list**

READ the file first. It already has `pageId`, a `PageSelector`, and loads via
`api.getSources(pageId)`. Add a discovery toggle that reads and writes
`pages.brand.discovery` through `api.getBranding` / `api.patchBranding`:

```tsx
<div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius-sm)',
  padding:12, marginBottom:14 }}>
  <div style={{ fontSize:12, fontWeight:600, marginBottom:6 }}>Topic discovery</div>
  <div style={{ display:'flex', gap:8, marginBottom:8 }}>
    {(['auto','manual'] as const).map(mode => (
      <button key={mode} onClick={() => saveDiscovery(mode)}
        style={{
          fontSize:11, padding:'4px 12px', borderRadius:'var(--radius-sm)', cursor:'pointer',
          border:`1px solid ${discovery === mode ? 'var(--accent)' : 'var(--border)'}`,
          background: discovery === mode ? 'var(--accent-dim)' : 'transparent',
          color:'var(--text-primary)',
        }}>
        {mode === 'auto' ? 'Automatic' : 'Manual'}
      </button>
    ))}
  </div>
  <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.6 }}>
    {discovery === 'manual'
      ? <>ContentLoop won’t look for topics for this page — add them yourself with <strong>+</strong>.
          The sources below stay saved and resume if you switch back.</>
      : <>ContentLoop watches these sources and brings you topics to approve.</>}
  </div>
</div>
```

`saveDiscovery` calls `api.patchBranding(pageId, { discovery: mode })` and
updates local state. When `discovery === 'manual'`, render the source list
below with `opacity: 0.45` and `pointerEvents: 'none'` — **inactive, not
hidden**, so it is obvious the configuration is retained rather than lost.

- [ ] **Step 2: Typecheck + build + commit** — `feat(discovery): per-page topic-discovery switch in Settings → Sources`

---

### Task 4: Ask at the two moments it matters

**Files:**
- Modify: `src/web/components/layout/StartupScreens.tsx` (welcome screen)
- Modify: `src/web/components/modals/CreatePageModal.tsx`
- Modify: `src/web/App.tsx` (pass the first-run answer through)

- [ ] **Step 1: First-run question on the welcome screen**

Add two option cards below the existing "Create your first theme page" button,
storing the answer in `localStorage` under `contentloop_discovery_default`.
It is a UI default for the next page created, not server state — so
`localStorage` is the right home and needs no endpoint.

> **Where do your topics come from?**
> **Find them for me** *(recommended)* — ContentLoop watches your sources,
> scores what's worth writing about, and drafts it. You approve.
> **I'll add them myself** — just the editor, scheduler and publisher.

- [ ] **Step 2: Per-page control in the wizard**

In `CreatePageModal`'s Branding step, beside tone and carousel length, add the
same Automatic/Manual pair, initialised from
`localStorage.getItem('contentloop_discovery_default') ?? 'auto'`, and include
it in the create payload: `brand: { accent, tone, slideCount, discovery }`.

- [ ] **Step 3: Typecheck + build + commit** — `feat(discovery): ask at first run and per page`

---

### Task 5: Honest empty states, and hide Pipeline for a manual page

**Files:**
- Modify: `src/web/components/layout/Sidebar.tsx`
- Modify: `src/web/views/DashboardView.tsx`
- Modify: `src/web/App.tsx`

- [ ] **Step 1: Hide the Pipeline nav item when the active page is manual**

`Sidebar` receives `pages` and `activePage`. Filter the `pipeline` entry out of
`NAV_ITEMS` when the active page resolves to manual. A "Run Next Step" button
that silently does nothing is exactly the dead-control failure this project has
spent a week removing.

If the user is *on* Pipeline when they switch to a manual page, send them to
`inbox` rather than leaving them on a hidden view.

- [ ] **Step 2: Empty states that say the right thing**

Where DashboardView renders `empty-state` with a "discovery hasn't run" style
message, branch on the mode: manual pages say *"You haven't added any topics
yet — use + to add one"*, not anything implying something is still coming.

- [ ] **Step 3: Typecheck + build + commit**

---

### Task 6: Live verification

**Files:** none (verification only)

- [ ] **Step 1: Two pages, two modes**

```bash
npm run build
FRESH=$(mktemp -d)
CONTENTLOOP_DATA_DIR="$FRESH" PORT=4771 CONTENTLOOP_MODE=desktop \
  nohup node dist/src/desktop/main.js > "$FRESH/app.log" 2>&1 &
until curl -fsS http://localhost:4771/api/health >/dev/null 2>&1; do sleep 2; done
```

Create two niches via `POST /api/niches/preset` (e.g. `n1` and `n4`) and a page
on each — one with `brand.discovery = "manual"`, one `"auto"`. Then trigger
ingestion with `POST /api/jobs/ingest` and confirm from the log:

- the manual niche is skipped **by name**
- the automatic niche ingests
- topics exist only for the automatic niche

- [ ] **Step 2: The mixed case — the one most likely to break**

Add a second page to the *manual* niche with `discovery: "auto"`, run ingest
again, and confirm the niche now ingests. This is the case the user asked
about; report the actual log lines.

- [ ] **Step 3: Downstream still works for a manual page**

Add a topic by hand (`POST /api/topics/manual`) to the manual page's niche and
confirm it reaches the editor (`POST /api/content/draft` succeeds) and that
`schedule`/`post` jobs still run for it.

- [ ] **Step 4: Clean up + full gates**

```bash
pkill -f "dist/src/desktop/main.js"; rm -rf "$FRESH"
npx vitest run && npx tsc -p tsconfig.json --noEmit && npm run build
docker compose ps
```

- [ ] **Step 5: Commit**
