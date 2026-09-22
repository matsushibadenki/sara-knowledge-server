import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import app from '../src/app.js';
import { db } from '../src/db/client.js';
import { apiKeys, refreshTokens, users, workspaceMemberships } from '../src/db/schema/index.js';
import { hashPassword } from '../src/auth/passwords.js';
import { hashSecret } from '../src/auth/secrets.js';
import { signAccessToken } from '../src/auth/tokens.js';
import {
  clearLoginAttempts, getLoginRateLimitConfig,
} from '../src/auth/login-rate-limit.js';
import { createIntegrationFixture } from './support/integration-fixture.js';

const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;
const workspaceId = '00000000-0000-4000-8000-000000000001';

async function request(path, options = {}) {
  const response = await app.request(path, options);
  return { response, body: await response.json() };
}

function authFixture() {
  const scope = createIntegrationFixture();
  return {
    cleanup: () => scope.cleanup(),
    trackUser(id) {
      // Register before insertion; cleanup still runs if insertion partially succeeds.
      scope.defer(() => db.delete(users).where(eq(users.id, id)));
      scope.defer(() => db.delete(workspaceMemberships).where(eq(workspaceMemberships.userId, id)));
    },
    trackApiKey(id) { scope.defer(() => db.delete(apiKeys).where(eq(apiKeys.id, id))); },
    trackRefreshToken(token) {
      scope.defer(async () => db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, await hashSecret(token))));
    },
    trackRateLimitEmail(email) { scope.defer(() => clearLoginAttempts(email)); },
  };
}

integrationTest('workspace membership and role restrictions are enforced independently', async () => {
  const scope = authFixture();
  try {
    const viewerId = crypto.randomUUID();
    scope.trackUser(viewerId);
    const viewerEmail = `viewer-${viewerId}@example.com`;
    await db.insert(users).values({
      id: viewerId, email: viewerEmail, displayName: 'Independent Viewer', status: 'active',
      role: 'viewer', passwordHash: await hashPassword('viewer-test-password'),
    });
    await db.insert(workspaceMemberships).values({ workspaceId, userId: viewerId, role: 'viewer' });
    const viewerToken = await signAccessToken({ id: viewerId, email: viewerEmail, role: 'viewer', locale: 'en' });
    const viewerHeaders = { Authorization: `Bearer ${viewerToken}`, 'Content-Type': 'application/json' };

    const outsiderId = crypto.randomUUID();
    scope.trackUser(outsiderId);
    const outsiderEmail = `outsider-${outsiderId}@example.com`;
    await db.insert(users).values({
      id: outsiderId, email: outsiderEmail, displayName: 'Independent Outsider', status: 'active',
      role: 'viewer', passwordHash: await hashPassword('outsider-test-password'),
    });
    const outsiderToken = await signAccessToken({ id: outsiderId, email: outsiderEmail, role: 'viewer', locale: 'en' });

    const outsiderKeyId = crypto.randomUUID();
    const outsiderKey = `sara_${crypto.randomUUID().replaceAll('-', '')}`;
    scope.trackApiKey(outsiderKeyId);
    await db.insert(apiKeys).values({
      id: outsiderKeyId, userId: outsiderId, name: 'Independent outsider key',
      keyPrefix: outsiderKey.slice(0, 17), keyHash: await hashSecret(outsiderKey), scopes: ['records:read'],
    });

    const viewerRead = await request('/api/v1/records', { headers: viewerHeaders });
    expect(viewerRead.response.status).toBe(200);
    expect((await request('/api/v1/sources', { headers: viewerHeaders })).response.status).toBe(200);
    const viewerAudit = await request('/api/v1/audit-logs', { headers: viewerHeaders });
    expect(viewerAudit.response.status).toBe(403);
    expect(viewerAudit.body.error.code).toBe('INSUFFICIENT_ROLE');
    expect((await request('/api/v1/review-queue', { headers: viewerHeaders })).response.status).toBe(403);
    const viewerWrite = await request('/api/v1/records', {
      method: 'POST', headers: viewerHeaders, body: JSON.stringify({ title: 'Forbidden' }),
    });
    expect(viewerWrite.response.status).toBe(403);
    expect(viewerWrite.body.error.code).toBe('INSUFFICIENT_ROLE');
    const viewerSourceWrite = await request('/api/v1/sources', {
      method: 'POST', headers: viewerHeaders, body: JSON.stringify({ source_type: 'manual', title: 'Forbidden' }),
    });
    expect(viewerSourceWrite.response.status).toBe(403);
    expect(viewerSourceWrite.body.error.code).toBe('INSUFFICIENT_ROLE');
    expect((await request('/api/v1/auth/api-keys', { headers: viewerHeaders })).response.status).toBe(403);
    const outsiderRead = await request('/api/v1/records', { headers: { Authorization: `Bearer ${outsiderToken}` } });
    expect(outsiderRead.response.status).toBe(403);
    expect(outsiderRead.body.error.code).toBe('WORKSPACE_ACCESS_REQUIRED');
    const outsiderKeyRead = await request('/api/v1/records', { headers: { Authorization: `Bearer ${outsiderKey}` } });
    expect(outsiderKeyRead.response.status).toBe(403);
    expect(outsiderKeyRead.body.error.code).toBe('WORKSPACE_ACCESS_REQUIRED');
  } finally {
    await scope.cleanup();
  }
});

integrationTest('API key scope and workspace membership are enforced independently', async () => {
  const scope = authFixture();
  try {
    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    });
    expect(adminLogin.response.status).toBe(200);
    scope.trackRefreshToken(adminLogin.body.data.refresh_token);
    const adminHeaders = { Authorization: `Bearer ${adminLogin.body.data.access_token}`, 'Content-Type': 'application/json' };
    const invalidScope = await request('/api/v1/auth/api-keys', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ name: 'Invalid scope', scopes: ['records:typo'] }),
    });
    expect(invalidScope.response.status).toBe(400);
    const created = await request('/api/v1/auth/api-keys', {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ name: 'Independent read-only key', scopes: ['records:read'] }),
    });
    if (created.body.data?.id) scope.trackApiKey(created.body.data.id);
    expect(created.response.status).toBe(201);
    const keyHeaders = { Authorization: `Bearer ${created.body.data.key}`, 'Content-Type': 'application/json' };
    expect((await request('/api/v1/records', { headers: keyHeaders })).response.status).toBe(200);
    const denied = await request('/api/v1/records', {
      method: 'POST', headers: keyHeaders, body: JSON.stringify({ title: 'Forbidden' }),
    });
    expect(denied.response.status).toBe(403);
    expect(denied.body.error.code).toBe('INSUFFICIENT_SCOPE');
    const forbiddenPaths = ['/api/v1/sources', '/api/v1/imports', '/api/v1/datasets', '/api/v1/training/models', '/api/v1/memory/events'];
    for (const path of forbiddenPaths) expect((await request(path, { headers: keyHeaders })).response.status).toBe(403);
    expect((await request('/api/v1/audit-logs', { headers: keyHeaders })).response.status).toBe(401);
    expect((await request('/api/v1/auth/api-keys', { headers: keyHeaders })).response.status).toBe(401);
    const revoked = await request(`/api/v1/auth/api-keys/${created.body.data.id}`, {
      method: 'DELETE', headers: adminHeaders,
    });
    expect(revoked.response.status).toBe(200);
    expect((await request('/api/v1/records', { headers: keyHeaders })).response.status).toBe(401);
  } finally {
    await scope.cleanup();
  }
});

integrationTest('only one concurrent refresh can rotate a token', async () => {
  const scope = authFixture();
  try {
    const login = await request('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    });
    expect(login.response.status).toBe(200);
    scope.trackRefreshToken(login.body.data.refresh_token);
    const options = {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: login.body.data.refresh_token }),
    };
    const rotations = await Promise.all([
      request('/api/v1/auth/refresh', options),
      request('/api/v1/auth/refresh', options),
    ]);
    for (const result of rotations) {
      if (result.body.data?.refresh_token) scope.trackRefreshToken(result.body.data.refresh_token);
    }
    expect(rotations.map(({ response }) => response.status).sort()).toEqual([200, 401]);
    const replay = await request('/api/v1/auth/refresh', options);
    expect(replay.response.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  } finally {
    await scope.cleanup();
  }
});

integrationTest('login rate limiting clears its own Redis state after failure', async () => {
  const scope = authFixture();
  const email = `rate-limit-${crypto.randomUUID()}@example.com`;
  scope.trackRateLimitEmail(email);
  try {
    const { maxAttempts } = getLoginRateLimitConfig();
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const rejected = await request('/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-password' }),
      });
      expect(rejected.response.status).toBe(401);
    }
    const blocked = await request('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password' }),
    });
    expect(blocked.response.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.response.headers.get('Retry-After'))).toBeGreaterThan(0);
  } finally {
    await scope.cleanup();
  }
});
