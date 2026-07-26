# Sprint D2 Phase 2 — One-Click Launcher: Design Spec

> Status: Approved design, 2026-07-24
> Goal: a non-technical user gets TPCE running by **double-clicking one file** —
> no terminal commands, no Docker, no Node install, no Apple Developer fee.
> Builds on Phase 1 (desktop mode: single process, embedded Postgres).

## User decisions (confirmed)

1. **Both** distribution shapes: a bootstrap launcher in the repo AND prebuilt
   offline bundles published to GitHub Releases.
2. Platforms: **macOS (Apple Silicon), Windows (x64), Linux (x64)**.
   Intel Mac explicitly out of scope.
3. First-run UX: **a terminal window showing progress** (user types nothing).
4. Delivery: **public GitHub repo** (+ free GitHub Actions for bundles).
5. **Zero budget** — no code signing, no notarization.

## The signing reality (and why we don't need it)

Apple has no free Developer ID tier, so a signed/notarized `.app` is
impossible at $0. Two findings make that acceptable:

- **`git clone` sets no quarantine attribute.** A committed `.command` with
  the executable bit double-clicks and runs with *no* Gatekeeper prompt. Git
  preserves mode 755, so this works for every cloner.
- **A "Download ZIP" copy is quarantined** → one-time *right-click → Open*
  (2 extra clicks, once). Documented in the README with a screenshot-free,
  plain-language note.
- An **unsigned Tauri `.app` would be worse** ("damaged and can't be opened",
  requiring an `xattr` terminal command). So a launcher script is strictly
  better than a fake-native app at this budget. **Tauri is therefore dropped**
  from Phase 2 — revisit only if a signing budget appears.

Windows: `.bat`/`.cmd` files do not trigger the SmartScreen *executable*
warning that unsigned `.exe`s do; worst case is an "unblock" checkbox on the
zip's properties. Documented.

## 1. Bootstrap launchers (repo path)

Three committed entrypoints at the repo root, all thin wrappers over one
shared script so the logic lives in exactly one place per shell family:

| File | Platform | Notes |
|---|---|---|
| `Start TPCE.command` | macOS | mode 755 (committed executable); double-click opens Terminal |
| `Start TPCE.bat` | Windows | double-click opens a console window |
| `start-tpce.sh` | Linux | mode 755; double-click (or `./start-tpce.sh`) |

`.command` and `.sh` both delegate to `scripts/launcher/bootstrap.sh`;
`.bat` delegates to `scripts/launcher/bootstrap.ps1` (PowerShell, present on
every supported Windows).

**Bootstrap steps (identical logic, both scripts):**

1. `cd` to the repo root (script location), so double-clicking from anywhere
   works.
2. **Resolve Node**: use `.runtime/node/bin/node` if present; else a system
   `node` **≥ 20**; else download the pinned Node LTS tarball/zip for this
   platform+arch from `nodejs.org`, **verify its SHA-256 against the
   published `SHASUMS256.txt`**, and extract to `.runtime/node/`. Refuse to
   proceed on checksum mismatch (we are telling strangers to execute a
   downloaded binary — this check is mandatory, not optional).
3. **Install deps** only when needed: skip if `node_modules/` exists AND the
   stored hash in `.runtime/.deps-hash` equals the current
   `package-lock.json` hash; otherwise `npm ci` and rewrite the hash.
4. **Build** only when needed: skip if `dist-web/index.html` and
   `dist/src/desktop/main.js` both exist and are newer than the newest file
   in `src/`; otherwise `npm run build`.
5. **Launch** the compiled entrypoint: `node dist/src/desktop/main.js`
   (NOT `tsx`, which is a devDependency and absent from prod bundles).
6. **Open the browser** once the app answers: poll `/api/health` (max ~60s)
   then `open` / `start` / `xdg-open` the URL. Print the URL regardless so a
   failed auto-open is still usable.
7. Keep the window open on failure with a plain-language error and a "press
   any key / Enter to close" pause, so a double-clicked window never vanishes
   before the user can read what went wrong.

**Progress output** is plain, numbered, non-technical:
`[1/4] Setting up Node.js (one-time, ~50 MB)…`, `[2/4] Installing TPCE
(one-time, a few minutes)…`, `[3/4] Preparing the app…`, `[4/4] Starting…`.

**Idempotency is the whole point**: second launch skips 1–3 entirely and
reaches step 5 in seconds.

## 2. Prebuilt bundles (GitHub Releases path)

`.github/workflows/release.yml`, triggered on a `v*` tag (and manually via
`workflow_dispatch`), matrix over `macos-14` (arm64), `windows-latest`,
`ubuntu-latest`:

1. `npm ci` (full, dev deps needed to build) → `npm run build`.
2. Prune to runtime: delete `node_modules`, then `npm ci --omit=dev`
   (optional deps — including the platform's `embedded-postgres` binaries —
   are kept by default).
3. Download + checksum-verify the pinned portable Node for that platform into
   `.runtime/node/`.
4. Assemble `tpce-<version>-<platform>/` containing: `dist/`, `dist-web/`,
   `node_modules/`, `.runtime/node/`, `package.json`, `.env.example`,
   `README`-derived `HOW-TO-START.txt`, `src/db/migrations/` (migrations are
   read at runtime from `.sql` files), and the platform's launcher.
5. Zip and attach to the GitHub Release.

Bundle launchers are the SAME scripts — steps 1–4 no-op because Node, deps
and build output are already present, so the bundle boots straight to step 5.
This keeps one code path instead of two.

**Expected size** ~300–400 MB unzipped (144 MB embedded-postgres binaries,
~47 MB Remotion, ~50 MB Node). Documented honestly on the Release page.

## 3. Supporting changes in the app

- `package.json`: add `"start:desktop": "node dist/src/desktop/main.js"` (the
  compiled entry the launchers use). Keep `desktop` (tsx) for development.
- `.gitignore`: add `.runtime/`.
- Verify the compiled desktop entry resolves `dist-web` and the migrations
  dir correctly (Phase 1 already made both layout-aware — this is a
  verification step, not new code).
- `README.md`: replace the developer-first quickstart order with a
  **"Just want to use it?"** section first (download/clone → double-click →
  the one-time macOS right-click note), keeping Docker/dev instructions
  below for contributors.

## 4. Explicit non-goals

- Code signing, notarization, auto-update, tray icon, native window
  (all need the signing budget or Tauri; revisit later).
- Intel Mac, ARM Linux, 32-bit anything.
- Bundling a browser — TPCE opens the user's default browser.
- Making the terminal window pretty; it is a progress log, not a UI.

## 5. Testing

- **Pure/unit (vitest):** the launcher's decision logic is shell, not TS, so
  the testable surface is the Node-version comparison and the deps-hash
  computation — extract both into `scripts/launcher/lib.mjs` with unit tests
  (`isNodeVersionOk`, `depsHash`) so the fragile parts aren't shell-only.
- **macOS E2E (this machine, real):** in a pristine clone with `.runtime/`
  and `node_modules/` absent, double-click-equivalent (`open "Start
  TPCE.command"` / direct execution) must reach a served UI with no manual
  step; second run must be fast; a corrupted `.deps-hash` must trigger
  reinstall.
- **Windows/Linux:** logic-reviewed and dry-run where possible, but **cannot
  be truly verified on this machine** — this must be stated plainly in the
  README and the Release notes rather than implied to be tested. The CI
  matrix build is the real Windows/Linux signal (it exercises install +
  build + bundle assembly on those runners).
