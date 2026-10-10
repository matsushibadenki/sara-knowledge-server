import { expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { apiKeys, recordVersions } from '../src/db/schema/index.js';
import { withWorkspaceFixture } from './support/workspace-fixture.js';
const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

integrationTest('Record provenance, tags and audit remain consistent across deletion and restore', async () => {
  await withWorkspaceFixture(async ({ request, headers, login }) => {
    const createdApiKey = await request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Read-only integration key', scopes: ['records:read'] }),
    });
    expect(createdApiKey.response.status).toBe(201);
    const apiKeyHeaders = {
      Authorization: `Bearer ${createdApiKey.body.data.key}`,
      'Content-Type': 'application/json',
    };

    const sourceWriterKey = await request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Source writer integration key', scopes: ['sources:write'] }),
    });
    expect(sourceWriterKey.response.status).toBe(201);
    const sourceWriterHeaders = {
      Authorization: `Bearer ${sourceWriterKey.body.data.key}`,
      'Content-Type': 'application/json',
    };
    const apiKeySourceCreated = await request('/api/v1/sources', {
      method: 'POST',
      headers: sourceWriterHeaders,
      body: JSON.stringify({ source_type: 'generated', title: 'API key audit source' }),
    });
    expect(apiKeySourceCreated.response.status).toBe(201);
    const apiKeySourceId = apiKeySourceCreated.body.data.id;

    expect((await request('/api/v1/records', { headers: apiKeyHeaders })).response.status).toBe(200);
    const [usedApiKey] = await db.select({ lastUsedAt: apiKeys.lastUsedAt })
      .from(apiKeys)
      .where(eq(apiKeys.id, createdApiKey.body.data.id));
    expect(usedApiKey.lastUsedAt).not.toBeNull();

    await db.update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(apiKeys.id, createdApiKey.body.data.id));
    const expiredUse = await request('/api/v1/records', { headers: apiKeyHeaders });
    expect(expiredUse.response.status).toBe(401);
    await db.update(apiKeys)
      .set({ expiresAt: null })
      .where(eq(apiKeys.id, createdApiKey.body.data.id));

    const invalidQuery = await request('/api/v1/records?page=abc', { headers });
    expect(invalidQuery.response.status).toBe(400);
    const invalidId = await request('/api/v1/records/not-a-uuid', { headers });
    expect(invalidId.response.status).toBe(400);

    const sourceCreated = await request('/api/v1/sources', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source_type: 'website',
        title: 'Integration provenance source',
        url: 'https://example.com/integration-source',
        author: 'SARA integration test',
        retrieved_at: new Date().toISOString(),
        license_type: 'test-only',
        copyright_status: 'test-fixture',
        content_hash: `sha256:${crypto.randomUUID()}`,
        metadata: { test: true },
      }),
    });
    expect(sourceCreated.response.status).toBe(201);
    const sourceCreateRequestId = sourceCreated.response.headers.get('X-Request-ID');
    expect(sourceCreateRequestId).toMatch(/^[0-9a-f-]{36}$/);
    const sourceId = sourceCreated.body.data.id;

    const sourceSearch = await request('/api/v1/sources?q=Integration%20provenance', { headers });
    expect(sourceSearch.response.status).toBe(200);
    expect(sourceSearch.body.data.some((source) => source.id === sourceId)).toBe(true);

    const sourceUpdated = await request(`/api/v1/sources/${sourceId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ publisher: 'Updated integration publisher' }),
    });
    expect(sourceUpdated.response.status).toBe(200);

    const missingSourceRecord = await request('/api/v1/records', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        record_type: 'plain_text',
        source_id: crypto.randomUUID(),
        content: { text: 'must not be stored' },
      }),
    });
    expect(missingSourceRecord.response.status).toBe(404);
    expect(missingSourceRecord.body.error.code).toBe('SOURCE_NOT_FOUND');

    const created = await request('/api/v1/records', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        record_type: 'instruction',
        title: 'Integration concurrency check',
        language_code: 'en',
        source_id: sourceId,
        content: { instruction: 'ping', output: 'pong' },
      }),
    });
    expect(created.response.status).toBe(201);
    const recordId = created.body.data.id;
    expect(created.body.data.source.id).toBe(sourceId);

    const sourceUsage = await request(`/api/v1/sources/${sourceId}`, { headers });
    expect(sourceUsage.response.status).toBe(200);
    expect(sourceUsage.body.meta.active_record_count).toBe(1);

    const updates = await Promise.all([
      request(`/api/v1/records/${recordId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ expected_version: 1, title: 'Update A' }),
      }),
      request(`/api/v1/records/${recordId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ expected_version: 1, title: 'Update B' }),
      }),
    ]);
    expect(updates.map(({ response }) => response.status).sort()).toEqual([200, 409]);

    const versions = await request(`/api/v1/records/${recordId}/versions`, { headers });
    expect(versions.body.data.map((version) => version.version_number)).toEqual([2, 1]);
    expect(versions.body.data.filter((version) => version.is_current)).toHaveLength(1);

    const sourceDeleted = await request(`/api/v1/sources/${sourceId}`, {
      method: 'DELETE',
      headers,
    });
    expect(sourceDeleted.response.status).toBe(200);

    const recordWithDeletedSource = await request(`/api/v1/records/${recordId}`, { headers });
    expect(recordWithDeletedSource.response.status).toBe(200);
    expect(recordWithDeletedSource.body.data.source.id).toBe(sourceId);
    expect(recordWithDeletedSource.body.data.source.deleted_at).not.toBeNull();

    const updatedWithDeletedSource = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ expected_version: 2, title: 'Provenance remains available' }),
    });
    expect(updatedWithDeletedSource.response.status).toBe(200);
    expect(updatedWithDeletedSource.body.data.source.id).toBe(sourceId);
    expect(updatedWithDeletedSource.body.data.source.deleted_at).not.toBeNull();

    const deletedSourceLink = await request('/api/v1/records', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        record_type: 'plain_text',
        source_id: sourceId,
        content: { text: 'deleted source must be rejected' },
      }),
    });
    expect(deletedSourceLink.response.status).toBe(404);
    expect(deletedSourceLink.body.error.code).toBe('SOURCE_NOT_FOUND');

    const sourceRestored = await request(`/api/v1/sources/${sourceId}/restore`, {
      method: 'POST',
      headers,
    });
    expect(sourceRestored.response.status).toBe(200);
    expect(sourceRestored.body.data.deleted_at).toBeNull();

    const recordDeleted = await request(`/api/v1/records/${recordId}`, {
      method: 'DELETE',
      headers,
    });
    expect(recordDeleted.response.status).toBe(200);
    const recordRestored = await request(`/api/v1/records/${recordId}/restore`, {
      method: 'POST',
      headers,
    });
    expect(recordRestored.response.status).toBe(200);

    const tagSuffix = crypto.randomUUID();
    const assignedTags = await request(`/api/v1/records/${recordId}/tags`, {
      method: 'POST', headers,
      body: JSON.stringify({ tags: [`Important-${tagSuffix}`, ` important-${tagSuffix} `, `日本語-${tagSuffix}`] }),
    });
    expect(assignedTags.response.status).toBe(201);
    expect(assignedTags.body.data).toHaveLength(2);
    const listedTags = await request(`/api/v1/records/${recordId}/tags`, { headers });
    expect(listedTags.response.status).toBe(200);
    expect(listedTags.body.data.map((tag) => tag.normalized_name)).toContain(`important-${tagSuffix}`);

    const changed = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ expected_version: 3, content: { instruction: 'ping', output: 'PONG' } }),
    });
    expect(changed.response.status).toBe(200);

    const sourceAudits = await request(
      `/api/v1/audit-logs?resource_type=source&resource_id=${sourceId}&limit=20`,
      { headers },
    );
    expect(sourceAudits.response.status).toBe(200);
    expect(sourceAudits.body.data).toHaveLength(4);
    expect(new Set(sourceAudits.body.data.map((entry) => entry.action)))
      .toEqual(new Set(['create', 'update', 'delete', 'restore']));
    const sourceCreateAudit = sourceAudits.body.data.find((entry) => entry.action === 'create');
    expect(sourceCreateAudit.request_id).toBe(sourceCreateRequestId);
    expect(sourceCreateAudit.actor_type).toBe('user');
    expect(sourceCreateAudit.metadata.changed_fields).toContain('source_type');
    expect(sourceCreateAudit.after_data.license_text).toBeUndefined();

    const sourceAuditDetail = await request(`/api/v1/audit-logs/${sourceCreateAudit.id}`, { headers });
    expect(sourceAuditDetail.response.status).toBe(200);
    expect(sourceAuditDetail.body.data.resource_id).toBe(sourceId);

    const recordAudits = await request(
      `/api/v1/audit-logs?resource_type=record&resource_id=${recordId}&limit=20`,
      { headers },
    );
    expect(recordAudits.response.status).toBe(200);
    expect(recordAudits.body.data).toHaveLength(6);
    expect(new Set(recordAudits.body.data.map((entry) => entry.action)))
      .toEqual(new Set(['create', 'update', 'delete', 'restore']));
    expect(JSON.stringify(recordAudits.body.data)).not.toContain('pong');
    expect(recordAudits.body.data.some(
      (entry) => entry.metadata.version_fields_changed?.includes('content'),
    )).toBe(true);

    const apiKeySourceAudits = await request(
      `/api/v1/audit-logs?resource_type=source&resource_id=${apiKeySourceId}`,
      { headers },
    );
    expect(apiKeySourceAudits.response.status).toBe(200);
    expect(apiKeySourceAudits.body.data).toHaveLength(1);
    expect(apiKeySourceAudits.body.data[0].actor_type).toBe('api_key');
    expect(apiKeySourceAudits.body.data[0].actor_id).toBe(sourceWriterKey.body.data.id);
    expect(apiKeySourceAudits.body.data[0].metadata.actor_user_id).toBe(login.body.data.user.id);

    const unfilteredAudit = await request('/api/v1/audit-logs?limit=1', { headers });
    expect(unfilteredAudit.response.status).toBe(200);
    expect(unfilteredAudit.body.data).toHaveLength(1);
    expect(unfilteredAudit.body.meta.has_more).toBe(true);
    expect(unfilteredAudit.body.meta.next_cursor).not.toBeNull();
    const nextAuditPage = await request(
      `/api/v1/audit-logs?limit=1&cursor=${encodeURIComponent(unfilteredAudit.body.meta.next_cursor)}`,
      { headers },
    );
    expect(nextAuditPage.response.status).toBe(200);
    expect(nextAuditPage.body.data).toHaveLength(1);
    expect(nextAuditPage.body.data[0].id).not.toBe(unfilteredAudit.body.data[0].id);

    const invalidAuditRange = await request(
      '/api/v1/audit-logs?since=2026-08-31T10:00:00.000Z&until=2026-08-31T09:00:00.000Z',
      { headers },
    );
    expect(invalidAuditRange.response.status).toBe(400);

    const currentRows = await db.select({ id: recordVersions.id })
      .from(recordVersions)
      .where(and(eq(recordVersions.recordId, recordId), eq(recordVersions.isCurrent, true)));
    expect(currentRows).toHaveLength(1);

  });
}, 30_000);

