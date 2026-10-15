import { createHash } from 'node:crypto';

const schemas = ['auth', 'dataset', 'memory', 'training', 'system', 'drizzle'];
export async function captureBackupState(sql, bucket) {
  return sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await tx`SET LOCAL TIME ZONE 'UTC'`;
    const tables = {};
    const names = await tx`SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('auth','dataset','memory','training','system','drizzle') ORDER BY schemaname,tablename`;
    for (const { schemaname, tablename } of names) {
      if (!schemas.includes(schemaname) || !/^[a-z_][a-z_0-9]*$/.test(tablename)) throw new Error('Unsupported backup table');
      const hash = createHash('sha256'); let count = 0;
      // Catalog names are constrained above; rows stream rather than aggregate in JS.
      for await (const rows of tx.unsafe(`SELECT to_jsonb(t)::text AS row FROM "${schemaname}"."${tablename}" t ORDER BY to_jsonb(t)::text COLLATE "C"`).cursor(100)) {
        for (const row of rows) { hash.update(row.row + '\n'); count += 1; }
      }
      tables[`${schemaname}.${tablename}`] = { count, sha256: hash.digest('hex') };
    }
    const otherBuckets = await tx`SELECT DISTINCT bucket_name FROM dataset.assets WHERE bucket_name <> ${bucket}`;
    if (otherBuckets.length) throw new Error('Backup supports one configured bucket; other Asset buckets exist');
    const references = await tx`
      SELECT 'asset' AS kind, id::text AS id, object_key AS key, sha256 AS hash, size_bytes::text AS size,
        (status='ready' AND deleted_at IS NULL) AS required, NULL::text AS batch_uid, NULL::int AS event_count FROM dataset.assets
      UNION ALL SELECT 'staging',id::text,staging_object_key,NULL,NULL,false,NULL,NULL FROM dataset.assets WHERE staging_object_key IS NOT NULL
      UNION ALL SELECT 'import',id::text,object_key,content_hash,byte_size::text,true,NULL,NULL FROM dataset.import_jobs WHERE object_key IS NOT NULL
      UNION ALL SELECT 'export',id::text,object_key,content_hash,CASE WHEN status='completed' THEN byte_size::text ELSE NULL END,status='completed',NULL,NULL FROM dataset.export_jobs WHERE object_key IS NOT NULL
      UNION ALL SELECT 'snapshot',id::text,manifest_object_key,manifest_hash,NULL,status='completed',NULL,NULL FROM dataset.dataset_snapshots WHERE manifest_object_key IS NOT NULL
      UNION ALL SELECT 'event_job',id::text,object_key,content_hash,NULL,true,batch_uid,event_count FROM memory.event_ingestion_jobs
      ORDER BY kind,id,key`;
    const invalid = await tx`
      WITH nodes AS (
        SELECT 'source' AS type,id FROM dataset.sources UNION ALL SELECT 'record',id FROM dataset.records
        UNION ALL SELECT 'event',id FROM memory.events UNION ALL SELECT 'experience',id FROM memory.experiences
        UNION ALL SELECT 'entity',id FROM memory.entities UNION ALL SELECT 'concept',id FROM memory.concepts
        UNION ALL SELECT 'entity_alias',id FROM memory.entity_aliases UNION ALL SELECT 'relation',id FROM memory.relations
        UNION ALL SELECT 'dataset_snapshot',id FROM dataset.dataset_snapshots UNION ALL SELECT 'model',id FROM training.models
      ), refs AS (
        SELECT 'asset_binding' AS kind,id,target_type AS type,target_id AS target FROM dataset.asset_bindings
        UNION ALL SELECT 'relation_source',id,source_type,source_id FROM memory.relations
        UNION ALL SELECT 'relation_target',id,target_type,target_id FROM memory.relations
        UNION ALL SELECT 'evidence',id,reference_type,reference_id FROM memory.relation_evidence WHERE reference_type <> 'external'
        UNION ALL SELECT 'verification',id,target_type,target_id FROM memory.verification_decisions
      ) SELECT r.kind,r.id FROM refs r LEFT JOIN nodes n ON n.type=r.type AND n.id=r.target WHERE n.id IS NULL
      UNION ALL SELECT 'record_version',r.id FROM dataset.records r LEFT JOIN dataset.record_versions v ON v.id=r.current_version_id AND v.record_id=r.id WHERE (r.current_version_id IS NULL AND r.deleted_at IS NULL) OR (r.current_version_id IS NOT NULL AND (v.id IS NULL OR NOT v.is_current))
      UNION ALL SELECT 'review_version',r.id FROM dataset.record_reviews r JOIN dataset.record_versions v ON v.id=r.record_version_id WHERE v.record_id<>r.record_id
      UNION ALL SELECT 'snapshot_version',r.snapshot_id FROM dataset.dataset_snapshot_records r JOIN dataset.record_versions v ON v.id=r.record_version_id WHERE v.record_id<>r.record_id
      UNION ALL SELECT 'snapshot_manifest',s.id FROM dataset.dataset_snapshots s WHERE s.status='completed' AND (s.manifest_object_key IS NULL OR s.manifest_hash IS NULL)
      UNION ALL SELECT 'export_object',j.id FROM dataset.export_jobs j WHERE j.mode='async' AND j.status='completed' AND (j.object_key IS NULL OR j.content_hash IS NULL)
      UNION ALL SELECT 'snapshot_count',s.id FROM dataset.dataset_snapshots s WHERE s.status='completed' AND s.record_count<>(SELECT count(*) FROM dataset.dataset_snapshot_records r WHERE r.snapshot_id=s.id)`;
    if (invalid.length) throw new Error(`Invalid database references: ${JSON.stringify(invalid.slice(0, 20))}`);
    return { tables, references };
  });
}

export function sameDatabaseState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
