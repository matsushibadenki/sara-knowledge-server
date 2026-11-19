import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const CHUNK_BYTES = 48 * 1024;
const MAX_METADATA_BYTES = 32 * 1024 * 1024;
const hashString = (hash) => `sha256:${hash.digest('hex')}`;
const line = (value) => Buffer.from(JSON.stringify(value) + '\n');

async function* file(path, chunks, expected = {}) {
  yield line({ type: 'file', path });
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (expected.size != null && size > expected.size) throw new Error(`Size mismatch for ${path}`);
    hash.update(chunk);
    for (let i = 0; i < chunk.length; i += CHUNK_BYTES) {
      yield line({ type: 'data', base64: Buffer.from(chunk.subarray(i, i + CHUNK_BYTES)).toString('base64') });
    }
  }
  const sha256 = hashString(hash);
  if ((expected.size != null && size !== expected.size) || (expected.sha256 && sha256 !== expected.sha256)) {
    throw new Error(`Integrity mismatch for ${path}`);
  }
  yield line({ type: 'end', size_bytes: size, sha256 });
}

async function* bundle(sql, snapshot, storage, storageForBucket) {
  const chunks = [];
  let size = 0;
  for await (const chunk of storage.file(snapshot.manifest_object_key).stream()) {
    size += chunk.length;
    if (size > MAX_METADATA_BYTES) throw new Error('Manifest metadata exceeds 32 MiB');
    chunks.push(chunk);
  }
  const manifestBytes = Buffer.concat(chunks, size);
  if (hashString(createHash('sha256').update(manifestBytes)) !== snapshot.manifest_hash) throw new Error('Manifest SHA-256 mismatch');
  const text = manifestBytes.toString('utf8');
  const jsonl = snapshot.manifest_format === 'jsonl';
  const lines = jsonl ? text.trimEnd().split('\n') : null;
  const manifest = JSON.parse(jsonl ? lines[0] : text);
  if (manifest.schema !== 'sara.dataset-manifest/1.2' || manifest.snapshot_id !== snapshot.id) {
    throw new Error('Snapshot lacks frozen provenance');
  }
  const entries = jsonl ? lines.slice(1).map((entry) => JSON.parse(entry)) : manifest.records;
  if (entries.length !== snapshot.record_count) throw new Error('Snapshot membership is incomplete');

  yield line({ type: 'bundle', schema: 'sara.snapshot-stream/1', snapshot_id: snapshot.id });
  yield* file(`manifest.${snapshot.manifest_format}`, [manifestBytes]);
  async function* records() {
    let index = 0;
    for await (const rows of sql`
      SELECT m.ordinal, v.id, v.record_id, v.version_number, v.schema_version, v.content, v.plain_text,
             v.context_snapshot, v.source_id, v.source_revision, v.source_pin_state
      FROM dataset.dataset_snapshot_records m
      JOIN dataset.record_versions v ON v.id = m.record_version_id AND v.record_id = m.record_id
      WHERE m.snapshot_id = ${snapshot.id} ORDER BY m.ordinal`.cursor(1)) {
      for (const row of rows) {
        const expected = entries[index++];
        if (!expected || expected.record_version_id !== row.id || expected.ordinal !== row.ordinal ||
            expected.source_id !== row.source_id || expected.source_revision !== row.source_revision ||
            row.source_pin_state === 'legacy_unknown' || !row.context_snapshot) {
          throw new Error('Record version differs from frozen manifest');
        }
        yield line(row);
      }
    }
    if (index !== entries.length) throw new Error('Snapshot members are missing');
  }
  yield* file('records.jsonl', records());

  async function* sources() {
    const expected = new Set(entries.filter((row) => row.source_id).map((row) => `${row.source_id}:${row.source_revision}`));
    for await (const rows of sql`
      SELECT s.source_id, s.revision, s.origin, s.recorded_at, s.snapshot
      FROM dataset.source_revisions s
      JOIN (
        SELECT DISTINCT v.source_id, v.source_revision
        FROM dataset.dataset_snapshot_records m JOIN dataset.record_versions v ON v.id=m.record_version_id
        WHERE m.snapshot_id=${snapshot.id} AND v.source_revision IS NOT NULL
      ) p ON p.source_id=s.source_id AND p.source_revision=s.revision
      ORDER BY s.source_id,s.revision`.cursor(1)) {
      for (const row of rows) {
        if (!expected.delete(`${row.source_id}:${row.revision}`)) throw new Error('Unexpected Source version');
        yield line(row);
      }
    }
    if (expected.size) throw new Error('A frozen Source version is missing');
  }
  yield* file('sources.jsonl', sources());

  const expectedAssets = new Map(manifest.asset_bindings_at_creation.map((a) => [a.asset_id, a]));
  for await (const rows of sql`
    SELECT a.id,a.bucket_name,a.object_key,a.sha256,a.size_bytes::text AS size_bytes
    FROM dataset.dataset_snapshot_assets p JOIN dataset.assets a ON a.id=p.asset_id
    WHERE p.snapshot_id=${snapshot.id} AND a.status='ready' AND a.deleted_at IS NULL ORDER BY a.id`.cursor(1)) {
    for (const asset of rows) {
      const expected = expectedAssets.get(asset.id);
      if (!expected || expected.sha256 !== asset.sha256 || expected.size_bytes !== asset.size_bytes) {
        throw new Error('Asset metadata differs from frozen manifest');
      }
      yield* file(`assets/${asset.id}`, storageForBucket(asset.bucket_name).file(asset.object_key).stream(),
        { size: Number(expected.size_bytes), sha256: expected.sha256 });
      expectedAssets.delete(asset.id);
    }
  }
  if (expectedAssets.size) throw new Error('Snapshot Asset retention references are incomplete');
  yield line({ type: 'complete' });
}

export function createSnapshotBundleQueue({ sql, storage, storageForBucket, leaseSeconds, retryDelaySeconds }) {
  const maxAttempts = 3;
  const type = 'snapshot-bundle';
  async function claim() {
    const [job] = await sql`
      WITH candidate AS (
        SELECT id FROM dataset.snapshot_bundle_jobs WHERE status='queued' AND next_attempt_at<=now()
        ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE dataset.snapshot_bundle_jobs j
      SET status='processing', generation=generation+1, attempt_count=attempt_count+1,
          lease_expires_at=now()+${leaseSeconds} * interval '1 second'
      FROM candidate WHERE j.id=candidate.id RETURNING j.*`;
    return job;
  }
  function heartbeat(job) {
    return sql`UPDATE dataset.snapshot_bundle_jobs SET lease_expires_at=now()+${leaseSeconds} * interval '1 second'
      WHERE id=${job.id} AND generation=${job.generation} AND status='processing'`;
  }
  function reap() {
    return sql`UPDATE dataset.snapshot_bundle_jobs
      SET status=CASE WHEN attempt_count>=${maxAttempts} THEN 'failed' ELSE 'queued' END,
          lease_expires_at=NULL, next_attempt_at=now(), error_message='Worker lease expired'
      WHERE status='processing' AND lease_expires_at<now()`;
  }
  async function process(job) {
    let dir;
    try {
      const [snapshot] = await sql`SELECT * FROM dataset.dataset_snapshots WHERE id=${job.snapshot_id} AND status='completed'`;
      if (!snapshot?.manifest_hash || !snapshot.manifest_object_key) throw new Error('Snapshot is unavailable');
      dir = await mkdtemp(join(tmpdir(), 'sara-snapshot-'));
      const path = join(dir, 'bundle.ndjson');
      const hash = createHash('sha256');
      let size = 0;
      await pipeline(bundle(sql, snapshot, storage, storageForBucket), async function* (source) {
        for await (const chunk of source) {
          size += chunk.length;
          hash.update(chunk);
          yield chunk;
        }
      }, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      const objectKey = `snapshot-bundles/${job.id}/${job.generation}.ndjson`;
      await storage.file(objectKey).write(Bun.file(path), {
        type: 'application/x-ndjson', partSize: 8 * 1024 * 1024, queueSize: 1,
      });
      const committed = await sql`UPDATE dataset.snapshot_bundle_jobs
        SET status='completed', object_key=${objectKey}, sha256=${hashString(hash)}, size_bytes=${size},
            lease_expires_at=NULL, error_message=NULL
        WHERE id=${job.id} AND generation=${job.generation} AND status='processing' RETURNING id`;
      if (!committed.length) await storage.delete(objectKey);
    } catch (error) {
      await sql`UPDATE dataset.snapshot_bundle_jobs
        SET status=${job.attempt_count >= maxAttempts ? 'failed' : 'queued'}, lease_expires_at=NULL,
            error_message=${String(error.message || error).slice(0, 1000)},
            next_attempt_at=now()+${retryDelaySeconds} * interval '1 second'
        WHERE id=${job.id} AND generation=${job.generation} AND status='processing'`;
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }
  return { type, claim, heartbeat, reap, process };
}
