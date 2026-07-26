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
