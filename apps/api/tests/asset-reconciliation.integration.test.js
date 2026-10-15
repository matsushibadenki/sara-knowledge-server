import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/db/client.js';
import { assets, assetBindings, assetDeletionJobs } from '../src/db/schema/index.js';
import { deleteObject, hashBytes, readObjectBytes, statObject, storeObject } from '../src/services/background-jobs.js';
import { inspectAssetInventory, reconcileAssets } from '../src/services/asset-reconciliation.js';
import { createAssetDeletionQueue } from '../../worker/src/asset-deletion.js';
import { withWorkspaceFixture } from './support/workspace-fixture.js';
const recoveryTest = process.env.RUN_ASSET_RECOVERY === '1' ? test : test.skip;

recoveryTest('Asset reconciliation reports integrity loss and safely requeues a late upload without deleting unowned objects', async () => {
  await withWorkspaceFixture(async ({ request, headers, scope }) => {
    const sql = postgres(process.env.DATABASE_URL, { max: 4 });
    scope.defer(() => sql.end({ timeout: 1 }));
    const source = await request('/api/v1/sources', { method: 'POST', headers, body: JSON.stringify({ source_type: 'manual', title: 'Reconciliation fixture' }) });
    expect(source.response.status).toBe(201);
    const bytes = new TextEncoder().encode('reconciliation-original');
    const reserved = await request('/api/v1/assets/upload-url', { method: 'POST', headers, body: JSON.stringify({
      original_filename: 'reconcile.bin', mime_type: 'application/octet-stream', size_bytes: bytes.length,
      sha256: await hashBytes(bytes), bindings: [{ target_type: 'source', target_id: source.body.data.id }],
    }) });
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
    expect(reserved.response.status).toBe(201);
    expect((await fetch(reserved.body.data.upload_url, { method: 'PUT', body: bytes })).ok).toBe(true);
    expect((await request(`/api/v1/assets/${id}/complete`, { method: 'POST', headers, body: '{}' })).response.status).toBe(200);
    const [asset] = await db.select().from(assets).where(eq(assets.id, id));
    await deleteObject(asset.stagingObjectKey);
    await sql`UPDATE dataset.asset_deletion_jobs SET status='completed', completed_at=now(), attempt_count=1, claim_generation=3, not_before=now()-interval '1 second' WHERE asset_id=${id}`;
    // The fixture advances the retention deadline instead of waiting ten minutes.
    expect((await fetch(reserved.body.data.upload_url, { method: 'PUT', body: bytes })).ok).toBe(true);
    const findings = [];
    const options = { sql, bucket: asset.bucketName, assetId: id, statObject, readObjectBytes, hashBytes, onFinding: (finding) => findings.push(finding) };
    const dry = await reconcileAssets(options);
    expect(dry.requeued).toBe(0);
    expect(findings.map((finding) => finding.type)).toEqual(['reappeared_object']);
    expect((await sql`SELECT status FROM dataset.asset_deletion_jobs WHERE asset_id=${id}`)[0].status).toBe('completed');
    const applied = await reconcileAssets({ ...options, apply: true });
    expect(applied.requeued).toBe(1);
    expect((await sql`SELECT claim_generation FROM dataset.asset_deletion_jobs WHERE asset_id=${id}`)[0].claim_generation).toBe(3);
    expect((await reconcileAssets({ ...options, apply: true })).requeued).toBe(0);
    const queue = createAssetDeletionQueue({ sql, assetId: id, workerId: 'reconcile-test', deleteObject });
    const job = await queue.claim();
    expect(job.claim_generation).toBe(4);
    await queue.process(job);
    await expect(statObject(asset.stagingObjectKey)).rejects.toThrow();
    expect(await readObjectBytes(asset.objectKey)).toEqual(bytes);
    expect((await reconcileAssets(options)).findings).toBe(0);

    const unownedKey = `assets/unowned-test/${crypto.randomUUID()}`;
    scope.defer(() => deleteObject(unownedKey));
    await storeObject(unownedKey, bytes);
    expect((await inspectAssetInventory({ sql, bucket: asset.bucketName, key: unownedKey })).type).toBe('unowned_object');
    expect(await inspectAssetInventory({ sql, bucket: asset.bucketName, key: asset.objectKey })).toBeNull();
    expect(await inspectAssetInventory({ sql, bucket: asset.bucketName, key: 'exports/not-an-asset' })).toBeNull();
    expect(await readObjectBytes(unownedKey)).toEqual(bytes);

    findings.length = 0;
    await storeObject(asset.objectKey, new TextEncoder().encode('corruption'));
    await reconcileAssets({ ...options, apply: true });
    expect(findings.map((finding) => finding.type)).toEqual(['original_integrity_mismatch']);
    await deleteObject(asset.objectKey);
    findings.length = 0;
    await reconcileAssets({ ...options, apply: true });
    expect(findings.map((finding) => finding.type)).toEqual(['missing_original']);
    findings.length = 0;
    const inaccessible = await reconcileAssets({ ...options, apply: true, statObject: async () => { throw new Error('Storage unavailable'); } });
    expect(inaccessible.errors).toBe(2);
    expect(findings.every((finding) => finding.type === 'storage_error')).toBe(true);

    // Reappearing deleted originals must still pass the reference check.
    expect((await request(`/api/v1/assets/${id}/bindings/${reserved.body.data.bindings[0].id}`, { method: 'DELETE', headers })).response.status).toBe(200);
    expect((await request(`/api/v1/assets/${id}`, { method: 'DELETE', headers })).response.status).toBe(200);
    await sql`UPDATE dataset.asset_deletion_jobs SET status='completed', completed_at=now(), not_before=now()-interval '1 second' WHERE asset_id=${id}`;
    await storeObject(asset.objectKey, bytes);
    const [binding] = await db.insert(assetBindings).values({ assetId: id, targetType: 'source', targetId: source.body.data.id, createdBy: asset.createdBy }).returning();
    expect((await reconcileAssets({ ...options, apply: true })).requeued).toBe(0);
    expect(await readObjectBytes(asset.objectKey)).toEqual(bytes);
    expect((await request(`/api/v1/assets/${id}/bindings/${binding.id}`, { method: 'DELETE', headers })).response.status).toBe(200);
    expect((await reconcileAssets({ ...options, apply: true })).requeued).toBe(1);
    await queue.process(await queue.claim());
    await expect(statObject(asset.objectKey)).rejects.toThrow();
  });
}, 30_000);
