import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import app from '../src/app.js';
import { db } from '../src/db/client.js';
import {
  assets, assetBindings, auditLogs, datasetDefinitions, datasetSnapshotRecords, datasetSnapshots, recordVersions, records,
  refreshTokens, sources, trainingMetrics, trainingModels, trainingRuns,
} from '../src/db/schema/index.js';
import { hashSecret } from '../src/auth/secrets.js';
import { deleteObject, hashBytes, storeObject } from '../src/services/background-jobs.js';
import { createIntegrationFixture } from './support/integration-fixture.js';

const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

async function request(path, options = {}) {
  const response = await app.request(path, options);
  return { response, body: await response.json() };
}

integrationTest('Snapshot membership and Training Run model version stay fixed after Record and model edits', async () => {
  const scope = createIntegrationFixture();
  try {
    const login = await request('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    });
    if (login.body.data?.refresh_token) {
      const token = login.body.data.refresh_token;
      scope.defer(async () => db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, await hashSecret(token))));
    }
    expect(login.response.status).toBe(200);
    const headers = { Authorization: `Bearer ${login.body.data.access_token}`, 'Content-Type': 'application/json' };
    const language = `dataset-${crypto.randomUUID().slice(0, 8)}`;

    const source = await request('/api/v1/sources', {
      method: 'POST', headers,
      body: JSON.stringify({ source_type: 'manual', title: 'Independent Dataset source' }),
    });
    if (source.body.data?.id) {
      const sourceId = source.body.data.id;
      scope.defer(async () => {
        await db.delete(auditLogs).where(eq(auditLogs.resourceId, sourceId));
        await db.delete(sources).where(eq(sources.id, sourceId));
      });
    }
    expect(source.response.status).toBe(201);

    for (let index = 0; index < 3; index += 1) {
      const created = await request('/api/v1/records', {
        method: 'POST', headers,
        body: JSON.stringify({
          record_type: 'plain_text', title: `Dataset member ${index}`, language_code: language,
          source_id: source.body.data.id, content: { text: `Version one, record ${index}` },
        }),
      });
      if (created.body.data?.id) {
        const recordId = created.body.data.id;
        scope.defer(async () => db.transaction(async (tx) => {
          await tx.delete(auditLogs).where(eq(auditLogs.resourceId, recordId));
          await tx.update(records).set({ currentVersionId: null }).where(eq(records.id, recordId));
          await tx.delete(recordVersions).where(eq(recordVersions.recordId, recordId));
          await tx.delete(records).where(eq(records.id, recordId));
        }));
      }
      expect(created.response.status).toBe(201);
    }

    const definition = await request('/api/v1/datasets', {
      method: 'POST', headers,
      body: JSON.stringify({
        name: `Independent Dataset ${crypto.randomUUID()}`,
        description: 'Immutable integration snapshot',
        filters: { statuses: ['draft'], record_types: ['plain_text'], language_codes: [language] },
        manifest_format: 'jsonl',
      }),
    });
    if (definition.body.data?.id) {
      const definitionId = definition.body.data.id;
      scope.defer(() => db.delete(datasetDefinitions).where(eq(datasetDefinitions.id, definitionId)));
    }
    expect(definition.response.status).toBe(201);
    const duplicateDefinition = await request('/api/v1/datasets', {
      method: 'POST', headers,
      body: JSON.stringify({
        name: definition.body.data.name, filters: { language_codes: [language] }, manifest_format: 'jsonl',
      }),
    });
    expect(duplicateDefinition.response.status).toBe(409);

    const assetKey = `snapshot-fixture/${crypto.randomUUID()}`;
    const original = Buffer.from('test');
    await storeObject(assetKey, original);
    scope.defer(() => deleteObject(assetKey));
    const [asset] = await db.insert(assets).values({
      bucketName: process.env.MINIO_BUCKET || 'sara-assets', objectKey: assetKey,
      originalFilename: 'fixture.txt', mimeType: 'text/plain', sizeBytes: 4,
      sha256: await hashBytes(original), status: 'ready', createdBy: login.body.data.user.id,
    }).returning();
    scope.defer(() => db.delete(assets).where(eq(assets.id, asset.id)));
    const [binding] = await db.insert(assetBindings).values({
      assetId: asset.id, targetType: 'source', targetId: source.body.data.id,
      createdBy: login.body.data.user.id,
    }).returning();
    const snapshot = await request(`/api/v1/datasets/${definition.body.data.id}/snapshots`, {
      method: 'POST', headers, body: '{}',
    });
    if (snapshot.body.data?.id) {
      const snapshotId = snapshot.body.data.id;
      const objectKey = snapshot.body.data.manifest_object_key;
      scope.defer(async () => {
        let objectError;
        if (objectKey) {
          try { await deleteObject(objectKey); } catch (error) { objectError = error; }
        }
        await db.delete(datasetSnapshotRecords).where(eq(datasetSnapshotRecords.snapshotId, snapshotId));
        await db.delete(datasetSnapshots).where(eq(datasetSnapshots.id, snapshotId));
        if (objectError) throw objectError;
      });
    }
    expect(snapshot.response.status).toBe(201);
    expect(snapshot.body.data.status).toBe('completed');
    expect(snapshot.body.data.record_count).toBe(3);
    expect(snapshot.body.data.manifest_hash).toStartWith('sha256:');

    await db.delete(assetBindings).where(eq(assetBindings.id, binding.id));
    const blockedDeletion = await request(`/api/v1/assets/${asset.id}`, { method: 'DELETE', headers });
    expect(blockedDeletion.response.status).toBe(409);
    expect(blockedDeletion.body.error.code).toBe('ASSET_SNAPSHOT_IN_USE');
    const impactPath = `/api/v1/datasets/${definition.body.data.id}/snapshots/${snapshot.body.data.id}/impact`;
    expect((await request(impactPath, { headers })).body.data).toEqual([]);
    const sourceChanged = await request(`/api/v1/sources/${source.body.data.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ expected_revision: 1, title: 'Corrected source after snapshot' }),
    });
    expect(sourceChanged.body.data.revision).toBe(2);
    const impact = await request(`${impactPath}?limit=1`, { headers });
    expect(impact.response.status).toBe(200);
    expect(impact.body.data[0]).toMatchObject({ ordinal: 1, source_revision: 1, current_source_revision: 2, reason: 'source_revised' });
    const nextImpact = await request(`${impactPath}?after_ordinal=${impact.body.meta.next_after_ordinal}`, { headers });
    expect(nextImpact.body.data.map((item) => item.ordinal)).toEqual([2, 3]);
    expect((await request(`/api/v1/sources/${source.body.data.id}`, { method: 'DELETE', headers })).response.status).toBe(200);
    expect((await request(impactPath, { headers })).body.data.map((item) => item.reason))
      .toEqual(['source_withdrawn', 'source_withdrawn', 'source_withdrawn']);
    const detailBefore = await request(
      `/api/v1/datasets/${definition.body.data.id}/snapshots/${snapshot.body.data.id}`, { headers },
    );
    expect(detailBefore.response.status).toBe(200);
    expect(detailBefore.body.data.records).toHaveLength(3);
    const frozenMember = detailBefore.body.data.records[0];
    const revised = await request(`/api/v1/records/${frozenMember.record_id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ expected_version: 1, title: 'Updated after immutable snapshot' }),
    });
    expect(revised.response.status).toBe(200);
    expect(revised.body.data.current_version_id).not.toBe(frozenMember.record_version_id);
    const detailAfter = await request(
      `/api/v1/datasets/${definition.body.data.id}/snapshots/${snapshot.body.data.id}`, { headers },
    );
    expect(detailAfter.body.data.records[0].record_version_id).toBe(frozenMember.record_version_id);
    const manifest = await app.request(
      `/api/v1/datasets/${definition.body.data.id}/snapshots/${snapshot.body.data.id}/manifest`, { headers },
    );
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('X-Content-SHA256')).toBe(snapshot.body.data.manifest_hash);
    const manifestText = await manifest.text();
    expect(JSON.parse(manifestText.split('\n')[0])).toMatchObject({
      schema: 'sara.dataset-manifest/1.2',
      selection_policy: 'dataset-selection/1',
      asset_bindings_at_creation: [{ asset_id: asset.id, sha256: asset.sha256, size_bytes: '4' }],
    });
    const manifestEntries = manifestText.split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.type === 'record');
    expect(manifestEntries).toHaveLength(3);
    for (const entry of manifestEntries) {
      expect(entry.source_id).toBe(source.body.data.id);
      expect(entry.source_revision).toBe(1);
      expect(entry.source_pin_state).toBe('pinned');
      expect(entry.context_snapshot.language_code).toBe(language);
    }
    expect(manifestText).toContain(frozenMember.record_version_id);
    expect(manifestText).not.toContain(revised.body.data.current_version_id);

    const bundlePath = `/api/v1/datasets/${definition.body.data.id}/snapshots/${snapshot.body.data.id}/bundle`;
    const bundleResponse = await app.request(bundlePath, { headers });
    expect(bundleResponse.status).toBe(200);
    const bundleBytes = Buffer.from(await bundleResponse.arrayBuffer());
    expect(await hashBytes(bundleBytes)).toBe(bundleResponse.headers.get('X-Content-SHA256'));
    const bundle = JSON.parse(bundleBytes.toString());
    for (const file of bundle.files) {
      expect(await hashBytes(Buffer.from(file.base64, 'base64'))).toBe(file.sha256);
    }
    const file = (path) => Buffer.from(bundle.files.find((entry) => entry.path === path).base64, 'base64').toString();
    expect(file('manifest.jsonl')).toBe(manifestText);
    expect(JSON.parse(file('records.json')).map((record) => record.id)).toContain(frozenMember.record_version_id);
    expect(JSON.parse(file('sources.json'))[0].snapshot.title).toBe('Independent Dataset source');
    expect(file(`assets/${asset.id}`)).toBe('test');
    await storeObject(assetKey, Buffer.from('oops'));
    expect((await request(bundlePath, { headers })).body.error.code).toBe('BUNDLE_INTEGRITY_ERROR');
    await deleteObject(assetKey);
    expect((await request(bundlePath, { headers })).body.error.code).toBe('BUNDLE_OBJECT_MISSING');

    if (process.env.RUN_LARGE_BUNDLE === '1') {
      const large = Buffer.alloc(33 * 1024 * 1024, 0x41);
      const digest = await hashBytes(large);
      await storeObject(assetKey, large);
      await db.update(assets).set({ sha256: digest, sizeBytes: large.length }).where(eq(assets.id, asset.id));
      await db.insert(assetBindings).values({
        assetId: asset.id, targetType: 'source', targetId: source.body.data.id,
        createdBy: login.body.data.user.id,
      });
      const largeSnapshot = await request(`/api/v1/datasets/${definition.body.data.id}/snapshots`, {
        method: 'POST', headers, body: '{}',
      });
      expect(largeSnapshot.response.status).toBe(201);
      const largeSnapshotId = largeSnapshot.body.data.id;
      const jobPath = `/api/v1/datasets/${definition.body.data.id}/snapshots/${largeSnapshotId}/bundle-job`;
      scope.defer(async () => {
        const { snapshotBundleJobs } = await import('../src/db/schema/index.js');
        const [job] = await db.select().from(snapshotBundleJobs).where(eq(snapshotBundleJobs.snapshotId, largeSnapshotId));
        if (job?.objectKey) await deleteObject(job.objectKey);
        await deleteObject(largeSnapshot.body.data.manifest_object_key);
        await db.delete(datasetSnapshots).where(eq(datasetSnapshots.id, largeSnapshotId));
      });
      const started = await request(jobPath, { method: 'POST', headers });
      expect(started.response.status).toBe(202);
      const duplicate = await request(jobPath, { method: 'POST', headers });
      expect(duplicate.body.data.id).toBe(started.body.data.id);
      let job;
      for (let i = 0; i < 80; i++) {
        job = (await request(jobPath, { headers })).body.data;
        if (['completed', 'failed'].includes(job.status)) break;
        await Bun.sleep(250);
      }
      expect(job).toMatchObject({ status: 'completed', error_message: null });
      const downloaded = await app.request(`${jobPath}/download`, { headers });
      expect(downloaded.status).toBe(200);
      const hash = new Bun.CryptoHasher('sha256');
      let count = 0;
      for await (const chunk of downloaded.body) {
        hash.update(chunk);
        count += chunk.length;
      }
      expect(count).toBe(job.size_bytes);
      expect(count).toBeGreaterThan(32 * 1024 * 1024);
      expect(`sha256:${hash.digest('hex')}`).toBe(downloaded.headers.get('X-Content-SHA256'));
    }

    const model = await request('/api/v1/training/models', {
      method: 'POST', headers,
      body: JSON.stringify({
        name: `Independent model ${crypto.randomUUID()}`, provider: 'local', model_family: 'test-family',
        model_version: '1.0', base_model: 'base/test', configuration: { precision: 'bf16' },
      }),
    });
    if (model.body.data?.id) {
      const modelId = model.body.data.id;
      scope.defer(() => db.delete(trainingModels).where(eq(trainingModels.id, modelId)));
    }
    expect(model.response.status).toBe(201);
    const duplicateModel = await request('/api/v1/training/models', {
      method: 'POST', headers, body: JSON.stringify({ name: model.body.data.name }),
    });
    expect(duplicateModel.response.status).toBe(409);
    const invalidRun = await request('/api/v1/training/runs', {
      method: 'POST', headers,
      body: JSON.stringify({
        run_uid: `invalid-${crypto.randomUUID()}`, model_id: model.body.data.id,
        dataset_snapshot_id: crypto.randomUUID(), task_type: 'sft',
        transformer: { name: 'chatml', version: '1.0' },
      }),
    });
    expect(invalidRun.response.status).toBe(409);
    expect(invalidRun.body.error.code).toBe('SNAPSHOT_NOT_READY');

    const run = await request('/api/v1/training/runs', {
      method: 'POST', headers,
      body: JSON.stringify({
        run_uid: `run-${crypto.randomUUID()}`, model_id: model.body.data.id,
        dataset_snapshot_id: snapshot.body.data.id, task_type: 'sft',
        transformer: { name: 'chatml', version: '1.0', configuration: { include_system: true } },
        parameters: { epochs: 2, learning_rate: 0.00002 },
        environment: { runtime: 'integration' }, code_revision: 'test-revision', seed: 42,
      }),
    });
    if (run.body.data?.id) {
      const runId = run.body.data.id;
      scope.defer(async () => {
        await db.delete(trainingMetrics).where(eq(trainingMetrics.runId, runId));
        await db.delete(trainingRuns).where(eq(trainingRuns.id, runId));
      });
    }
    expect(run.response.status).toBe(201);
    for (const [kind, id] of [['snapshot', snapshot.body.data.id], ['training_run', run.body.data.id]]) {
      const impact = await request(`/api/v1/memory/source-impact?kind=${kind}&source_id=${source.body.data.id}`, { headers });
      expect(impact.response.status).toBe(200);
      expect(impact.body.data).toContainEqual({ id });
    }

    expect(run.body.data.status).toBe('queued');
    expect(run.body.data.dataset_snapshot_id).toBe(snapshot.body.data.id);
    expect(run.body.data.model_snapshot.model_version).toBe('1.0');
    const updatedModel = await request(`/api/v1/training/models/${model.body.data.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ model_version: '2.0' }),
    });
    expect(updatedModel.response.status).toBe(200);
    expect(updatedModel.body.data.model_version).toBe('2.0');
    const queuedMetric = await request(`/api/v1/training/runs/${run.body.data.id}/metrics`, {
      method: 'POST', headers,
      body: JSON.stringify({ metric_name: 'loss', metric_value: 1.5, split: 'train', step: 1 }),
    });
    expect(queuedMetric.response.status).toBe(409);
    const running = await request(`/api/v1/training/runs/${run.body.data.id}/status`, {
      method: 'POST', headers, body: JSON.stringify({ status: 'running' }),
    });
    expect(running.response.status).toBe(200);
    expect(running.body.data.status).toBe('running');
    expect(running.body.data.started_at).not.toBeNull();
    const loss = await request(`/api/v1/training/runs/${run.body.data.id}/metrics`, {
      method: 'POST', headers,
      body: JSON.stringify({ metric_name: 'loss', metric_value: 0.42, split: 'train', step: 1, epoch: 0.5 }),
    });
    expect(loss.response.status).toBe(201);
    const duplicateMetric = await request(`/api/v1/training/runs/${run.body.data.id}/metrics`, {
      method: 'POST', headers,
      body: JSON.stringify({ metric_name: 'loss', metric_value: 0.41, split: 'train', step: 1 }),
    });
    expect(duplicateMetric.response.status).toBe(409);
    const completed = await request(`/api/v1/training/runs/${run.body.data.id}/status`, {
      method: 'POST', headers,
      body: JSON.stringify({ status: 'completed', output_object_key: 'training/integration/checkpoint' }),
    });
    expect(completed.response.status).toBe(200);
    expect(completed.body.data.status).toBe('completed');
    expect(completed.body.data.finished_at).not.toBeNull();
    const repeatedCompletion = await request(`/api/v1/training/runs/${run.body.data.id}/status`, {
      method: 'POST', headers, body: JSON.stringify({ status: 'completed' }),
    });
    expect(repeatedCompletion.response.status).toBe(409);
    const accuracy = await request(`/api/v1/training/runs/${run.body.data.id}/metrics`, {
      method: 'POST', headers,
      body: JSON.stringify({ metric_name: 'accuracy', metric_value: 0.91, split: 'validation', step: 2 }),
    });
    expect(accuracy.response.status).toBe(201);
    const runDetail = await request(`/api/v1/training/runs/${run.body.data.id}`, { headers });
    expect(runDetail.response.status).toBe(200);
    expect(runDetail.body.data.dataset_snapshot_id).toBe(snapshot.body.data.id);
    expect(runDetail.body.data.model_snapshot.model_version).toBe('1.0');
    expect(runDetail.body.data.transformer.version).toBe('1.0');
    expect(runDetail.body.data.metrics).toHaveLength(2);
  } finally {
    await scope.cleanup();
  }
}, 60_000);
