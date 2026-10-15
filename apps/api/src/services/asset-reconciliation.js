const missingCodes = new Set(['NoSuchKey', 'NotFound', 'NoSuchObject']);

// Inventory is evidence for reporting only. Never delete an unowned key.
export async function inspectAssetInventory({ sql, bucket, key }) {
  if (!key.startsWith('assets/')) return null;
  const rows = await sql`SELECT id FROM dataset.assets WHERE bucket_name=${bucket} AND (object_key=${key} OR staging_object_key=${key}) LIMIT 1`;
  return rows.length ? null : { type: 'unowned_object', bucket, key };
}

export async function reconcileAssets({ sql, bucket, statObject, readObjectBytes, hashBytes, apply = false, assetId = null, onFinding = () => {} }) {
  const summary = { assets: 0, findings: 0, requeued: 0, errors: 0 };
  async function emit(finding) {
    summary.findings += 1;
    if (finding.type === 'storage_error') summary.errors += 1;
    await onFinding(finding);
  }
  let cursor = '00000000-0000-0000-0000-000000000000';
  while (true) {
    const rows = await sql`SELECT * FROM dataset.assets WHERE bucket_name=${bucket} AND id > ${cursor}::uuid AND (${assetId}::uuid IS NULL OR id=${assetId}) ORDER BY id LIMIT 100`;
    if (!rows.length) break;
    for (const asset of rows) {
      summary.assets += 1;
      for (const key of [asset.object_key, asset.staging_object_key].filter(Boolean)) {
        let stat;
        try { stat = await statObject(key); } catch (error) {
          if (!missingCodes.has(error.code) && error.status !== 404) {
            await emit({ type: 'storage_error', asset_id: asset.id, key, error: String(error.message) });
            continue;
          }
        }
        if (!stat) {
          if (!asset.deleted_at && asset.status === 'ready' && key === asset.object_key) await emit({ type: 'missing_original', asset_id: asset.id, key });
          continue;
        }
        if (!asset.deleted_at && asset.status === 'ready' && key === asset.object_key) {
          try {
            const valid = Number(stat.size) === Number(asset.size_bytes) && await hashBytes(await readObjectBytes(key)) === asset.sha256;
            if (!valid) await emit({ type: 'original_integrity_mismatch', asset_id: asset.id, key });
          } catch (error) { await emit({ type: 'storage_error', asset_id: asset.id, key, error: String(error.message) }); }
          continue;
        }
        // Only completed durable requests may be reopened. Recheck the owning
        // Asset under the same lock order used by completion and deletion.
        const [job] = await sql`SELECT * FROM dataset.asset_deletion_jobs WHERE asset_id=${asset.id} AND object_key=${key} AND bucket_name=${bucket} AND status='completed' AND not_before <= now()`;
        if (!job) continue;
        let requeued = false;
        if (apply) {
          requeued = await sql.begin(async (tx) => {
            const [current] = await tx`SELECT * FROM dataset.assets WHERE id=${asset.id} FOR UPDATE`;
            if (!current || current.bucket_name !== bucket) return false;
            if (job.reason === 'staging') {
              if (current.staging_object_key !== key || (current.status !== 'ready' && !current.deleted_at)) return false;
            } else {
              const refs = await tx`SELECT id FROM dataset.asset_bindings WHERE asset_id=${asset.id} LIMIT 1`;
              if (!current.deleted_at || refs.length || ![current.object_key, current.staging_object_key].includes(key)) return false;
            }
            const changed = await tx`UPDATE dataset.asset_deletion_jobs SET status='queued', attempt_count=0, completed_at=NULL, next_attempt_at=now(), error_message='Object reappeared after completed deletion.' WHERE id=${job.id} AND status='completed' AND not_before <= now() RETURNING id`;
            return changed.length > 0;
          });
          if (requeued) summary.requeued += 1;
        }
        await emit({ type: 'reappeared_object', asset_id: asset.id, key, job_id: job.id, requeued });
      }
    }
    cursor = rows.at(-1).id;
  }
  return summary;
}
