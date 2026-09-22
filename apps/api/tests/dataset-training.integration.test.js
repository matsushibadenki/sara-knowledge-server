import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import app from '../src/app.js';
import { db } from '../src/db/client.js';
import {
  auditLogs, datasetDefinitions, datasetSnapshotRecords, datasetSnapshots, recordVersions, records,
  refreshTokens, sources, trainingMetrics, trainingModels, trainingRuns,
} from '../src/db/schema/index.js';
import { hashSecret } from '../src/auth/secrets.js';
import { deleteObject } from '../src/services/background-jobs.js';
import { createIntegrationFixture } from './support/integration-fixture.js';

const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

async function request(path, options = {}) {
  const response = await app.request(path, options);
  return { response, body: await response.json() };
}

integrationTest('Snapshot membership and Training Run model version stay fixed after source edits', async () => {
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
    expect(manifestText).toContain(frozenMember.record_version_id);
    expect(manifestText).not.toContain(revised.body.data.current_version_id);

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
});
