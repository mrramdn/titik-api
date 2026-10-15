#!/bin/sh
set -eu

case "${SEED_DEMO:-}" in
  true|false|"") ;;
  *) echo "SEED_DEMO must be true or false." >&2; exit 1 ;;
esac

node dist/migrate.js
exec node dist/server.js
