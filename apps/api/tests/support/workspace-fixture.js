import { expect } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import app from '../../src/app.js';
import { db } from '../../src/db/client.js';
import * as schema from '../../src/db/schema/index.js';
import { hashSecret } from '../../src/auth/secrets.js';
import { hashPassword } from '../../src/auth/passwords.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { deleteObject } from '../../src/services/background-jobs.js';
import { createIntegrationFixture } from './integration-fixture.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

export async function withWorkspaceFixture(run) {
  const scope = createIntegrationFixture();
  const tracked = new Map();
  let headers;
  function track(table, id, cleanup) {
    if (!id) return;
    if (!tracked.has(table)) tracked.set(table, new Set());
    if (tracked.get(table).has(id)) return;
    tracked.get(table).add(id);
    scope.defer(cleanup || (() => db.delete(table).where(eq(table.id, id))));
  }
  async function request(path, options = {}) {
    const response = await app.request(path, options);
    const body = await response.json();
    const data = body.data;
    if (data && options.method === 'POST' && response.ok) {
      const simple = {
        '/api/v1/sources': schema.sources,
        '/api/v1/records': schema.records,
        '/api/v1/auth/api-keys': schema.apiKeys,
        '/api/v1/memory/events': schema.memoryEvents,
        '/api/v1/memory/experiences': schema.memoryExperiences,
        '/api/v1/memory/entities': schema.memoryEntities,
        '/api/v1/memory/concepts': schema.memoryConcepts,
        '/api/v1/memory/relations': schema.memoryRelations,
      };
      if (path === '/api/v1/records') {
        track(schema.records, data.id, () => db.transaction(async (tx) => {
          for (const table of [schema.recordTags, schema.annotations, schema.evaluations, schema.recordReviews]) {
            await tx.delete(table).where(eq(table.recordId, data.id));
          }
          await tx.delete(schema.auditLogs).where(eq(schema.auditLogs.resourceId, data.id));
          await tx.update(schema.records).set({ currentVersionId: null }).where(eq(schema.records.id, data.id));
          await tx.delete(schema.recordVersions).where(eq(schema.recordVersions.recordId, data.id));
          await tx.delete(schema.records).where(eq(schema.records.id, data.id));
        }));
      } else if (path === '/api/v1/sources') {
        track(schema.sources, data.id, async () => {
          await db.delete(schema.auditLogs).where(eq(schema.auditLogs.resourceId, data.id));
          await db.delete(schema.sources).where(eq(schema.sources.id, data.id));
        });
      } else if (simple[path]) track(simple[path], data.id);
      if (/\/records\/[^/]+\/tags$/.test(path)) {
        // Record-tag links must be removed before the tags themselves.
        for (const tag of data) track(schema.tags, tag.id, async () => {
          const recordId = path.split('/')[4];
          const links = await db.select().from(schema.recordTags).where(eq(schema.recordTags.tagId, tag.id));
          for (const link of links.filter((entry) => entry.recordId === recordId)) await db.delete(schema.recordTags).where(and(eq(schema.recordTags.recordId, link.recordId), eq(schema.recordTags.tagId, link.tagId)));
          if (links.every((entry) => entry.recordId === recordId)) await db.delete(schema.tags).where(eq(schema.tags.id, tag.id));
        });
      }
      if (/\/entities\/[^/]+\/aliases$/.test(path)) track(schema.memoryEntityAliases, data.id);
      if (/\/relations\/[^/]+\/evidence$/.test(path)) track(schema.memoryRelationEvidence, data.evidence?.id);
      if (path.startsWith('/api/v1/memory/verification/')) track(schema.memoryVerificationDecisions, data.decision?.id);
      if (path === '/api/v1/memory/events/bulk') {
        track(schema.memoryEventIngestionBatches, data.batch_id);
        for (const event of data.events) track(schema.memoryEvents, event.id);
      }
      if (path === '/api/v1/memory/events/async') {
        track(schema.memoryEventIngestionJobs, data.id, async () => {
          let job;
          for (let attempt = 0; attempt < 250; attempt += 1) {
            [job] = await db.select().from(schema.memoryEventIngestionJobs).where(eq(schema.memoryEventIngestionJobs.id, data.id));
            if (!job || !['queued', 'processing'].includes(job.status)) break;
            if (attempt === 0) await app.request(`/api/v1/memory/event-jobs/${data.id}/cancel`, { method: 'POST', headers });
            await Bun.sleep(100);
          }
          if (!job) return;
          if (['queued', 'processing'].includes(job.status)) throw new Error('Memory Worker did not settle before cleanup');
          scope.defer(() => deleteObject(job.objectKey));
          await db.transaction(async (tx) => {
            if (job.ingestionBatchId) await tx.delete(schema.memoryEvents).where(eq(schema.memoryEvents.ingestionBatchId, job.ingestionBatchId));
            await tx.delete(schema.memoryEventIngestionJobs).where(eq(schema.memoryEventIngestionJobs.id, job.id));
            if (job.ingestionBatchId) await tx.delete(schema.memoryEventIngestionBatches).where(eq(schema.memoryEventIngestionBatches.id, job.ingestionBatchId));
          });
        });
      }
    }
    return { response, body };
  }
  async function roleHeaders(role) {
    const id = crypto.randomUUID();
    const email = `${role}-${id}@example.com`;
    scope.defer(() => db.delete(schema.users).where(eq(schema.users.id, id)));
    scope.defer(() => db.delete(schema.workspaceMemberships).where(eq(schema.workspaceMemberships.userId, id)));
    await db.insert(schema.users).values({ id, email, displayName: `Independent ${role}`, status: 'active', role, passwordHash: await hashPassword('fixture-password') });
    await db.insert(schema.workspaceMemberships).values({ workspaceId, userId: id, role });
    const token = await signAccessToken({ id, email, role, locale: 'ja' });
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }
  try {
    const login = await request('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    });
    if (login.body.data?.refresh_token) scope.defer(async () => db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, await hashSecret(login.body.data.refresh_token))));
    expect(login.response.status).toBe(200);
    headers = { Authorization: `Bearer ${login.body.data.access_token}`, 'Content-Type': 'application/json' };
    await run({ request, headers, login, roleHeaders, scope });
  } finally { await scope.cleanup(); }
}
