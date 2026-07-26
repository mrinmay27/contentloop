#!/usr/bin/env sh
set -e
node dist/scripts/migrate.js
case "${CONTENTLOOP_ROLE:-${TPCE_ROLE:-api}}" in
  api)    exec node dist/src/api/server.js ;;
  worker) exec node dist/src/worker/index.js ;;
  *) echo "CONTENTLOOP_ROLE must be api or worker" >&2; exit 1 ;;
esac
