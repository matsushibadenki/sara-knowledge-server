import { afterAll, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import app from '../src/app.js';
import { closeDatabase, db } from '../src/db/client.js';
import { apiKeys, recordVersions, records, refreshTokens, users } from '../src/db/schema/index.js';
import { hashSecret } from '../src/auth/secrets.js';
import { hashPassword } from '../src/auth/passwords.js';
import { signAccessToken } from '../src/auth/tokens.js';
import {
  clearLoginAttempts,
  closeLoginRateLimiter,
  consumeLoginAttempt,
  getLoginRateLimitConfig,
} from '../src/auth/login-rate-limit.js';

const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;
const createdRecordIds = [];
const issuedRefreshTokens = [];
const createdApiKeyIds = [];
const createdUserIds = [];
const rateLimitedEmails = [];

async function request(path, options = {}) {
  const response = await app.request(path, options);
  return { response, body: await response.json() };
}

afterAll(async () => {
  if (process.env.RUN_INTEGRATION !== '1') return;

  for (const recordId of createdRecordIds) {
    await db.transaction(async (tx) => {
      await tx.update(records).set({ currentVersionId: null }).where(eq(records.id, recordId));
      await tx.delete(recordVersions).where(eq(recordVersions.recordId, recordId));
      await tx.delete(records).where(eq(records.id, recordId));
    });
  }

  if (issuedRefreshTokens.length > 0) {
    const tokenHashes = await Promise.all(issuedRefreshTokens.map(hashSecret));
    await db.delete(refreshTokens).where(inArray(refreshTokens.tokenHash, tokenHashes));
  }
  if (createdApiKeyIds.length > 0) {
    await db.delete(apiKeys).where(inArray(apiKeys.id, createdApiKeyIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  for (const email of rateLimitedEmails) await clearLoginAttempts(email);
  closeLoginRateLimiter();
  await closeDatabase();
});

integrationTest('validates API keys, record concurrency, and refresh rotation', async () => {
  const login = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  expect(login.response.status).toBe(200);
  const accessToken = login.body.data.access_token;
  issuedRefreshTokens.push(login.body.data.refresh_token);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const viewerId = crypto.randomUUID();
  const viewerEmail = `viewer-${viewerId}@example.com`;
  const viewerPassword = 'viewer-test-password';
  await db.insert(users).values({
    id: viewerId,
    email: viewerEmail,
    displayName: 'Integration Viewer',
    status: 'active',
    role: 'viewer',
    passwordHash: await hashPassword(viewerPassword),
  });
  createdUserIds.push(viewerId);

  await consumeLoginAttempt(viewerEmail);
  const viewerLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: viewerEmail, password: viewerPassword }),
  });
  expect(viewerLogin.response.status).toBe(200);
  issuedRefreshTokens.push(viewerLogin.body.data.refresh_token);
  const postSuccessAttempt = await consumeLoginAttempt(viewerEmail);
  expect(postSuccessAttempt.remainingAttempts).toBe(getLoginRateLimitConfig().maxAttempts - 1);
  await clearLoginAttempts(viewerEmail);

  const viewerToken = await signAccessToken({
    id: viewerId,
    email: viewerEmail,
    role: 'viewer',
    locale: 'en',
  });
  const viewerHeaders = {
    Authorization: `Bearer ${viewerToken}`,
    'Content-Type': 'application/json',
  };
  const viewerRead = await request('/api/v1/records', { headers: viewerHeaders });
  expect(viewerRead.response.status).toBe(200);
  const viewerWrite = await request('/api/v1/records', {
    method: 'POST',
    headers: viewerHeaders,
    body: JSON.stringify({ record_type: 'plain_text', content: { text: 'denied by role' } }),
  });
  expect(viewerWrite.response.status).toBe(403);
  expect(viewerWrite.body.error.code).toBe('INSUFFICIENT_ROLE');
  const viewerKeyManagement = await request('/api/v1/auth/api-keys', { headers: viewerHeaders });
  expect(viewerKeyManagement.response.status).toBe(403);

  const rateLimitEmail = `rate-limit-${crypto.randomUUID()}@example.com`;
  rateLimitedEmails.push(rateLimitEmail);
  const { maxAttempts } = getLoginRateLimitConfig();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const failedLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: rateLimitEmail, password: 'incorrect-password' }),
    });
    expect(failedLogin.response.status).toBe(401);
  }
  const limitedLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: rateLimitEmail, password: 'incorrect-password' }),
  });
  expect(limitedLogin.response.status).toBe(429);
  expect(limitedLogin.body.error.code).toBe('RATE_LIMITED');
  expect(Number(limitedLogin.response.headers.get('Retry-After'))).toBeGreaterThan(0);

  const invalidScope = await request('/api/v1/auth/api-keys', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Invalid scope', scopes: ['records:typo'] }),
  });
  expect(invalidScope.response.status).toBe(400);

  const createdApiKey = await request('/api/v1/auth/api-keys', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Read-only integration key', scopes: ['records:read'] }),
  });
  expect(createdApiKey.response.status).toBe(201);
  createdApiKeyIds.push(createdApiKey.body.data.id);
  const apiKeyHeaders = {
    Authorization: `Bearer ${createdApiKey.body.data.key}`,
    'Content-Type': 'application/json',
  };

  const apiKeyRead = await request('/api/v1/records', { headers: apiKeyHeaders });
  expect(apiKeyRead.response.status).toBe(200);
  const apiKeyWrite = await request('/api/v1/records', {
    method: 'POST',
    headers: apiKeyHeaders,
    body: JSON.stringify({ record_type: 'plain_text', content: { text: 'denied' } }),
  });
  expect(apiKeyWrite.response.status).toBe(403);
  expect(apiKeyWrite.body.error.code).toBe('INSUFFICIENT_SCOPE');

  const apiKeyManagement = await request('/api/v1/auth/api-keys', { headers: apiKeyHeaders });
  expect(apiKeyManagement.response.status).toBe(401);

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

  const created = await request('/api/v1/records', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      record_type: 'instruction',
      title: 'Integration concurrency check',
      language_code: 'en',
      content: { instruction: 'ping', output: 'pong' },
    }),
  });
  expect(created.response.status).toBe(201);
  const recordId = created.body.data.id;
  createdRecordIds.push(recordId);

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

  const refreshBody = JSON.stringify({ refresh_token: login.body.data.refresh_token });
  const rotations = await Promise.all([
    request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: refreshBody,
    }),
    request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: refreshBody,
    }),
  ]);
  expect(rotations.map(({ response }) => response.status).sort()).toEqual([200, 401]);
  const successfulRotation = rotations.find(({ response }) => response.status === 200);
  issuedRefreshTokens.push(successfulRotation.body.data.refresh_token);

  const currentRows = await db.select({ id: recordVersions.id })
    .from(recordVersions)
    .where(and(eq(recordVersions.recordId, recordId), eq(recordVersions.isCurrent, true)));
  expect(currentRows).toHaveLength(1);

  const revoked = await request(`/api/v1/auth/api-keys/${createdApiKey.body.data.id}`, {
    method: 'DELETE',
    headers,
  });
  expect(revoked.response.status).toBe(200);
  const revokedUse = await request('/api/v1/records', { headers: apiKeyHeaders });
  expect(revokedUse.response.status).toBe(401);
});
