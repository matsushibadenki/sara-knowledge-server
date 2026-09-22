import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import app from '../src/app.js';
import { db } from '../src/db/client.js';
import {
  auditLogs, recordReviews, recordVersions, records, refreshTokens, sources, users, workspaceMemberships,
} from '../src/db/schema/index.js';
import { hashPassword } from '../src/auth/passwords.js';
import { hashSecret } from '../src/auth/secrets.js';
import { signAccessToken } from '../src/auth/tokens.js';
import { createIntegrationFixture } from './support/integration-fixture.js';

const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;
const workspaceId = '00000000-0000-4000-8000-000000000001';

async function request(path, options = {}) {
  const response = await app.request(path, options);
  return { response, body: await response.json() };
}

integrationTest('a separate reviewer approves a fixed version and later edits return to draft', async () => {
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
    const adminHeaders = {
      Authorization: `Bearer ${login.body.data.access_token}`, 'Content-Type': 'application/json',
    };

    const reviewerId = crypto.randomUUID();
    const reviewerEmail = `reviewer-${reviewerId}@example.com`;
    scope.defer(() => db.delete(users).where(eq(users.id, reviewerId)));
    scope.defer(() => db.delete(workspaceMemberships).where(eq(workspaceMemberships.userId, reviewerId)));
    await db.insert(users).values({
      id: reviewerId, email: reviewerEmail, displayName: 'Independent Reviewer',
      status: 'active', role: 'reviewer', passwordHash: await hashPassword('reviewer-test-password'),
    });
    await db.insert(workspaceMemberships).values({ workspaceId, userId: reviewerId, role: 'reviewer' });
    const reviewerToken = await signAccessToken({
      id: reviewerId, email: reviewerEmail, role: 'reviewer', locale: 'ja',
    });
    const reviewerHeaders = {
      Authorization: `Bearer ${reviewerToken}`, 'Content-Type': 'application/json',
    };

    const bypass = await request('/api/v1/records', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ record_type: 'plain_text', status: 'approved', content: { text: 'bypass' } }),
    });
    expect(bypass.response.status).toBe(422);
    expect(bypass.body.error.code).toBe('REVIEW_STATUS_REQUIRED');

    const source = await request('/api/v1/sources', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ source_type: 'manual', title: 'Independent review source' }),
    });
    if (source.body.data?.id) {
      const sourceId = source.body.data.id;
      scope.defer(async () => {
        await db.delete(auditLogs).where(eq(auditLogs.resourceId, sourceId));
        await db.delete(sources).where(eq(sources.id, sourceId));
      });
    }
    expect(source.response.status).toBe(201);

    const created = await request('/api/v1/records', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({
        record_type: 'plain_text', title: 'Independent review record', source_id: source.body.data.id,
        content: { text: 'Original statement' },
      }),
    });
    if (created.body.data?.id) {
      const recordId = created.body.data.id;
      scope.defer(async () => {
        await db.transaction(async (tx) => {
          await tx.delete(auditLogs).where(eq(auditLogs.resourceId, recordId));
          await tx.delete(recordReviews).where(eq(recordReviews.recordId, recordId));
          await tx.update(records).set({ currentVersionId: null }).where(eq(records.id, recordId));
          await tx.delete(recordVersions).where(eq(recordVersions.recordId, recordId));
          await tx.delete(records).where(eq(records.id, recordId));
        });
      });
    }
    expect(created.response.status).toBe(201);
    const recordId = created.body.data.id;
    expect(created.body.data.status).toBe('draft');

    const updates = await Promise.all([
      request(`/api/v1/records/${recordId}`, {
        method: 'PATCH', headers: adminHeaders,
        body: JSON.stringify({ expected_version: 1, title: 'Concurrent edit A' }),
      }),
      request(`/api/v1/records/${recordId}`, {
        method: 'PATCH', headers: adminHeaders,
        body: JSON.stringify({ expected_version: 1, title: 'Concurrent edit B' }),
      }),
    ]);
    expect(updates.map(({ response }) => response.status).sort()).toEqual([200, 409]);
    const versions = await request(`/api/v1/records/${recordId}/versions`, { headers: adminHeaders });
    expect(versions.body.data.map((version) => version.version_number)).toEqual([2, 1]);

    const submitted = await request(`/api/v1/records/${recordId}/submit-review`, {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ note: 'Ready' }),
    });
    expect(submitted.response.status).toBe(201);
    const pendingEdit = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH', headers: adminHeaders,
      body: JSON.stringify({ expected_version: 2, title: 'Not until review ends' }),
    });
    expect(pendingEdit.response.status).toBe(409);
    expect(pendingEdit.body.error.code).toBe('RECORD_PENDING_REVIEW');

    const reviewerEdit = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH', headers: reviewerHeaders,
      body: JSON.stringify({ expected_version: 2, title: 'Reviewer cannot edit' }),
    });
    expect(reviewerEdit.response.status).toBe(403);
    expect(reviewerEdit.body.error.code).toBe('INSUFFICIENT_ROLE');
    const decision = await request(`/api/v1/records/${recordId}/reviews/${submitted.body.data.id}/decision`, {
      method: 'POST', headers: reviewerHeaders,
      body: JSON.stringify({ decision: 'approved', note: 'Verified' }),
    });
    expect(decision.response.status).toBe(200);
    expect(decision.body.data.status).toBe('approved');

    const directApproval = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH', headers: adminHeaders,
      body: JSON.stringify({ expected_version: 2, status: 'approved', title: 'Bypass review' }),
    });
    expect(directApproval.response.status).toBe(422);
    expect(directApproval.body.error.code).toBe('REVIEW_STATUS_REQUIRED');
    const revised = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH', headers: adminHeaders,
      body: JSON.stringify({
        expected_version: 2, content: { text: 'Corrected statement' },
        change_summary: 'Correction after approval',
      }),
    });
    expect(revised.response.status).toBe(200);
    expect(revised.body.data.status).toBe('draft');
    expect(revised.body.data.current_version.version_number).toBe(3);
    expect(revised.body.data.current_version_id).not.toBe(submitted.body.data.record_version_id);
    const history = await request(`/api/v1/records/${recordId}/reviews`, { headers: reviewerHeaders });
    expect(history.response.status).toBe(200);
    expect(history.body.data[0].reviewed_by).toBe(reviewerId);
    expect(history.body.data[0].record_version_id).toBe(submitted.body.data.record_version_id);
  } finally {
    await scope.cleanup();
  }
});
