import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import app from '../src/app.js';
import { db } from '../src/db/client.js';
import {
  assetBindings, assets, auditLogs, memoryEvents, recordVersions, records, refreshTokens, sources,
} from '../src/db/schema/index.js';
import { hashSecret } from '../src/auth/secrets.js';
import { deleteObject } from '../src/services/background-jobs.js';
import { createIntegrationFixture } from './support/integration-fixture.js';

const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

async function request(path, options = {}) {
  const response = await app.request(path, options);
  return { response, body: await response.json() };
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

integrationTest('Asset finalization verifies bytes and ignores late writes to the upload URL', async () => {
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

    const source = await request('/api/v1/sources', {
      method: 'POST', headers,
      body: JSON.stringify({ source_type: 'manual', title: 'Independent Asset source' }),
    });
    if (source.body.data?.id) {
      const sourceId = source.body.data.id;
      scope.defer(async () => {
        await db.delete(auditLogs).where(eq(auditLogs.resourceId, sourceId));
        await db.delete(sources).where(eq(sources.id, sourceId));
      });
    }
    expect(source.response.status).toBe(201);

    const record = await request('/api/v1/records', {
      method: 'POST', headers,
      body: JSON.stringify({
        record_type: 'plain_text', title: 'Independent Asset record', source_id: source.body.data.id,
        content: { text: 'Asset provenance' },
      }),
    });
    if (record.body.data?.id) {
      const recordId = record.body.data.id;
      scope.defer(async () => db.transaction(async (tx) => {
        await tx.delete(auditLogs).where(eq(auditLogs.resourceId, recordId));
        await tx.update(records).set({ currentVersionId: null }).where(eq(records.id, recordId));
        await tx.delete(recordVersions).where(eq(recordVersions.recordId, recordId));
        await tx.delete(records).where(eq(records.id, recordId));
      }));
    }
    expect(record.response.status).toBe(201);

    const event = await request('/api/v1/memory/events', {
      method: 'POST', headers,
      body: JSON.stringify({
        event_uid: `asset-event-${crypto.randomUUID()}`, source_id: source.body.data.id,
        modality: 'image', event_type: 'observation', proposal_source: 'human',
      }),
    });
    if (event.body.data?.id) {
      const eventId = event.body.data.id;
      scope.defer(() => db.delete(memoryEvents).where(eq(memoryEvents.id, eventId)));
    }
    expect(event.response.status).toBe(201);

    const bytes = new TextEncoder().encode('integration-image-bytes');
    const digest = await sha256(bytes);
    const bindings = [
      { target_type: 'source', target_id: source.body.data.id, role: 'origin' },
      { target_type: 'record', target_id: record.body.data.id, role: 'attachment' },
      { target_type: 'event', target_id: event.body.data.id, role: 'observation' },
    ];
    const invalidBinding = await request('/api/v1/assets/upload-url', {
      method: 'POST', headers,
      body: JSON.stringify({
        original_filename: 'invalid.png', mime_type: 'image/png', size_bytes: bytes.byteLength,
        sha256: digest, bindings: [{ target_type: 'event', target_id: crypto.randomUUID() }],
      }),
    });
    expect(invalidBinding.response.status).toBe(404);
    expect(invalidBinding.body.error.code).toBe('BINDING_TARGET_NOT_FOUND');

    async function reserve(filename, selectedBindings) {
      const result = await request('/api/v1/assets/upload-url', {
        method: 'POST', headers,
        body: JSON.stringify({
          original_filename: filename, mime_type: 'image/png', size_bytes: bytes.byteLength,
          sha256: digest, bindings: selectedBindings,
        }),
      });
      if (result.body.data?.id) {
        const assetId = result.body.data.id;
        scope.defer(async () => {
          const [stored] = await db.select({ final: assets.objectKey, staging: assets.stagingObjectKey })
            .from(assets).where(eq(assets.id, assetId));
          const failures = [];
          for (const key of [stored?.final, stored?.staging].filter(Boolean)) {
            try { await deleteObject(key); } catch (error) { failures.push(error); }
          }
          await db.delete(assetBindings).where(eq(assetBindings.assetId, assetId));
          await db.delete(assets).where(eq(assets.id, assetId));
          if (failures.length) throw new AggregateError(failures, `Asset ${assetId} object cleanup failed`);
        });
      }
      expect(result.response.status).toBe(201);
      return result.body;
    }

    const reserved = await reserve('observation.png', bindings);
    expect(reserved.data.status).toBe('pending');
    expect(reserved.data.bindings).toHaveLength(3);
    expect(reserved.meta.duplicate_asset_ids).toHaveLength(0);
    const [stored] = await db.select({ final: assets.objectKey, staging: assets.stagingObjectKey })
      .from(assets).where(eq(assets.id, reserved.data.id));
    expect(stored.staging).not.toBe(stored.final);

    expect((await fetch(reserved.data.upload_url, {
      method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes,
    })).ok).toBe(true);
    const completed = await request(`/api/v1/assets/${reserved.data.id}/complete`, {
      method: 'POST', headers, body: '{}',
    });
    expect(completed.response.status).toBe(200);
    expect(completed.body.data.status).toBe('ready');
    expect(completed.body.meta.replayed).toBe(false);
    const replay = await request(`/api/v1/assets/${reserved.data.id}/complete`, {
      method: 'POST', headers, body: '{}',
    });
    expect(replay.response.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    const detail = await request(`/api/v1/assets/${reserved.data.id}`, { headers });
    expect(detail.body.data.bindings.map((item) => item.target_type).sort()).toEqual(['event', 'record', 'source']);
    const download = await request(`/api/v1/assets/${reserved.data.id}/download-url`, { headers });
    expect(download.response.status).toBe(200);
    expect(new Uint8Array(await (await fetch(download.body.data.download_url)).arrayBuffer())).toEqual(bytes);
    expect((await fetch(reserved.data.upload_url, {
      method: 'PUT', headers: { 'Content-Type': 'image/png' },
      body: new TextEncoder().encode('tampered-after-completion'),
    })).ok).toBe(true);
    expect(new Uint8Array(await (await fetch(download.body.data.download_url)).arrayBuffer())).toEqual(bytes);

    const duplicate = await reserve('duplicate.png', [bindings[1]]);
    expect(duplicate.meta.duplicate_asset_ids).toContain(reserved.data.id);
    const mismatch = await reserve('mismatch.png', [
      { target_type: 'record', target_id: record.body.data.id, role: 'hash-test' },
    ]);
    const wrongBytes = new TextEncoder().encode('integration-image-byteX');
    expect(wrongBytes.byteLength).toBe(bytes.byteLength);
    expect((await fetch(mismatch.data.upload_url, { method: 'PUT', body: wrongBytes })).ok).toBe(true);
    const rejected = await request(`/api/v1/assets/${mismatch.data.id}/complete`, {
      method: 'POST', headers, body: '{}',
    });
    expect(rejected.response.status).toBe(422);
    expect(rejected.body.error.code).toBe('ASSET_HASH_MISMATCH');
    expect((await fetch(mismatch.data.upload_url, { method: 'PUT', body: bytes })).ok).toBe(true);
    const corrected = await request(`/api/v1/assets/${mismatch.data.id}/complete`, {
      method: 'POST', headers, body: '{}',
    });
    expect(corrected.response.status).toBe(200);
    expect(corrected.body.data.status).toBe('ready');

    expect((await request(`/api/v1/assets/${reserved.data.id}`, { method: 'DELETE', headers })).response.status).toBe(200);
    expect((await request(`/api/v1/assets/${reserved.data.id}`, { headers })).response.status).toBe(404);
  } finally {
    await scope.cleanup();
  }
});
