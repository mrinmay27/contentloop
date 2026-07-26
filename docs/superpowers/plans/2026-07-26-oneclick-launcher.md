# Sprint D2 Phase 2 — One-Click Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-technical user double-clicks one file and ContentLoop opens in their browser — no terminal commands, no Docker, no Node install, no Apple developer fee.

**Architecture:** Three committed double-click entrypoints (`Start ContentLoop.command` / `.bat` / `.sh`) delegate to one bootstrap script per shell family. The bootstrap resolves Node (portable download, SHA-256 verified), installs deps and builds **only when needed** (lockfile-hash + mtime checks), then runs the compiled desktop entrypoint from Phase 1 and opens the browser once `/api/health` answers. The same scripts drive GitHub-Actions-built offline bundles, where steps 1–3 simply no-op. Spec: `docs/superpowers/specs/2026-07-24-oneclick-launcher-design.md`.

**Tech Stack:** POSIX sh + PowerShell 5.1 (no extra runtimes), Node **v24.18.0 LTS** (pinned; all three platform URLs + `SHASUMS256.txt` verified live at nodejs.org), GitHub Actions, vitest.

**Conventions:** gates = `npx vitest run` (159 currently) + `npx tsc -p tsconfig.json --noEmit` + `npm run build`. `dist-web` is NOT git-tracked — never `git checkout -- dist-web`. READ every file before modifying. Commit per task.

**CAUTION — the user's environment is live.** Their docker dev stack (postgres/redis) may be running and they may have `npm run dev` on :4000/:5173. Kill nothing you did not start; never bind :4000. Desktop/launcher testing MUST use a temp data dir (`CONTENTLOOP_DATA_DIR`) and a spare port.

**Platform honesty:** macOS is fully testable on this machine. **Windows and Linux launchers cannot be truly verified here** — logic-review them, and say so plainly in the README and your report rather than implying they were tested. CI is the real Windows/Linux signal.

---

### Task 1: Launcher helper lib (TDD)

The fragile decisions (is this Node new enough? have deps changed?) are extracted
into a tiny Node module so they're unit-tested instead of living only in shell.

**Files:**
- Create: `scripts/launcher/lib.mjs`
- Test: `tests/launcherLib.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/launcherLib.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isNodeVersionOk, depsHash, MIN_NODE_MAJOR } from "../scripts/launcher/lib.mjs";

describe("isNodeVersionOk", () => {
  it("accepts the minimum major and newer", () => {
    expect(isNodeVersionOk(`v${MIN_NODE_MAJOR}.0.0`)).toBe(true);
    expect(isNodeVersionOk(`v${MIN_NODE_MAJOR + 2}.5.1`)).toBe(true);
  });
  it("accepts a system Node newer than the minimum but older than the pinned download", () => {
    // We DOWNLOAD v24, but an existing v20/v22 is perfectly fine to reuse —
    // forcing a 50 MB download on those users would be gratuitous.
    expect(isNodeVersionOk("v22.11.0")).toBe(true);
  });
  it("rejects older majors", () => {
    expect(isNodeVersionOk(`v${MIN_NODE_MAJOR - 1}.9.9`)).toBe(false);
    expect(isNodeVersionOk("v18.20.4")).toBe(false);
  });
  it("tolerates a missing leading v", () => {
    expect(isNodeVersionOk(`${MIN_NODE_MAJOR}.1.0`)).toBe(true);
  });
  it("rejects garbage rather than assuming ok", () => {
    expect(isNodeVersionOk("")).toBe(false);
    expect(isNodeVersionOk("not-a-version")).toBe(false);
    expect(isNodeVersionOk(undefined as unknown as string)).toBe(false);
  });
});

describe("depsHash", () => {
  it("is stable for identical content", () => {
    expect(depsHash("abc")).toBe(depsHash("abc"));
  });
  it("changes when the lockfile changes", () => {
    expect(depsHash("abc")).not.toBe(depsHash("abd"));
  });
  it("returns a short hex digest", () => {
    expect(depsHash("abc")).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/launcherLib.test.ts`
Expected: FAIL — cannot resolve `../scripts/launcher/lib.mjs`.

- [ ] **Step 3: Implement**

Create `scripts/launcher/lib.mjs`:

```js
// Helpers the launcher scripts shell out to. Kept in Node (not shell) so the
// fragile bits are unit-tested and behave identically on every platform.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Minimum Node major ContentLoop runs on. Deliberately LOWER than the pinned
 *  portable download (v24) — an already-installed v20 or v22 is reused as-is,
 *  and only machines with nothing suitable pay for the download. */
export const MIN_NODE_MAJOR = 20;

/** True when `version` ("v24.18.0" or "24.18.0") is new enough to run ContentLoop. */
export function isNodeVersionOk(version) {
  if (typeof version !== "string") return false;
  const m = version.trim().match(/^v?(\d+)\./);
  if (!m) return false;
  return Number(m[1]) >= MIN_NODE_MAJOR;
}

/** Short digest of the lockfile contents — lets the launcher skip `npm ci`
 *  when nothing changed since the last successful install. */
export function depsHash(lockContents) {
  return createHash("sha256").update(lockContents).digest("hex").slice(0, 16);
}

/** CLI entry: `node lib.mjs deps-hash <path>` prints the hash of a lockfile,
 *  `node lib.mjs node-ok <version>` exits 0/1. Shell calls these. */
if (process.argv[1] && process.argv[1].endsWith("lib.mjs")) {
  const [, , cmd, arg] = process.argv;
  if (cmd === "deps-hash") {
    process.stdout.write(depsHash(readFileSync(arg, "utf8")));
  } else if (cmd === "node-ok") {
    process.exit(isNodeVersionOk(arg) ? 0 : 1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/launcherLib.test.ts` → 7 passed.
Run: `npx tsc -p tsconfig.json --noEmit` → clean. (If tsc complains about
importing `.mjs` from a test, add `"allowJs": true` to tsconfig `compilerOptions`
— READ tsconfig.json first and report what you changed.)

- [ ] **Step 5: Commit**

```bash
git add scripts/launcher/lib.mjs tests/launcherLib.test.ts
git commit -m "feat(launcher): version/lockfile helpers with unit tests"
```

---

### Task 2: POSIX bootstrap (macOS + Linux)

**Files:**
- Create: `scripts/launcher/bootstrap.sh`
- Create: `Start ContentLoop.command` (mode 755)
- Create: `start-contentloop.sh` (mode 755)
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 0: Add the compiled-entry npm script**

`package.json` has `"desktop": "tsx src/desktop/main.ts"`, but `tsx` is a
devDependency and is absent from production bundles. Add a sibling that runs the
compiled output (keep the `tsx` one for development):

```json
"start:desktop": "node dist/src/desktop/main.js",
```

Verify: `python3 -c "import json;print(json.load(open('package.json'))['scripts']['start:desktop'])"`
Expected: `node dist/src/desktop/main.js`

- [ ] **Step 1: Write the bootstrap**

Create `scripts/launcher/bootstrap.sh`:

```sh
#!/bin/sh
# ContentLoop one-click bootstrap (macOS + Linux).
#
# Design notes:
#  - Everything is idempotent: Node download, `npm ci` and the build each check
#    whether they are actually needed, so the second launch is seconds, not minutes.
#  - The pinned Node tarball is SHA-256 verified. We are asking strangers to
#    execute a downloaded binary; skipping that check would be indefensible.
#  - Runs the COMPILED entrypoint (dist/…), never tsx — tsx is a devDependency
#    and is absent from production bundles.
set -eu

NODE_VERSION="v24.18.0"
APP_PORT="${PORT:-4173}"

# Repo root = two levels up from this script (scripts/launcher/bootstrap.sh).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

RUNTIME="$ROOT/.runtime"
NODE_DIR="$RUNTIME/node"
mkdir -p "$RUNTIME"

say() { printf '%s\n' "$*"; }
fail() {
  say ""
  say "──────────────────────────────────────────────"
  say "ContentLoop could not start."
  say "$*"
  say "──────────────────────────────────────────────"
  say ""
  printf 'Press Enter to close this window. '
  read -r _dummy || true
  exit 1
}

case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux"  ;;
  *) fail "Unsupported system: $(uname -s). ContentLoop supports macOS, Windows and Linux." ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64"   ;;
  *) fail "Unsupported processor: $(uname -m)." ;;
esac

# ── 1/4 Node ────────────────────────────────────────────────────────────────
NODE_BIN=""
if [ -x "$NODE_DIR/bin/node" ]; then
  NODE_BIN="$NODE_DIR/bin/node"
elif command -v node >/dev/null 2>&1 \
     && node "$ROOT/scripts/launcher/lib.mjs" node-ok "$(node -v)" >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
fi

if [ -z "$NODE_BIN" ]; then
  say "[1/4] Setting up Node.js (one-time, about 50 MB)…"
  TARBALL="node-$NODE_VERSION-$OS-$ARCH.tar.gz"
  URL="https://nodejs.org/dist/$NODE_VERSION/$TARBALL"
  TMP="$RUNTIME/tmp"; rm -rf "$TMP"; mkdir -p "$TMP"

  curl -fsSL "$URL" -o "$TMP/$TARBALL" || fail "Could not download Node.js. Check your internet connection and try again."
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" \
    || fail "Could not download the Node.js checksum file. Check your internet connection."

  EXPECTED="$(grep " $TARBALL\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
  if command -v shasum >/dev/null 2>&1; then ACTUAL="$(shasum -a 256 "$TMP/$TARBALL" | awk '{print $1}')"
  else ACTUAL="$(sha256sum "$TMP/$TARBALL" | awk '{print $1}')"; fi
  [ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] \
    || fail "The downloaded Node.js file failed its security check. Nothing was installed. Please try again."

  mkdir -p "$NODE_DIR"
  tar -xzf "$TMP/$TARBALL" -C "$NODE_DIR" --strip-components=1 || fail "Could not unpack Node.js."
  rm -rf "$TMP"
  NODE_BIN="$NODE_DIR/bin/node"
else
  say "[1/4] Node.js ready."
fi

NODE_HOME="$(dirname "$(dirname "$NODE_BIN")")"
PATH="$NODE_HOME/bin:$PATH"; export PATH
NPM_CLI="$NODE_HOME/lib/node_modules/npm/bin/npm-cli.js"
[ -f "$NPM_CLI" ] || NPM_CLI=""   # system Node: fall back to the npm on PATH

run_npm() {
  if [ -n "$NPM_CLI" ]; then "$NODE_BIN" "$NPM_CLI" "$@"
  else npm "$@"; fi
}

# ── 2/4 Dependencies (skip when the lockfile hasn't changed) ────────────────
WANT_HASH="$("$NODE_BIN" "$ROOT/scripts/launcher/lib.mjs" deps-hash "$ROOT/package-lock.json")"
HAVE_HASH="$(cat "$RUNTIME/.deps-hash" 2>/dev/null || echo none)"
if [ ! -d "$ROOT/node_modules" ] || [ "$WANT_HASH" != "$HAVE_HASH" ]; then
  say "[2/4] Installing ContentLoop (one-time, a few minutes)…"
  run_npm ci --no-audit --no-fund || fail "Installing dependencies failed. Check your internet connection and try again."
  printf '%s' "$WANT_HASH" > "$RUNTIME/.deps-hash"
else
  say "[2/4] Dependencies ready."
fi

# ── 3/4 Build (skip when outputs are newer than sources) ────────────────────
NEEDS_BUILD=0
[ -f "$ROOT/dist-web/index.html" ] || NEEDS_BUILD=1
[ -f "$ROOT/dist/src/desktop/main.js" ] || NEEDS_BUILD=1
# Prebuilt bundles ship dist/ but NOT the source tree (only src/db/migrations,
# whose copy mtimes are newer than the build). Without this guard those mtimes
# would trigger a rebuild that then fails, because dev deps were pruned.
if [ "$NEEDS_BUILD" -eq 0 ] && [ -f "$ROOT/src/api/server.ts" ]; then
  NEWER="$(find "$ROOT/src" "$ROOT/index.html" -newer "$ROOT/dist/src/desktop/main.js" -print -quit 2>/dev/null || true)"
  [ -z "$NEWER" ] || NEEDS_BUILD=1
fi
if [ "$NEEDS_BUILD" -eq 1 ]; then
  say "[3/4] Preparing the app…"
  run_npm run build || fail "Building the app failed. Please report this with the messages above."
else
  say "[3/4] App ready."
fi

# ── 4/4 Launch + open the browser ───────────────────────────────────────────
say "[4/4] Starting ContentLoop…"
PORT="$APP_PORT" "$NODE_BIN" "$ROOT/dist/src/desktop/main.js" &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null || true' INT TERM

URL="http://localhost:$APP_PORT"
i=0
while [ $i -lt 120 ]; do
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then break; fi
  kill -0 "$APP_PID" 2>/dev/null || fail "ContentLoop stopped while starting up. See the messages above."
  sleep 1; i=$((i + 1))
done

say ""
say "ContentLoop is running at $URL"
say "Keep this window open while you use it. Close it (or press Ctrl-C) to stop."
say ""
if [ "$OS" = "darwin" ]; then open "$URL" 2>/dev/null || true
else xdg-open "$URL" >/dev/null 2>&1 || true; fi

wait "$APP_PID"
```

- [ ] **Step 2: Create the two double-click entrypoints**

`Start ContentLoop.command`:

```sh
#!/bin/sh
# Double-click me. (macOS opens this in Terminal.)
exec "$(dirname "$0")/scripts/launcher/bootstrap.sh"
```

`start-contentloop.sh`:

```sh
#!/bin/sh
exec "$(dirname "$0")/scripts/launcher/bootstrap.sh"
```

Make all three executable AND record the bit in git (this is what makes
double-click work for anyone who clones):

```bash
chmod +x "Start ContentLoop.command" start-contentloop.sh scripts/launcher/bootstrap.sh
git update-index --chmod=+x "Start ContentLoop.command" start-contentloop.sh scripts/launcher/bootstrap.sh 2>/dev/null || true
```

- [ ] **Step 3: Ignore the runtime dir**

Append to `.gitignore` (READ it first; keep its comment style):

```
# Launcher-managed portable runtime (downloaded Node, install markers)
.runtime/
```

- [ ] **Step 4: Verify the exec bits are staged correctly**

Run: `git ls-files -s "Start ContentLoop.command" start-contentloop.sh scripts/launcher/bootstrap.sh`
Expected: every line starts with `100755`. If any shows `100644`, redo the
`git update-index --chmod=+x` for that file — a non-executable `.command` will
NOT double-click.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(launcher): POSIX bootstrap + double-click entrypoints for macOS and Linux"
```

---

### Task 3: Windows bootstrap

**Files:**
- Create: `scripts/launcher/bootstrap.ps1`
- Create: `Start ContentLoop.bat`

- [ ] **Step 1: Write the PowerShell bootstrap**

Create `scripts/launcher/bootstrap.ps1` (mirrors bootstrap.sh step for step):

```powershell
# ContentLoop one-click bootstrap (Windows).
# Mirrors scripts/launcher/bootstrap.sh — keep the two in sync.
$ErrorActionPreference = 'Stop'

$NodeVersion = 'v24.18.0'
$AppPort = if ($env:PORT) { $env:PORT } else { '4173' }

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
$Runtime = Join-Path $Root '.runtime'
$NodeDir = Join-Path $Runtime 'node'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

function Fail($msg) {
  Write-Host ''
  Write-Host '──────────────────────────────────────────────'
  Write-Host 'ContentLoop could not start.'
  Write-Host $msg
  Write-Host '──────────────────────────────────────────────'
  Write-Host ''
  Read-Host 'Press Enter to close this window'
  exit 1
}

# ── 1/4 Node ────────────────────────────────────────────────────────────────
$NodeExe = Join-Path $NodeDir 'node.exe'
$NodeBin = $null
if (Test-Path $NodeExe) {
  $NodeBin = $NodeExe
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
  $v = (& node -v)
  & node (Join-Path $Root 'scripts\launcher\lib.mjs') node-ok $v
  if ($LASTEXITCODE -eq 0) { $NodeBin = (Get-Command node).Source }
}

if (-not $NodeBin) {
  Write-Host '[1/4] Setting up Node.js (one-time, about 50 MB)...'
  $zip  = "node-$NodeVersion-win-x64.zip"
  $tmp  = Join-Path $Runtime 'tmp'
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$zip" -OutFile (Join-Path $tmp $zip) -UseBasicParsing
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -OutFile (Join-Path $tmp 'SHASUMS256.txt') -UseBasicParsing
  } catch { Fail 'Could not download Node.js. Check your internet connection and try again.' }

  $expected = (Select-String -Path (Join-Path $tmp 'SHASUMS256.txt') -Pattern ([regex]::Escape($zip)) |
               Select-Object -First 1).Line.Split(' ')[0]
  $actual = (Get-FileHash (Join-Path $tmp $zip) -Algorithm SHA256).Hash.ToLower()
  if (-not $expected -or $expected.ToLower() -ne $actual) {
    Fail 'The downloaded Node.js file failed its security check. Nothing was installed. Please try again.'
  }

  Expand-Archive -Path (Join-Path $tmp $zip) -DestinationPath $tmp -Force
  $inner = Join-Path $tmp "node-$NodeVersion-win-x64"
  New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
  Copy-Item "$inner\*" $NodeDir -Recurse -Force
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  $NodeBin = $NodeExe
} else {
  Write-Host '[1/4] Node.js ready.'
}

$NodeHome = Split-Path $NodeBin -Parent
$env:PATH = "$NodeHome;$env:PATH"
$NpmCli = Join-Path $NodeHome 'node_modules\npm\bin\npm-cli.js'
function Run-Npm { param([string[]]$NpmArgs)
  if (Test-Path $NpmCli) { & $NodeBin $NpmCli @NpmArgs } else { & npm @NpmArgs }
  if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') failed" }
}

# ── 2/4 Dependencies ────────────────────────────────────────────────────────
$wantHash = & $NodeBin (Join-Path $Root 'scripts\launcher\lib.mjs') deps-hash (Join-Path $Root 'package-lock.json')
$hashFile = Join-Path $Runtime '.deps-hash'
$haveHash = if (Test-Path $hashFile) { Get-Content $hashFile -Raw } else { 'none' }
if (-not (Test-Path (Join-Path $Root 'node_modules')) -or $wantHash -ne $haveHash) {
  Write-Host '[2/4] Installing ContentLoop (one-time, a few minutes)...'
  try { Run-Npm @('ci','--no-audit','--no-fund') }
  catch { Fail 'Installing dependencies failed. Check your internet connection and try again.' }
  Set-Content -Path $hashFile -Value $wantHash -NoNewline
} else {
  Write-Host '[2/4] Dependencies ready.'
}

# ── 3/4 Build ───────────────────────────────────────────────────────────────
$mainJs = Join-Path $Root 'dist\src\desktop\main.js'
$needsBuild = -not (Test-Path (Join-Path $Root 'dist-web\index.html')) -or -not (Test-Path $mainJs)
# See bootstrap.sh: prebuilt bundles have no source tree, so skip the mtime check.
if (-not $needsBuild -and (Test-Path (Join-Path $Root 'src\api\server.ts'))) {
  $builtAt = (Get-Item $mainJs).LastWriteTimeUtc
  $newer = Get-ChildItem (Join-Path $Root 'src') -Recurse -File -ErrorAction SilentlyContinue |
           Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1
  if ($newer) { $needsBuild = $true }
}
if ($needsBuild) {
  Write-Host '[3/4] Preparing the app...'
  try { Run-Npm @('run','build') }
  catch { Fail 'Building the app failed. Please report this with the messages above.' }
} else {
  Write-Host '[3/4] App ready.'
}

# ── 4/4 Launch ──────────────────────────────────────────────────────────────
Write-Host '[4/4] Starting ContentLoop...'
$env:PORT = $AppPort
$app = Start-Process -FilePath $NodeBin -ArgumentList $mainJs -NoNewWindow -PassThru
$url = "http://localhost:$AppPort"
for ($i = 0; $i -lt 120; $i++) {
  try { Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { }
  if ($app.HasExited) { Fail 'ContentLoop stopped while starting up. See the messages above.' }
  Start-Sleep -Seconds 1
}
Write-Host ''
Write-Host "ContentLoop is running at $url"
Write-Host 'Keep this window open while you use it. Close it (or press Ctrl-C) to stop.'
Write-Host ''
Start-Process $url
Wait-Process -Id $app.Id
```

- [ ] **Step 2: Create the double-click entrypoint**

`Start ContentLoop.bat`:

```bat
@echo off
REM Double-click me.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher\bootstrap.ps1"
if errorlevel 1 pause
```

`-ExecutionPolicy Bypass` is scoped to this one invocation — it does not change
any machine setting, and is the standard way to ship a runnable `.ps1`.

- [ ] **Step 3: Verify what can be verified on macOS**

You cannot run PowerShell here. Do these checks and report results honestly:
- `grep -n "NodeVersion\|deps-hash\|dist\\\\src\\\\desktop\\\\main.js" scripts/launcher/bootstrap.ps1`
  — confirm the pinned version matches bootstrap.sh and paths use Windows separators.
- Confirm every user-facing message in the `.ps1` matches its `.sh` counterpart
  (they must not drift).
- Confirm `Start ContentLoop.bat` references `scripts\launcher\bootstrap.ps1`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(launcher): Windows bootstrap (PowerShell) + double-click .bat"
```

---

### Task 4: Prebuilt offline bundles (GitHub Actions)

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release bundles

on:
  push:
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  bundle:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14
            platform: macos-arm64
            node_asset: node-v24.18.0-darwin-arm64.tar.gz
          - os: windows-latest
            platform: windows-x64
            node_asset: node-v24.18.0-win-x64.zip
          - os: ubuntu-latest
            platform: linux-x64
            node_asset: node-v24.18.0-linux-x64.tar.xz
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24

      # Full install (dev deps are needed to build), then build.
      - run: npm ci --no-audit --no-fund
      - run: npm run build

      # Re-install runtime-only. Optional deps (the platform's
      # embedded-postgres binaries) are kept by default — desktop mode needs them.
      - name: Prune to runtime dependencies
        shell: bash
        run: |
          rm -rf node_modules
          npm ci --omit=dev --no-audit --no-fund

      - name: Fetch + verify portable Node
        shell: bash
        run: |
          set -eu
          mkdir -p .runtime/node tmp
          curl -fsSL "https://nodejs.org/dist/v24.18.0/${{ matrix.node_asset }}" -o "tmp/${{ matrix.node_asset }}"
          curl -fsSL "https://nodejs.org/dist/v24.18.0/SHASUMS256.txt" -o tmp/SHASUMS256.txt
          expected=$(grep " ${{ matrix.node_asset }}$" tmp/SHASUMS256.txt | awk '{print $1}')
          if command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "tmp/${{ matrix.node_asset }}" | awk '{print $1}')
          else actual=$(sha256sum "tmp/${{ matrix.node_asset }}" | awk '{print $1}'); fi
          [ "$expected" = "$actual" ] || { echo "Node checksum mismatch"; exit 1; }
          case "${{ matrix.node_asset }}" in
            *.zip)    unzip -q "tmp/${{ matrix.node_asset }}" -d tmp/x && mv tmp/x/*/* .runtime/node/ ;;
            *.tar.gz) tar -xzf "tmp/${{ matrix.node_asset }}" -C .runtime/node --strip-components=1 ;;
            *.tar.xz) tar -xJf "tmp/${{ matrix.node_asset }}" -C .runtime/node --strip-components=1 ;;
          esac
          rm -rf tmp

      - name: Assemble bundle
        shell: bash
        run: |
          set -eu
          NAME="contentloop-${{ github.ref_name }}-${{ matrix.platform }}"
          mkdir -p "out/$NAME"
          cp -R dist dist-web node_modules .runtime package.json package-lock.json .env.example LICENSE README.md "out/$NAME/"
          mkdir -p "out/$NAME/src/db"
          cp -R src/db/migrations "out/$NAME/src/db/migrations"   # read at runtime
          mkdir -p "out/$NAME/scripts/launcher"
          cp scripts/launcher/lib.mjs "out/$NAME/scripts/launcher/"
          # Seed the deps marker. Without it the launcher sees "no recorded hash",
          # decides deps are stale and runs `npm ci` — so the offline bundle would
          # demand a network on first launch. This is what makes it truly offline.
          node scripts/launcher/lib.mjs deps-hash package-lock.json > "out/$NAME/.runtime/.deps-hash"
          if [ "${{ matrix.platform }}" = "windows-x64" ]; then
            cp scripts/launcher/bootstrap.ps1 "out/$NAME/scripts/launcher/"
            cp "Start ContentLoop.bat" "out/$NAME/"
          else
            cp scripts/launcher/bootstrap.sh "out/$NAME/scripts/launcher/"
            chmod +x "out/$NAME/scripts/launcher/bootstrap.sh"
            if [ "${{ matrix.platform }}" = "macos-arm64" ]; then
              cp "Start ContentLoop.command" "out/$NAME/"; chmod +x "out/$NAME/Start ContentLoop.command"
            else
              cp start-contentloop.sh "out/$NAME/"; chmod +x "out/$NAME/start-contentloop.sh"
            fi
          fi
          printf '%s\n' \
            'ContentLoop' '' \
            'Double-click the "Start ContentLoop" file in this folder.' \
            'Your browser opens automatically once it is ready.' '' \
            'macOS: if you see "unidentified developer", right-click the file' \
            'and choose Open, then click Open again. Only needed once.' '' \
            'Everything runs on your own computer. Nothing is uploaded.' \
            > "out/$NAME/HOW-TO-START.txt"
          cd out && zip -qr "$NAME.zip" "$NAME"

      - uses: actions/upload-artifact@v4
        with:
          name: contentloop-${{ matrix.platform }}
          path: out/*.zip

      - name: Attach to release
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: out/*.zip
```

- [ ] **Step 2: Validate the workflow syntax locally**

Run: `npx --yes js-yaml .github/workflows/release.yml > /dev/null && echo "YAML OK"`
Expected: `YAML OK`. (If `js-yaml` is unavailable offline, use
`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML OK')"`
— report which you used.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build prebuilt offline bundles for macOS/Windows/Linux on tag"
```

---

### Task 5: README for non-technical users

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Restructure**

READ `README.md` first. Keep the logo hero and badges. Immediately after them,
insert a new first section, and demote the existing Docker quickstart to a
"For developers" area further down (do NOT delete it):

````markdown
## Get started (no terminal needed)

**Option A — download and run**

1. Download the file for your computer from the
   [latest release](https://github.com/mrinmay27/contentloop/releases/latest):
   `…macos-arm64.zip`, `…windows-x64.zip` or `…linux-x64.zip`
2. Unzip it.
3. Double-click **Start ContentLoop**.

Your browser opens when it's ready. Everything runs on your own computer.

> **macOS only, first time:** if you see *"cannot be opened because it is from
> an unidentified developer"*, right-click **Start ContentLoop** → **Open** →
> **Open**. You only do this once. (ContentLoop is free and open-source, so it
> isn't signed with a paid Apple certificate — this is macOS's normal warning
> for that, not a sign anything is wrong.)

**Option B — clone the repo** (no security prompt, needs internet on first run)

```bash
git clone https://github.com/mrinmay27/contentloop.git
cd contentloop
```

Then double-click **Start ContentLoop.command** (macOS),
**Start ContentLoop.bat** (Windows) or **start-contentloop.sh** (Linux).
The first launch downloads Node.js and installs ContentLoop (a few minutes);
later launches take seconds.

### What you need

Nothing to install — no Docker, no Node.js, no database. ContentLoop bundles
its own Postgres and runs entirely on your machine.

AI features (writing captions, matching sources to your niche) need a free API
key from Groq or Google AI Studio, which you paste into **Settings** after the
app opens. Without a key everything still runs — discovery, scoring, scheduling
and previews all work, with simpler generated text.
````

Also fix the stale clone line in the developer section: it currently says
`cd theme-page-content-engine` and `<this-repo-url>`; both must become the real
repo (`git clone https://github.com/mrinmay27/contentloop.git`, `cd contentloop`).

- [ ] **Step 2: Add the platform-honesty note**

At the end of the new section add exactly:

```markdown
> **Tested on:** macOS (Apple Silicon). The Windows and Linux launchers are
> built and installed by CI on those platforms, but have not been hand-tested
> — please open an issue if something breaks.
```

- [ ] **Step 3: Verify no stale references remain**

Run: `grep -rn "theme-page-content-engine\|<this-repo-url>" README.md docs/*.md || echo "clean"`
Expected: `clean` (superpowers/ historical docs are exempt — do not edit them).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: lead with the no-terminal install path"
```

---

### Task 6: macOS end-to-end + gates

**Files:** none (verification only)

- [ ] **Step 1: Cold-start from a pristine copy**

Simulate a fresh clone so `.runtime/` and `node_modules/` are absent, and keep
the user's real app data untouched by pointing at a temp data dir:

```bash
WORK=$(mktemp -d)
git clone --depth 1 "file://$PWD" "$WORK/contentloop" >/dev/null 2>&1
cd "$WORK/contentloop"
ls -l "Start ContentLoop.command"        # must show -rwxr-xr-x
CONTENTLOOP_DATA_DIR="$WORK/data" PORT=4719 ./scripts/launcher/bootstrap.sh > "$WORK/launch.log" 2>&1 &
```
Wait (first run installs deps — allow up to ~10 min), then check:
```bash
grep -E "^\[1/4\]|^\[2/4\]|^\[3/4\]|^\[4/4\]|ContentLoop is running" "$WORK/launch.log"
curl -s -o /dev/null -w "ui:%{http_code}\n" http://localhost:4719/
curl -s -o /dev/null -w "health:%{http_code}\n" http://localhost:4719/api/health
```
Expected: all four progress lines, `ui:200`, `health:200`. **Report the actual
log lines** — this is the sprint's headline claim.

- [ ] **Step 2: Second-launch speed (the idempotency proof)**

Kill the app, relaunch the same clone, and time it:
```bash
pkill -f "$WORK/contentloop/dist/src/desktop/main.js" || true
sleep 2
time (CONTENTLOOP_DATA_DIR="$WORK/data" PORT=4719 ./scripts/launcher/bootstrap.sh > "$WORK/launch2.log" 2>&1 &) ; sleep 45
grep -E "Node.js ready|Dependencies ready|App ready|ContentLoop is running" "$WORK/launch2.log"
```
Expected: the three "ready" lines (NOT the install/build lines) and a running
app — proving nothing re-downloads or rebuilds.

- [ ] **Step 3: Corrupted deps marker triggers a reinstall (spec §5)**

The marker is the only thing standing between "fast launch" and "silently
running against stale dependencies", so prove it self-heals:

```bash
pkill -f "$WORK/contentloop/dist/src/desktop/main.js" || true
echo "corrupted" > "$WORK/contentloop/.runtime/.deps-hash"
CONTENTLOOP_DATA_DIR="$WORK/data" PORT=4719 timeout 400 ./scripts/launcher/bootstrap.sh > "$WORK/launch3.log" 2>&1 &
sleep 90
grep -E "Installing ContentLoop|Dependencies ready" "$WORK/launch3.log"
cat "$WORK/contentloop/.runtime/.deps-hash"
```
Expected: the log shows **"Installing ContentLoop"** (not "Dependencies ready"),
and afterwards the marker file holds the real 16-hex-char hash again.

- [ ] **Step 4: Clean up and confirm the user's environment is untouched**

```bash
pkill -f "$WORK/contentloop/dist/src/desktop/main.js" || true
rm -rf "$WORK"
docker compose ps          # user's stack still healthy
ls ~/Library/Application\ Support/ContentLoop 2>/dev/null || echo "(real data dir untouched)"
```

- [ ] **Step 5: Full gates**

```bash
npx vitest run                      # 166 (159 + 7 launcher lib)
npx tsc -p tsconfig.json --noEmit   # clean
npm run build                       # succeeds
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: one-click launcher verified end-to-end on macOS"
```
