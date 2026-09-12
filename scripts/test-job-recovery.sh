#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose)
psql_cmd=("${compose[@]}" exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-sara}" -d "${POSTGRES_DB:-sara_knowledge}")
retry_id=''
retry_key=''
terminal_id=''
noisy_import_id=''
worker_was_running='false'

cleanup() {
  if [[ -n "$noisy_import_id" ]]; then
    "${psql_cmd[@]}" -c "DELETE FROM dataset.import_jobs WHERE id = '$noisy_import_id';" >/dev/null || true
  fi
  if [[ -n "$retry_id" && -n "$terminal_id" ]]; then
    "${psql_cmd[@]}" -c "DELETE FROM dataset.export_jobs WHERE id IN ('$retry_id', '$terminal_id');" >/dev/null || true
  fi
  if [[ -n "$retry_key" ]]; then
    "${compose[@]}" exec -T minio mc rm "local/${MINIO_BUCKET:-sara-assets}/${retry_key}.claim-2" >/dev/null 2>&1 || true
  fi
  if [[ "$worker_was_running" == 'true' ]]; then
    "${compose[@]}" start worker >/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -n "$("${compose[@]}" ps --status running -q worker)" ]]; then
  worker_was_running='true'
  "${compose[@]}" stop worker >/dev/null
fi

read -r retry_id retry_key < <("${psql_cmd[@]}" -At -F ' ' -c "
  WITH actor AS (
    SELECT id FROM auth.users ORDER BY created_at LIMIT 1
  ), inserted AS (
    INSERT INTO dataset.export_jobs (
      format, mode, status, idempotency_key, filters, object_key, created_by,
      worker_id, claim_generation, attempt_count, max_attempts,
      started_at, heartbeat_at, lease_expires_at
    )
    SELECT
      'json', 'async', 'processing', 'recovery-' || gen_random_uuid(), '{}'::jsonb,
      'integration/job-recovery/' || gen_random_uuid() || '.json', id,
      'dead-worker', 1, 1, 3, now() - interval '2 minutes',
      now() - interval '2 minutes', now() - interval '1 minute'
    FROM actor
    RETURNING id, object_key
  )
  SELECT id, object_key FROM inserted;
")

terminal_id=$("${psql_cmd[@]}" -At -c "
  WITH actor AS (
    SELECT id FROM auth.users ORDER BY created_at LIMIT 1
  )
  INSERT INTO dataset.export_jobs (
    format, mode, status, idempotency_key, filters, object_key, created_by,
    worker_id, claim_generation, attempt_count, max_attempts,
    started_at, heartbeat_at, lease_expires_at
  )
  SELECT
    'json', 'async', 'processing', 'exhausted-' || gen_random_uuid(), '{}'::jsonb,
    'integration/job-recovery/exhausted-' || gen_random_uuid() || '.json', id,
    'dead-worker', 3, 3, 3, now() - interval '2 minutes',
    now() - interval '2 minutes', now() - interval '1 minute'
  FROM actor
  RETURNING id;
")

noisy_import_id=$("${psql_cmd[@]}" -At -c "
  WITH actor AS (
    SELECT id FROM auth.users ORDER BY created_at LIMIT 1
  )
  INSERT INTO dataset.import_jobs (
    format, mode, status, idempotency_key, content_hash, byte_size,
    object_key, options, created_by, max_attempts
  )
  SELECT
    'json', 'async', 'queued', 'missing-object-' || gen_random_uuid(),
    'sha256:missing', 1, 'integration/job-recovery/missing-' || gen_random_uuid() || '.json',
    '{}'::jsonb, id, 3
  FROM actor
  RETURNING id;
")

worker_output=$("${compose[@]}" run --rm --no-deps \
  -e REDIS_URL=redis://127.0.0.1:1 \
  -e WORKER_RUN_ONCE=true \
  -e JOB_RETRY_DELAY_SECONDS=0 \
  -e JOB_REDIS_TIMEOUT_MS=100 \
  worker 2>&1)
printf '%s\n' "$worker_output"

if [[ "$worker_output" != *"Redis notification unavailable; continuing PostgreSQL polling"* ]]; then
  echo "Worker did not report the Redis-to-PostgreSQL fallback." >&2
  exit 1
fi

"${psql_cmd[@]}" -c "
  DO \$\$
  DECLARE
    recovered dataset.export_jobs%ROWTYPE;
    exhausted dataset.export_jobs%ROWTYPE;
    noisy_import dataset.import_jobs%ROWTYPE;
    stale_updates integer;
  BEGIN
    SELECT * INTO recovered FROM dataset.export_jobs WHERE id = '$retry_id';
    IF recovered.status <> 'completed'
      OR recovered.claim_generation <> 2
      OR recovered.attempt_count <> 2
      OR recovered.worker_id IS NOT NULL
      OR recovered.lease_expires_at IS NOT NULL
      OR recovered.object_key <> '$retry_key.claim-2' THEN
      RAISE EXCEPTION 'unexpected recovered job state: %', row_to_json(recovered);
    END IF;

    SELECT * INTO exhausted FROM dataset.export_jobs WHERE id = '$terminal_id';
    IF exhausted.status <> 'failed'
      OR exhausted.claim_generation <> 3
      OR exhausted.attempt_count <> 3
      OR exhausted.worker_id IS NOT NULL
      OR exhausted.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'unexpected exhausted job state: %', row_to_json(exhausted);
    END IF;

    SELECT * INTO noisy_import FROM dataset.import_jobs WHERE id = '$noisy_import_id';
    IF noisy_import.status <> 'failed'
      OR noisy_import.claim_generation <> 3
      OR noisy_import.attempt_count <> 3 THEN
      RAISE EXCEPTION 'unexpected retrying import state: %', row_to_json(noisy_import);
    END IF;

    UPDATE dataset.export_jobs
    SET status = 'failed'
    WHERE id = '$retry_id'
      AND status = 'processing'
      AND worker_id = 'dead-worker'
      AND claim_generation = 1;
    GET DIAGNOSTICS stale_updates = ROW_COUNT;
    IF stale_updates <> 0 THEN
      RAISE EXCEPTION 'a stale claim changed % row(s)', stale_updates;
    END IF;
  END
  \$\$;
"

echo "Job recovery integration passed: expired lease reclaimed, retries bounded, stale claim fenced, queue types fair, Redis fallback active."
