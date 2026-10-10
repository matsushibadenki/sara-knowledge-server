export function createAssetDeletionQueue({ sql, deleteObject, workerId, leaseSeconds = 60, retryDelaySeconds = 5, assetId = null }) {
  async function claim() {
    return sql.begin(async (tx) => {
      const [job] = await tx`SELECT * FROM dataset.asset_deletion_jobs WHERE status='queued' AND not_before <= now() AND next_attempt_at <= now() AND attempt_count < max_attempts AND (${assetId}::uuid IS NULL OR asset_id=${assetId}) ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!job) return null;
      const [claimed] = await tx`UPDATE dataset.asset_deletion_jobs SET status='processing', worker_id=${workerId}, heartbeat_at=now(), lease_expires_at=now() + ${leaseSeconds} * interval '1 second', attempt_count=attempt_count+1, claim_generation=claim_generation+1 WHERE id=${job.id} RETURNING *`;
      return claimed;
    });
  }
  async function heartbeat(job) {
    return sql`UPDATE dataset.asset_deletion_jobs SET heartbeat_at=now(), lease_expires_at=now() + ${leaseSeconds} * interval '1 second' WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
  }
  async function process(job) {
    try {
      await sql.begin(async (tx) => {
        // Hold both locks across the irreversible call. A stale claim cannot delete bytes,
        // and the reaper cannot hand an in-flight deletion to a second worker.
        const [asset] = await tx`SELECT * FROM dataset.assets WHERE id=${job.asset_id} FOR UPDATE`;
        const [current] = await tx`SELECT *, not_before <= now() AS retention_elapsed FROM dataset.asset_deletion_jobs WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} FOR UPDATE`;
        if (!current) return;
        if (!asset || asset.bucket_name !== current.bucket_name || !current.retention_elapsed) throw new Error('Asset deletion retention or bucket does not match.');
        if (current.reason === 'staging') {
          if (asset.staging_object_key !== current.object_key || (asset.status !== 'ready' && !asset.deleted_at)) throw new Error('Asset staging object is still in use.');
        } else {
          const bindings = await tx`SELECT id FROM dataset.asset_bindings WHERE asset_id=${asset.id} LIMIT 1`;
          if (!asset.deleted_at || bindings.length || ![asset.object_key, asset.staging_object_key].includes(current.object_key)) throw new Error('Referenced or active Asset cannot be purged.');
        }
        await deleteObject(current.object_key, current.bucket_name);
        await tx`UPDATE dataset.asset_deletion_jobs SET status='completed', completed_at=now(), error_message=NULL, worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${current.id}`;
      });
    } catch (error) {
      const terminal = job.attempt_count >= job.max_attempts;
      const message = String(error?.message || error).slice(0, 2000);
      await sql`UPDATE dataset.asset_deletion_jobs SET status=${terminal ? 'failed' : 'queued'}, error_message=${message}, completed_at=${terminal ? new Date() : null}, next_attempt_at=now() + ${Math.min(3600, retryDelaySeconds * 2 ** Math.min(job.attempt_count - 1, 20))} * interval '1 second', worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation}`;
      console.error(JSON.stringify({ level: terminal ? 'error' : 'warn', service: 'worker', message: 'Asset deletion deferred', job_id: job.id, terminal, error: message }));
    }
  }
  async function reap() {
    // SKIP LOCKED also avoids waiting on a live worker's storage transaction.
    await sql`WITH expired AS (SELECT id FROM dataset.asset_deletion_jobs WHERE status='processing' AND lease_expires_at < now() AND (${assetId}::uuid IS NULL OR asset_id=${assetId}) FOR UPDATE SKIP LOCKED) UPDATE dataset.asset_deletion_jobs j SET status=CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END, completed_at=CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END, next_attempt_at=now() + ${retryDelaySeconds} * interval '1 second', error_message=COALESCE(error_message,'Asset deletion lease expired.'), worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL FROM expired WHERE j.id=expired.id`;
  }
  return { type: 'asset-deletion', claim, process, heartbeat, reap };
}
