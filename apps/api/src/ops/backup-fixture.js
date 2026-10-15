// Used only by the isolated restore drill; never exposed as an HTTP endpoint.
import app from '../app.js';
import { sql, closeDatabase } from '../db/client.js';
import { hashSecret } from '../auth/secrets.js';
import { closeBackgroundQueue, hashBytes, storeObject, deleteObject } from '../services/background-jobs.js';
const [action, root = '/bundle'] = process.argv.slice(2);
const file = `${root}/fixture.json`;
let fixture = action !== 'create' ? await Bun.file(file).json() : { ids: {}, objects: [], refresh: null };
const save = () => Bun.write(file, JSON.stringify(fixture));
let headers;
async function request(path, body, label, method = 'POST') {
  const response = await app.request(path, { method, headers: headers || { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (label && value.data?.id) { fixture.ids[label] = value.data.id; await save(); }
  if (!response.ok) throw new Error(`Fixture request failed ${path}: ${JSON.stringify(value.error)}`);
  return value.data;
}
try {
  if (action === 'create') {
    await save();
    const login = await request('/api/v1/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    fixture.refresh = await hashSecret(login.refresh_token); await save();
    headers = { Authorization: `Bearer ${login.access_token}`, 'Content-Type': 'application/json' };
    const token = crypto.randomUUID();
    const source = await request('/api/v1/sources', { source_type: 'manual', title: `Restore drill ${token}` }, 'source');
    const record = await request('/api/v1/records', { record_type: 'plain_text', source_id: source.id, language_code: `restore-${token.slice(0, 8)}`, content: { text: 'Frozen original evidence' } }, 'record');
    const review = await request(`/api/v1/records/${record.id}/submit-review`, {}, 'review');
    await request(`/api/v1/records/${record.id}/reviews/${review.id}/decision`, { decision: 'approved' });
    fixture.assetText = `Restore object ${token}`; await save();
    const bytes = new TextEncoder().encode(fixture.assetText);
    const asset = await request('/api/v1/assets/upload-url', { original_filename: 'restore.bin', mime_type: 'application/octet-stream', size_bytes: bytes.length, sha256: await hashBytes(bytes), bindings: [{ target_type: 'record', target_id: record.id }] }, 'asset');
    const [stored] = await sql`SELECT * FROM dataset.assets WHERE id=${asset.id}`;
    fixture.objects.push(stored.object_key, stored.staging_object_key); await save();
    await storeObject(stored.staging_object_key, bytes);
    await request(`/api/v1/assets/${asset.id}/complete`, {});
    const definition = await request('/api/v1/datasets', { name: `Restore drill ${token}`, filters: { language_codes: [`restore-${token.slice(0, 8)}`] }, manifest_format: 'jsonl' }, 'definition');
    const snapshot = await request(`/api/v1/datasets/${definition.id}/snapshots`, {}, 'snapshot');
    fixture.objects.push(snapshot.manifest_object_key); await save();
    await request(`/api/v1/records/${record.id}`, { expected_version: 1, content: { text: 'Later correction, snapshot still uses original' } }, null, 'PATCH');
    const entity = await request('/api/v1/memory/entities', { entity_uid: token, entity_type: 'document', proposal_source: 'human', source_id: source.id }, 'entity');
    const relation = await request('/api/v1/memory/relations', { relation_uid: token, source_type: 'entity', source_id: entity.id, target_type: 'record', target_id: record.id, relation_type: 'derived_from', proposal_source: 'human' }, 'relation');
    await request(`/api/v1/memory/relations/${relation.id}/evidence`, { expected_revision: relation.revision, evidence_uid: token, evidence_type: 'record', reference_type: 'record', reference_id: record.id, supports: true }, 'evidence');
    const job = await request('/api/v1/memory/events/async', { batch_uid: token, events: Array.from({ length: 501 }, (_, i) => ({ event_uid: `${token}-${i}`, source_id: source.id, modality: 'state', event_type: 'observation', proposal_source: 'rule' })) }, 'eventJob');
    const [eventJob] = await sql`SELECT object_key FROM memory.event_ingestion_jobs WHERE id=${job.id}`;
    fixture.objects.push(eventJob.object_key); await save();
    const imported = await request('/api/v1/imports/async', { format: 'jsonl', content: JSON.stringify({ record_type: 'plain_text', text: 'Restore import payload' }), idempotency_key: token }, 'importJob');
    fixture.ids.importSource = imported.source_id; fixture.objects.push(imported.object_key); await save();
    const key = `exports/restore-drill/${token}/output.jsonl`;
    const content = JSON.stringify({ text: 'Completed export' });
    fixture.objects.push(key); await save(); await storeObject(key, content);
    const [exported] = await sql`INSERT INTO dataset.export_jobs (format,mode,status,object_key,content_hash,byte_size,record_count,created_by) VALUES ('jsonl','async','completed',${key},${await hashBytes(new TextEncoder().encode(content))},${new TextEncoder().encode(content).length},1,${login.user.id}) RETURNING id`;
    fixture.ids.exportJob = exported.id; await save();
    console.log('Restore drill fixture created');
  } else if (action === 'remove-original' || action === 'repair-original') {
    const [asset] = fixture.ids.asset ? await sql`SELECT object_key FROM dataset.assets WHERE id=${fixture.ids.asset}` : [];
    if (asset) {
      if (action === 'remove-original') await deleteObject(asset.object_key);
      else await storeObject(asset.object_key, new TextEncoder().encode(fixture.assetText));
    }
  } else if (action === 'cleanup') {
    const id = fixture.ids;
    // Jobs cannot still be running: the drill keeps the source Worker stopped.
    if (id.eventJob) {
      const [job] = await sql`SELECT ingestion_batch_id FROM memory.event_ingestion_jobs WHERE id=${id.eventJob}`;
      if (job?.ingestion_batch_id) await sql`DELETE FROM memory.events WHERE ingestion_batch_id=${job.ingestion_batch_id}`;
      await sql`DELETE FROM memory.event_ingestion_jobs WHERE id=${id.eventJob}`;
      if (job?.ingestion_batch_id) await sql`DELETE FROM memory.event_ingestion_batches WHERE id=${job.ingestion_batch_id}`;
    }
    if (id.exportJob) await sql`DELETE FROM dataset.export_jobs WHERE id=${id.exportJob}`;
    if (id.importJob) { await sql`DELETE FROM dataset.import_items WHERE import_job_id=${id.importJob}`; await sql`DELETE FROM dataset.import_jobs WHERE id=${id.importJob}`; }
    if (id.relation) { await sql`DELETE FROM memory.relation_evidence WHERE relation_id=${id.relation}`; await sql`DELETE FROM memory.relations WHERE id=${id.relation}`; }
    if (id.entity) await sql`DELETE FROM memory.entities WHERE id=${id.entity}`;
    if (id.asset) { await sql`DELETE FROM dataset.asset_deletion_jobs WHERE asset_id=${id.asset}`; await sql`DELETE FROM dataset.asset_bindings WHERE asset_id=${id.asset}`; await sql`DELETE FROM dataset.assets WHERE id=${id.asset}`; }
    if (id.snapshot) { await sql`DELETE FROM dataset.dataset_snapshot_records WHERE snapshot_id=${id.snapshot}`; await sql`DELETE FROM dataset.dataset_snapshots WHERE id=${id.snapshot}`; }
    if (id.definition) await sql`DELETE FROM dataset.dataset_definitions WHERE id=${id.definition}`;
    if (id.record) {
      await sql`DELETE FROM dataset.record_reviews WHERE record_id=${id.record}`;
      await sql`UPDATE dataset.records SET current_version_id=NULL WHERE id=${id.record}`;
      await sql`DELETE FROM dataset.record_versions WHERE record_id=${id.record}`;
      await sql`DELETE FROM dataset.records WHERE id=${id.record}`;
    }
    for (const resource of [id.record, id.source, id.importSource].filter(Boolean)) await sql`DELETE FROM system.audit_logs WHERE resource_id=${resource}`;
    for (const source of [id.source, id.importSource].filter(Boolean)) await sql`DELETE FROM dataset.sources WHERE id=${source}`;
    if (fixture.refresh) await sql`DELETE FROM auth.refresh_tokens WHERE token_hash=${fixture.refresh}`;
    for (const key of fixture.objects.filter(Boolean)) await deleteObject(key);
    console.log('Restore drill fixture removed');
  } else throw new Error('Unknown fixture action');
} finally { closeBackgroundQueue(); await closeDatabase(); }
