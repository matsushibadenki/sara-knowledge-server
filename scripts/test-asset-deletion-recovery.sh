#!/usr/bin/env bash
set -euo pipefail
worker_was_running=false
cleanup() {
  if [[ "$worker_was_running" == true ]]; then docker compose start worker >/dev/null; fi
}
trap cleanup EXIT
if [[ -n "$(docker compose ps --status running -q worker)" ]]; then
  worker_was_running=true
  docker compose stop worker >/dev/null
fi
docker compose run --rm -e RUN_ASSET_RECOVERY=1 -e MINIO_PUBLIC_ENDPOINT=http://minio:9000 api bun test tests/asset-deletion-recovery.integration.test.js tests/asset-reconciliation.integration.test.js
