import { expect, test } from 'bun:test';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { assets, assetBindings, assetDeletionJobs } from '../src/db/schema/index.js';
import { deleteObject, hashBytes, readObjectBytes, storeObject } from '../src/services/background-jobs.js';
import { withWorkspaceFixture } from './support/workspace-fixture.js';
import { createAssetDeletionQueue } from '../../worker/src/asset-deletion.js';

// Failure injection and lease recovery require the regular Worker to be stopped.
const recoveryTest = process.env.RUN_ASSET_RECOVERY === '1' ? test : test.skip;

recoveryTest('Asset deletion retries storage failures, fences stale claims and recovers expired leases', async () => {
  await withWorkspaceFixture(async ({ request, headers, scope, roleHeaders }) => {
    const sql = postgres(process.env.DATABASE_URL, { max: 4 });
    scope.defer(() => sql.end({ timeout: 1 }));
    // Roles precede Asset fixtures so their users outlive all dependent rows.
    const editorHeaders = await roleHeaders('editor');
    const viewerHeaders = await roleHeaders('viewer');
    const source = await request('/api/v1/sources', {
      method: 'POST', headers, body: JSON.stringify({ source_type: 'manual', title: 'Deletion recovery source' }),
    });
    expect(source.response.status).toBe(201);
    const bytes = new TextEncoder().encode('recoverable-asset-original');
    const reserved = await request('/api/v1/assets/upload-url', {
      method: 'POST', headers,
      body: JSON.stringify({ original_filename: 'recovery.bin', mime_type: 'application/octet-stream',
        size_bytes: bytes.length, sha256: await hashBytes(bytes), bindings: [{ target_type: 'source', target_id: source.body.data.id }] }),
    });
    if (reserved.body.data?.id) {
      const id = reserved.body.data.id;
      scope.defer(async () => {
        const [asset] = await db.select().from(assets).where(eq(assets.id, id));
        if (asset) {
          scope.defer(() => deleteObject(asset.objectKey));
          scope.defer(() => deleteObject(asset.stagingObjectKey));
        }
        await db.delete(assetDeletionJobs).where(eq(assetDeletionJobs.assetId, id));
        await db.delete(assetBindings).where(eq(assetBindings.assetId, id));
        await db.delete(assets).where(eq(assets.id, id));
      });
    }
    expect(reserved.response.status).toBe(201);
    const assetId = reserved.body.data.id;
    const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
    await storeObject(asset.stagingObjectKey, bytes);
    const completed = await request(`/api/v1/assets/${assetId}/complete`, { method: 'POST', headers, body: '{}' });
    expect(completed.response.status).toBe(200);
    const detach = await request(`/api/v1/assets/${assetId}/bindings/${reserved.body.data.bindings[0].id}`, { method: 'DELETE', headers });
    expect(detach.response.status).toBe(200);
    expect((await request(`/api/v1/assets/${assetId}`, { method: 'DELETE', headers })).response.status).toBe(200);
    let jobs = await sql`SELECT * FROM dataset.asset_deletion_jobs WHERE asset_id=${assetId}`;
    const original = jobs.find((job) => job.object_key === asset.objectKey);
    const staging = jobs.find((job) => job.object_key === asset.stagingObjectKey);
    expect(jobs).toHaveLength(2);
    const deleting = createAssetDeletionQueue({ sql, assetId, workerId: 'test-deletion-worker', retryDelaySeconds: 0, deleteObject });
    expect(await deleting.claim()).toBeNull();
    expect(await readObjectBytes(asset.objectKey)).toEqual(bytes);

    // Only this fixture's clock is advanced. Both retention and retry clocks apply.
    await sql`UPDATE dataset.asset_deletion_jobs SET not_before=now()-interval '1 second', next_attempt_at=now()-interval '1 second' WHERE id=${original.id}`;
    let first = await deleting.claim();
    expect(first.id).toBe(original.id);
    expect(await deleting.claim()).toBeNull();
    const failing = createAssetDeletionQueue({ sql, assetId, workerId: 'test-deletion-worker', retryDelaySeconds: 10, deleteObject: async () => { throw new Error('Injected storage outage'); } });
    await failing.process(first);
    let [retried] = await sql`SELECT * FROM dataset.asset_deletion_jobs WHERE id=${original.id}`;
    expect(retried.status).toBe('queued');
    expect(retried.attempt_count).toBe(1);
    expect(retried.error_message).toContain('Injected storage outage');
    expect(retried.worker_id).toBeNull();
    expect(await deleting.claim()).toBeNull();
    expect(await readObjectBytes(asset.objectKey)).toEqual(bytes);

    await sql`UPDATE dataset.asset_deletion_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=${original.id}`;
    const second = await deleting.claim();
    expect(second.claim_generation).toBe(2);
    expect(second.attempt_count).toBe(2);
    await deleting.process(first); // Stale generation must not touch storage.
    expect(await readObjectBytes(asset.objectKey)).toEqual(bytes);
    await deleting.process(second);
    expect((await sql`SELECT status FROM dataset.asset_deletion_jobs WHERE id=${original.id}`)[0].status).toBe('completed');
    await expect(readObjectBytes(asset.objectKey)).rejects.toThrow();
    expect(await readObjectBytes(asset.stagingObjectKey)).toEqual(bytes);

    // Dead worker before object deletion: reaper retains intent and bumps generation.
    await sql`UPDATE dataset.asset_deletion_jobs SET not_before=now()-interval '1 second', next_attempt_at=now()-interval '1 second' WHERE id=${staging.id}`;
    const crashed = await deleting.claim();
    await sql`UPDATE dataset.asset_deletion_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=${staging.id}`;
    await deleting.reap();
    const recovered = await deleting.claim();
    expect(recovered.claim_generation).toBe(crashed.claim_generation + 1);
    await deleting.process(crashed);
    expect(await readObjectBytes(asset.stagingObjectKey)).toEqual(bytes);
    // Crash after S3 deletion and before DB commit: DELETE of missing key is safe.
    await deleteObject(asset.stagingObjectKey);
    await deleting.process(recovered);
    expect((await sql`SELECT status FROM dataset.asset_deletion_jobs WHERE id=${staging.id}`)[0].status).toBe('completed');

    // Exhaustion remains visible; only admins can retry, and generation never resets.
    await storeObject(asset.objectKey, bytes);
    await sql`UPDATE dataset.asset_deletion_jobs SET status='queued', attempt_count=0, max_attempts=1, completed_at=NULL, next_attempt_at=now() WHERE id=${original.id}`;
    const terminal = await deleting.claim();
    await failing.process(terminal);
    expect((await sql`SELECT status FROM dataset.asset_deletion_jobs WHERE id=${original.id}`)[0].status).toBe('failed');
    const retryPath = `/api/v1/assets/${assetId}/deletion-jobs/${original.id}/retry`;
    expect((await request(retryPath, { method: 'POST', headers: editorHeaders })).response.status).toBe(403);
    expect((await request(`/api/v1/assets/${assetId}/deletion-jobs`, { headers: viewerHeaders })).response.status).toBe(403);
    const retry = await request(retryPath, { method: 'POST', headers });
    expect(retry.response.status).toBe(200);
    expect(retry.body.data.claim_generation).toBe(terminal.claim_generation);
    expect(retry.body.data.attempt_count).toBe(0);
    const final = await deleting.claim();
    expect(final.claim_generation).toBeGreaterThan(terminal.claim_generation);
    await deleting.process(final);
    expect((await request(retryPath, { method: 'POST', headers })).response.status).toBe(409);
    jobs = await request(`/api/v1/assets/${assetId}/deletion-jobs`, { headers });
    expect(jobs.body.data.every((job) => job.status === 'completed')).toBe(true);

    // A misplaced request must not purge an active or newly referenced original.
    await storeObject(asset.objectKey, bytes);
    await sql`UPDATE dataset.assets SET deleted_at=NULL WHERE id=${assetId}`;
    await sql`UPDATE dataset.asset_deletion_jobs SET status='queued', attempt_count=0, max_attempts=3, completed_at=NULL, next_attempt_at=now() WHERE id=${original.id}`;
    await deleting.process(await deleting.claim());
    expect(await readObjectBytes(asset.objectKey)).toEqual(bytes);
    expect((await sql`SELECT error_message FROM dataset.asset_deletion_jobs WHERE id=${original.id}`)[0].error_message).toContain('Referenced or active');
    await sql`UPDATE dataset.assets SET deleted_at=now() WHERE id=${assetId}`;
    const [binding] = await db.insert(assetBindings).values({ assetId, targetType: 'source', targetId: source.body.data.id, createdBy: asset.createdBy }).returning();
    await deleting.process(await deleting.claim());
    expect(await readObjectBytes(asset.objectKey)).toEqual(bytes);
    expect((await request(`/api/v1/assets/${assetId}/bindings/${binding.id}`, { method: 'DELETE', headers })).response.status).toBe(200);
    await deleting.process(await deleting.claim());
    await expect(readObjectBytes(asset.objectKey)).rejects.toThrow();

    // A dead claim at the retry ceiling remains visible rather than disappearing.
    await sql`UPDATE dataset.asset_deletion_jobs SET status='processing', worker_id='dead-worker', heartbeat_at=now()-interval '2 minutes', lease_expires_at=now()-interval '1 minute', completed_at=NULL WHERE id=${original.id}`;
    await deleting.reap();
    expect((await sql`SELECT status FROM dataset.asset_deletion_jobs WHERE id=${original.id}`)[0].status).toBe('failed');
    expect(await deleting.claim()).toBeNull();
  });
}, 30_000);
