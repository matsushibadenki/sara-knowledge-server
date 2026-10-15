#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
  if [[ "$arg" != --apply ]]; then echo 'Usage: bash scripts/reconcile-assets.sh [--apply]' >&2; exit 1; fi
done
inventory=$(mktemp)
trap 'rm -f "$inventory"' EXIT
bucket=$(docker compose run --rm -T api bun -e 'process.stdout.write(process.env.MINIO_BUCKET || "sara-assets")')
# Finish listing before applying anything: partial inventory must fail closed.
docker compose exec -T minio sh -c 'mc alias set reconcile http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc ls --recursive --json "reconcile/$1"' sh "$bucket" > "$inventory"
docker compose run --rm -T api bun src/ops/reconcile-assets.js --inventory "$@" < "$inventory"
