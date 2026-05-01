# Handoff: TPCE — Theme Page Content Engine

## Overview

TPCE is a full-featured **content operating system** for managing multiple automated theme pages across social platforms (Instagram, Twitter/X, etc.). It functions as a SaaS web dashboard covering the full content lifecycle: topic ingestion → scoring → content generation → review → scheduling → publishing → analytics.

## About the Design Files

The files in this bundle are **high-fidelity HTML prototypes** — not production code. They demonstrate the intended look, layout, behavior, and interactions of the product. Your task is to **recreate these designs** in your target codebase (React, Next.js, Vue, etc.) using its established component libraries, routing patterns, and state management conventions.

Do **not** ship the HTML files directly. Use them as a pixel-accurate reference.

To preview the design: open `TPCE Dashboard.html` in a browser (Chrome recommended). All data is mocked in `app-data.js`.

---

## Fidelity

**High-fidelity.** Colors, typography, spacing, border radii, shadows, hover states, animations, and copy are all final. Recreate pixel-perfectly.

---

## Tech Stack (Prototype)

| Concern | Used in Prototype | Suggested for Production |
|---|---|---|
| UI Framework | React 18 + Babel | React 18 + TypeScript |
| Styling | Plain CSS variables | CSS Modules or Tailwind |
| State | useState / useEffect | Zustand or Redux Toolkit |
| Data | Mock (app-data.js) | REST API / GraphQL |
| Routing | Single-page (no router) | Next.js App Router |
| Fonts | Google Fonts CDN | Self-hosted or next/font |

---

## Design Tokens

### Typography
```
Font (UI):      DM Sans — weights 300, 400, 500, 600, 700
Font (Numbers): DM Mono — weights 300, 400, 500
Base size:      13px
Line height:    1.5
Smoothing:      antialiased
```

### Colors — Light Mode (default)
```
--bg-base:        #F7F6F4   /* Page background */
--bg-surface:     #FFFFFF   /* Cards, sidebar, panels */
--bg-elevated:    #F0EEEC   /* Inputs, secondary cards */
--bg-hover:       #ECEAE8   /* Hover state background */
--bg-active:      #E4E2E0   /* Active/pressed state */
--border:         rgba(0,0,0,0.07)
--border-strong:  rgba(0,0,0,0.12)
--text-primary:   #1A1918
--text-secondary: #6B6866
--text-muted:     #A8A5A2
--accent:         #D4890A   /* Primary amber (light mode) */
--accent-dim:     rgba(212,137,10,0.10)
--accent-glow:    rgba(212,137,10,0.06)
--green:          oklch(0.72 0.15 155)   ≈ #22C77A
--green-dim:      oklch(0.72 0.15 155 / 0.15)
--red:            oklch(0.65 0.18 25)    ≈ #E05C3A
--red-dim:        oklch(0.65 0.18 25 / 0.15)
--blue:           oklch(0.68 0.14 250)   ≈ #4B8CE8
--blue-dim:       oklch(0.68 0.14 250 / 0.15)
--purple:         oklch(0.68 0.16 295)   ≈ #9B6EE8
--shadow:         0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)
--shadow-lg:      0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)
```

### Colors — Dark Mode (`[data-theme="dark"]`)
```
--bg-base:        #100F0E
--bg-surface:     #181716
--bg-elevated:    #201F1E
--bg-hover:       #2A2927
--bg-active:      #323130
--border:         rgba(255,255,255,0.07)
--border-strong:  rgba(255,255,255,0.12)
--text-primary:   #F5F3F0
--text-secondary: #9B9693
--text-muted:     #5A5855
--accent:         #F5A623   /* Primary amber (dark mode) */
--accent-dim:     rgba(245,166,35,0.15)
--accent-glow:    rgba(245,166,35,0.08)
--shadow:         0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.2)
--shadow-lg:      0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)
```
> Toggle: set `data-theme="dark"` on `<html>`. All tokens cascade automatically.

### Spacing & Shape
```
--radius:     10px   (cards, modals)
--radius-sm:  6px    (buttons, inputs, badges)
Sidebar:      240px wide (tweakable via --sidebar-w)
Topbar:       ~48px tall
```

---

## App Layout

```
┌─────────────────────────────────────────────────────────┐
│  Sidebar (240px)   │  Main area (flex: 1)               │
│  ─────────────     │  ─────────────────────────────────  │
│  Logo              │  Topbar (48px, sticky)             │
│  Nav items         │  ────────────────────────────────  │
│  Theme Pages list  │  View content (scrollable)         │
│  + New Page btn    │                                    │
│  Version / theme   │  [optional right panel: 280px]     │
└─────────────────────────────────────────────────────────┘
```

- `display: flex; height: 100vh; overflow: hidden`
- Sidebar: `flex-shrink: 0`, scrollable pages list
- Main: `flex: 1; min-width: 0; display: flex; flex-direction: column`
- Right panel: `width: 280px; flex-shrink: 0; border-left` (Dashboard view only)

---

## Screens / Views

### 1. Dashboard (default view)

**Purpose:** Per-theme-page overview. Monitor metrics, manage the content pipeline, review and act on topics.

**Layout:**
- Topbar: page name, niche, follower count, search input, Filter button, Run Pipeline CTA
- Metrics row: 6 cards in `grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr))`
- Pipeline bar: horizontal 5-step clickable bar
- Bulk action bar: appears when topics are selected (amber tinted)
- Tabs: Review / Approved / Scheduled / Posted
- Topic cards list: vertical stack with 8px gap
- Right panel: Recent Topics feed with source filters

**Metric Cards (×6):**
- Topics · Selected · QA Ready · Approved · Scheduled · Posted
- Each: white bg, 10px radius, 14px×16px padding
- Label: 10px, uppercase, letter-spacing 0.08em, `--text-muted`
- Value: 28px, bold, `DM Mono`, colored per metric
- Delta: 10px, `DM Mono`, `--green`
- Top border accent: `2px solid {color}22`

**Pipeline Bar:**
- 5 steps: Ingest → Score → Generate → Review → Schedule
- Each step: `flex: 1; min-width: 0; overflow: hidden; padding: 10px`
- Step name: 11px uppercase, `--text-muted`
- Step count: 20px bold `DM Mono`
- Step status: 11px, color-coded (green=Running, amber=Processing, default=other)
- Running indicator: 5px pulsing green dot
- Active step: `background: var(--accent-glow)` + 2px amber bottom border
- Dividers: 1px `--border` between steps

**Topic Card:**
- `display: flex; gap: 12px; align-items: flex-start`
- Checkbox (16×16, 4px radius), checked = amber fill
- Title: 13px, weight 500, `--text-primary`
- Meta row: platform badge + score ring (28px SVG) + tags + status badge
- Action buttons: edit (surface) + trash (danger) — visible on hover
- Hover: `translateY(-1px)` + shadow lift + stronger border
- Selected: amber border + `--accent-glow` background

**Score Ring:** SVG circle, 28–36px, colored by score (≥85 green, ≥70 amber, else red). Number centered in `DM Mono`.

**Status Badges:**
```
review    → badge-amber  (amber bg/text)
approved  → badge-green  (green bg/text)
scheduled → badge-blue   (blue bg/text)
posted    → badge-muted  (elevated bg, secondary text)
```
All badges: 99px border-radius, 11px `DM Mono`, 2px 8px padding.

**Platform Badges:** `Reddit` #FF4500, `X` #1DA1F2, `Trends` #4285F4, `RSS` #FFA500. Color bg at 13% opacity.

**Right Source Panel:**
- Header: "Recent Topics" label + Refresh button
- Source filter chips: All / Reddit / Twitter/X / Google Trends / RSS
- Active chip: amber border + accent bg
- Source cards: elevated bg, 10px 12px padding, title + platform badge + score ring + Select/Discard buttons

---

### 2. Content Pipeline View

**Purpose:** Full list of all topics across all statuses for bulk management.

**Layout:** Same as Dashboard without the metrics/pipeline bar at top and without the right panel. Shows all 8 topics. Run All Steps button in topbar.

---

### 3. Content Editor (Modal)

**Purpose:** Edit and preview content for a single topic before approval.

**Trigger:** Click edit (pencil) button on any topic card.

**Layout:** Full-screen modal overlay (`backdrop-filter: blur(4px)`)
- Modal: 92vw × 88vh, max 1100px wide, 16px radius
- Header: topic title + status badge + Save Draft + Approve buttons + close
- Body: 2-column grid `1fr 320px`

**Left — Editor:**
- Hook textarea (3 rows)
- Caption textarea (4 rows)
- Carousel slides list: numbered items, inline editable text, remove ×, Add button
- CTA input
- Branding row: color swatches + "Use default branding" checkbox

**Right — Preview Panel:**
- Tabs: Post / Carousel / Reel (pill-style, amber active)
- Phone mockup: 200px wide, 28px radius, notch, IG header with avatar
- Post preview: content on dark/elevated bg
- Carousel preview: slide counter + dot pagination
- Reel preview: play button overlay + caption overlay
- Canva integration buttons: "Open in Canva" + "Use Template"

**Textarea styles:**
- bg: `--bg-elevated`, border: `--border`, 6px radius
- focus: amber border + `0 0 0 3px var(--accent-dim)` box-shadow
- Font: DM Sans 13px, line-height 1.6

---

### 4. Scheduler View

**Purpose:** Visual calendar + queue for scheduling posts.

**Layout:**
- Topbar: month/year nav (← Month Year →), legend, Schedule Post button
- 7-column day-name header row
- Calendar grid: 7×N cells, 1px gap, bg = `--border`
- Below calendar: "Upcoming Queue" list

**Calendar Cell:**
- bg: `--bg-surface`, min-height 90px, 8px padding
- Today cell: `--accent-glow` background
- Other month dates: `--text-muted` color
- Events: small pills, 10px font, colored by type:
  - Carousel → amber (#F5A623)
  - Reel → blue
  - Post → green

**Queue List:**
- Each row: colored type dot + title + date/time (DM Mono) + type badge + edit button
- bg: `--bg-surface`, 1px border, 6px radius

---

### 5. Analytics View

**Purpose:** Performance metrics per theme page.

**Layout:**
- Topbar: title, page name with dot, time period selector (7d/30d/90d/All)
- 4-column stats row (same card style as metrics)
- 2-column analytics grid:
  - Views chart (spans 2 cols): stacked bar chart with views (amber) + saves (green)
  - Content Type Performance: horizontal bar chart
  - Top Posts: ranked list with type badges

**Bar Chart:**
- `display: flex; align-items: flex-end; height: 120px`
- Each bar: amber fill, hover darkens, 3px 3px 0 0 border-radius
- Month labels below: 10px DM Mono, `--text-muted`

**Performance Bars:**
- Track: 4px height, `--bg-hover` bg
- Fill: amber, animated width

**Top Posts List:**
- Rank number (20×20 elevated square)
- Title (truncated) + views/saves sub-labels
- Type badge (muted)

---

### 6. Settings View

**Purpose:** Manage integrations and global branding defaults.

**Layout (max-width 680px):**
- Integrations section: Canva / Instagram / Twitter cards
- Global Branding: color picker + font + tone + logo upload
- Pipeline Defaults: numeric settings

**Integration Card:**
- `display: flex; align-items: center; gap: 14px`
- Icon box: 36×36, 8px radius, elevated bg
- Name (13px bold) + description (12px secondary)
- Connected badge (green dot) + Connect/Disconnect button

---

### 7. Create New Theme Page (4-Step Modal)

**Trigger:** "+ New Theme Page" button in sidebar.

**Modal:** 720px wide, 4-step wizard with step indicator.

**Step Indicator:**
- 4 dots connected by lines
- Dot: 28px circle, border, number inside
- Active: amber fill + black number
- Done: green fill + checkmark
- Connector line: 1px `--border`

**Step 1 — Niche Selector:**
- Search input at top
- 3-column grid of niche cards
- Each niche card: name + emoji, trend score bar (amber), monetization score bar (green), competition badge, growth % indicator
- Only one selection allowed; selected = amber border + glow bg

**Step 2 — Keywords:**
- Context box showing selected niche
- Editable tag cloud: click tag to remove
- Add custom keyword input + Regenerate button

**Step 3 — Name Generator:**
- Custom name input at top
- Scrollable list of 12 name suggestions
- Each: name + "✓ Available" indicator
- Regenerate button

**Step 4 — Branding:**
- Logo upload zone (dashed border, drag target)
- 8 color swatches (amber, green, indigo, red, sky, pink, violet, teal)
- Font style chips: Clean & Modern / Bold Display / Editorial / Minimal
- Caption tone buttons: Educational / Bold & Direct / Casual / Professional

**Modal Footer:** Back + Continue/Create buttons. Continue disabled until step is complete.

---

## Component Inventory

| Component | Location in file | Notes |
|---|---|---|
| `Icon` | ~line 470 | Inline SVG micro-icons, accepts `name` + `size` props |
| `PlatformBadge` | ~line 520 | Colored label for Reddit/Twitter/Trends/RSS |
| `ScoreRing` | ~line 530 | SVG donut with score number |
| `Sidebar` | ~line 550 | Full left nav + page list |
| `PipelineBar` | ~line 620 | 5-step horizontal pipeline |
| `MetricCards` | ~line 650 | 6-metric grid |
| `TopicCard` | ~line 670 | Individual topic item |
| `TopicSourcePanel` | ~line 695 | Right panel feed |
| `DashboardView` | ~line 730 | Main dashboard composition |
| `ContentEditor` | ~line 860 | Full editor modal |
| `SchedulerView` | ~line 980 | Calendar + queue |
| `AnalyticsView` | ~line 1060 | Charts + top posts |
| `SettingsView` | ~line 1150 | Integrations + branding |
| `CreatePageModal` | ~line 1200 | 4-step creation wizard |
| `App` | ~line 1480 | Root component + state |

---

## Interactions & Animations

### Entry Animations
```css
/* Fade up on mount */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}

/* Scale in for modals */
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.97); }
  to   { opacity: 1; transform: scale(1); }
}
```

- Cards in a list use `.stagger` — each child gets `animation-delay: n * 40ms`
- Modals: overlay fades in 150ms, box scales in 200ms
- View changes: fade + translateY(4px) → none, 250ms

### Hover States
| Element | Hover effect |
|---|---|
| Nav item | `--bg-hover` bg, `--text-primary` color |
| Topic card | `translateY(-1px)` + shadow + `--border-strong` |
| Source card | `--border-strong` border |
| Button (ghost) | `--bg-hover` bg + stronger border |
| Button (primary) | `filter: brightness(1.1)` + glow shadow |
| Niche card | `--bg-hover` bg + `--border-strong` |
| Calendar cell | `--bg-hover` bg |

### Transitions
- Most transitions: `0.15s ease` on `background`, `border-color`, `color`, `box-shadow`
- Topic card: `all 0.15s` (to catch transform)
- Modal: `backdrop-filter` via CSS animation

### Pipeline Step: active state
```css
.pipeline-step.active {
  background: var(--accent-glow);
}
.pipeline-step.active::after {
  content: '';
  position: absolute; bottom: 0; left: 0; right: 0;
  height: 2px;
  background: var(--accent);
}
```

### Running indicator (pulse)
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}
/* 5px circle, green, animation: pulse 1.5s infinite */
```

---

## State Management

### Global App State
```typescript
interface AppState {
  theme: 'light' | 'dark';
  activeNav: 'dashboard' | 'pipeline' | 'scheduler' | 'analytics' | 'settings';
  activePage: string;          // theme page ID
  pages: ThemePage[];
  showCreateModal: boolean;
  editingTopic: Topic | null;
}
```

### Theme Pages
```typescript
interface ThemePage {
  id: string;
  name: string;
  niche: string;
  status: 'active' | 'paused';
  accent: string;   // hex color
  posts: number;
  followers: string;
}
```

### Topics
```typescript
interface Topic {
  id: string;
  title: string;
  source: string;
  score: number;          // 0-100
  tags: string[];
  status: 'review' | 'approved' | 'scheduled' | 'posted';
  platform: 'reddit' | 'twitter' | 'trends' | 'rss';
}
```

### Dashboard View State
```typescript
interface DashboardState {
  pipelineStep: string;        // active pipeline step
  selectedTopics: Set<string>; // bulk selection
  activeTab: 'review' | 'approved' | 'scheduled' | 'posted';
}
```

### Create Page Wizard State
```typescript
interface WizardState {
  step: 1 | 2 | 3 | 4;
  selectedNiche: string | null;
  keywords: string[];
  selectedName: string | null;
  primaryColor: string;
}
```

---

## Mock Data (app-data.js)

Stub this out with real API calls in production:

| Data | API suggestion |
|---|---|
| `themePages` | `GET /api/pages` |
| `niches` | `GET /api/niches` (cached, rarely changes) |
| `topics` | `GET /api/pages/:id/topics?status=review` |
| `metrics` | `GET /api/pages/:id/metrics` |
| `analyticsData` | `GET /api/pages/:id/analytics?period=30d` |
| `schedulerSlots` | `GET /api/pages/:id/schedule?month=2026-05` |

---

## Keyboard Shortcuts (Visual Only — Wire Up)

| Shortcut | Action |
|---|---|
| ⌘1 | Go to Dashboard |
| ⌘2 | Go to Pipeline |
| ⌘3 | Go to Scheduler |
| ⌘4 | Go to Analytics |
| ⌘, | Go to Settings |
| ⌘K | Focus search |

---

## Dark / Light Mode

- Apply `data-theme="dark"` to `<html>` for dark mode
- All colors are CSS variables — no hardcoded colors in components
- Accent color in light mode: `#D4890A` (darker amber for contrast)
- Accent color in dark mode: `#F5A623` (brighter amber)
- On mode switch: also call `document.body.style.removeProperty('background-color')` to clear any injected inline styles

---

## Scrollbars
```css
::-webkit-scrollbar       { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 2px; }
```

---

## Assets

- No external images — all visuals are CSS + inline SVG
- Icons: custom inline SVG micro-icons (see `Icon` component)
- Fonts: DM Sans + DM Mono from Google Fonts
  - Production: self-host via `fontsource` or `next/font/google`

---

## Files in This Package

| File | Purpose |
|---|---|
| `TPCE Dashboard.html` | Full hi-fi prototype — open in Chrome to preview |
| `app-data.js` | Mock data — all entities, metrics, topics, schedule |
| `tweaks-panel.jsx` | In-design tweaks shell (React component) — dev reference only |
| `README.md` | This document |

---

## Suggested Folder Structure (Next.js)

```
src/
  app/
    page.tsx                    ← redirect to /dashboard
    layout.tsx                  ← sidebar + shell
    dashboard/page.tsx
    pipeline/page.tsx
    scheduler/page.tsx
    analytics/page.tsx
    settings/page.tsx
  components/
    layout/
      Sidebar.tsx
      Topbar.tsx
    dashboard/
      MetricCards.tsx
      PipelineBar.tsx
      TopicCard.tsx
      TopicSourcePanel.tsx
    editor/
      ContentEditor.tsx
      PhonePreview.tsx
    scheduler/
      CalendarGrid.tsx
      UpcomingQueue.tsx
    analytics/
      BarChart.tsx
      PerformanceBars.tsx
      TopPosts.tsx
    modals/
      CreatePageModal.tsx
      WizardSteps.tsx
    ui/
      Badge.tsx
      ScoreRing.tsx
      PlatformBadge.tsx
      Button.tsx
      Icon.tsx
  styles/
    tokens.css                  ← CSS variables (copy from prototype)
    globals.css
  lib/
    api.ts
    types.ts
```
