import { afterAll, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import app from '../src/app.js';
import { closeDatabase, db } from '../src/db/client.js';
import {
  apiKeys,
  annotations,
  auditLogs,
  datasetDefinitions,
  datasetSnapshotRecords,
  datasetSnapshots,
  evaluations,
  exportJobs,
  importItems,
  importJobs,
  memoryConcepts,
  memoryEntities,
  memoryEntityAliases,
  memoryEventIngestionBatches,
  memoryEvents,
  memoryExperiences,
  memoryRelationEvidence,
  memoryRelations,
  memoryVerificationDecisions,
  recordReviews,
  recordTags,
  recordVersions,
  records,
  refreshTokens,
  sources,
  tags,
  trainingMetrics,
  trainingModels,
  trainingRuns,
  users,
} from '../src/db/schema/index.js';
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
const createdSourceIds = [];
const issuedRefreshTokens = [];
const createdApiKeyIds = [];
const createdUserIds = [];
const createdTagIds = [];
const createdImportJobIds = [];
const createdExportJobIds = [];
const createdObjectKeys = [];
const createdDatasetDefinitionIds = [];
const createdDatasetSnapshotIds = [];
const createdTrainingModelIds = [];
const createdTrainingRunIds = [];
const createdMemoryConceptIds = [];
const createdMemoryEntityIds = [];
const createdMemoryEventIds = [];
const createdMemoryBatchIds = [];
const createdMemoryExperienceIds = [];
const createdMemoryRelationIds = [];
const createdMemoryAliasIds = [];
const createdMemoryEvidenceIds = [];
const createdMemoryDecisionIds = [];
const rateLimitedEmails = [];

async function request(path, options = {}) {
  const response = await app.request(path, options);
  return { response, body: await response.json() };
}

async function signedHeaders({ apiKey, path, body, nonce = crypto.randomUUID(), timestamp = Math.floor(Date.now() / 1000), idempotencyKey }) {
  const encoder = new TextEncoder();
  const bodyHashBytes = await crypto.subtle.digest('SHA-256', encoder.encode(body));
  const bodyHash = Array.from(new Uint8Array(bodyHashBytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const canonical = ['POST', path, String(timestamp), nonce, idempotencyKey, bodyHash].join('\n');
  const key = await crypto.subtle.importKey('raw', encoder.encode(apiKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(canonical));
  const signature = Array.from(new Uint8Array(signatureBytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-SARA-Timestamp': String(timestamp),
    'X-SARA-Nonce': nonce,
    'X-SARA-Idempotency-Key': idempotencyKey,
    'X-SARA-Signature': `sha256=${signature}`,
  };
}

afterAll(async () => {
  if (process.env.RUN_INTEGRATION !== '1') return;

  const auditedResourceIds = [...createdRecordIds, ...createdSourceIds];
  if (auditedResourceIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.resourceId, auditedResourceIds));
  }

  if (createdImportJobIds.length > 0) {
    await db.delete(importItems).where(inArray(importItems.importJobId, createdImportJobIds));
    await db.delete(importJobs).where(inArray(importJobs.id, createdImportJobIds));
  }
  if (createdExportJobIds.length > 0) {
    await db.delete(exportJobs).where(inArray(exportJobs.id, createdExportJobIds));
  }
  if (createdMemoryRelationIds.length > 0) {
    if (createdMemoryEvidenceIds.length > 0) {
      await db.delete(memoryRelationEvidence).where(inArray(memoryRelationEvidence.id, createdMemoryEvidenceIds));
    }
    await db.delete(memoryRelations).where(inArray(memoryRelations.id, createdMemoryRelationIds));
  }
  if (createdMemoryDecisionIds.length > 0) {
    await db.delete(memoryVerificationDecisions).where(inArray(memoryVerificationDecisions.id, createdMemoryDecisionIds));
  }
  if (createdMemoryEventIds.length > 0) {
    await db.delete(memoryEvents).where(inArray(memoryEvents.id, createdMemoryEventIds));
  }
  if (createdMemoryBatchIds.length > 0) {
    await db.delete(memoryEventIngestionBatches).where(inArray(memoryEventIngestionBatches.id, createdMemoryBatchIds));
  }
  if (createdMemoryConceptIds.length > 0) {
    await db.delete(memoryConcepts).where(inArray(memoryConcepts.id, createdMemoryConceptIds));
  }
  if (createdMemoryEntityIds.length > 0) {
    if (createdMemoryAliasIds.length > 0) {
      await db.delete(memoryEntityAliases).where(inArray(memoryEntityAliases.id, createdMemoryAliasIds));
    }
    await db.delete(memoryEntities).where(inArray(memoryEntities.id, createdMemoryEntityIds));
  }
  if (createdMemoryExperienceIds.length > 0) {
    await db.delete(memoryExperiences).where(inArray(memoryExperiences.id, createdMemoryExperienceIds));
  }
  if (createdTrainingRunIds.length > 0) {
    await db.delete(trainingMetrics).where(inArray(trainingMetrics.runId, createdTrainingRunIds));
    await db.delete(trainingRuns).where(inArray(trainingRuns.id, createdTrainingRunIds));
  }
  if (createdTrainingModelIds.length > 0) {
    await db.delete(trainingModels).where(inArray(trainingModels.id, createdTrainingModelIds));
  }
  if (createdDatasetSnapshotIds.length > 0) {
    await db.delete(datasetSnapshotRecords).where(inArray(datasetSnapshotRecords.snapshotId, createdDatasetSnapshotIds));
    await db.delete(datasetSnapshots).where(inArray(datasetSnapshots.id, createdDatasetSnapshotIds));
  }
  if (createdDatasetDefinitionIds.length > 0) {
    await db.delete(datasetDefinitions).where(inArray(datasetDefinitions.id, createdDatasetDefinitionIds));
  }
  if (createdObjectKeys.length > 0) {
    const objectStore = new Bun.S3Client({
      endpoint: `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`,
      accessKeyId: process.env.MINIO_ACCESS_KEY,
      secretAccessKey: process.env.MINIO_SECRET_KEY,
      bucket: process.env.MINIO_BUCKET,
      region: 'us-east-1',
    });
    for (const key of createdObjectKeys) await objectStore.delete(key).catch(() => {});
  }

  for (const recordId of createdRecordIds) {
    await db.transaction(async (tx) => {
      await tx.delete(recordTags).where(eq(recordTags.recordId, recordId));
      await tx.delete(annotations).where(eq(annotations.recordId, recordId));
      await tx.delete(evaluations).where(eq(evaluations.recordId, recordId));
      await tx.delete(recordReviews).where(eq(recordReviews.recordId, recordId));
      await tx.update(records).set({ currentVersionId: null }).where(eq(records.id, recordId));
      await tx.delete(recordVersions).where(eq(recordVersions.recordId, recordId));
      await tx.delete(records).where(eq(records.id, recordId));
    });
  }
  if (createdTagIds.length > 0) await db.delete(tags).where(inArray(tags.id, createdTagIds));
  if (createdSourceIds.length > 0) {
    await db.delete(sources).where(inArray(sources.id, createdSourceIds));
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

integrationTest('validates auth, provenance, review, audit, import/export, datasets, training, memory, concurrency, and refresh rotation', async () => {
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
  const viewerSourceRead = await request('/api/v1/sources', { headers: viewerHeaders });
  expect(viewerSourceRead.response.status).toBe(200);
  const viewerAuditRead = await request('/api/v1/audit-logs', { headers: viewerHeaders });
  expect(viewerAuditRead.response.status).toBe(403);
  expect(viewerAuditRead.body.error.code).toBe('INSUFFICIENT_ROLE');
  const viewerReviewQueue = await request('/api/v1/review-queue', { headers: viewerHeaders });
  expect(viewerReviewQueue.response.status).toBe(403);
  const viewerWrite = await request('/api/v1/records', {
    method: 'POST',
    headers: viewerHeaders,
    body: JSON.stringify({ record_type: 'plain_text', content: { text: 'denied by role' } }),
  });
  expect(viewerWrite.response.status).toBe(403);
  expect(viewerWrite.body.error.code).toBe('INSUFFICIENT_ROLE');
  const viewerSourceWrite = await request('/api/v1/sources', {
    method: 'POST',
    headers: viewerHeaders,
    body: JSON.stringify({ source_type: 'manual', title: 'denied by role' }),
  });
  expect(viewerSourceWrite.response.status).toBe(403);
  expect(viewerSourceWrite.body.error.code).toBe('INSUFFICIENT_ROLE');
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
  const apiKeySourceRead = await request('/api/v1/sources', { headers: apiKeyHeaders });
  expect(apiKeySourceRead.response.status).toBe(403);
  expect(apiKeySourceRead.body.error.code).toBe('INSUFFICIENT_SCOPE');
  const apiKeyAuditRead = await request('/api/v1/audit-logs', { headers: apiKeyHeaders });
  expect(apiKeyAuditRead.response.status).toBe(401);
  const apiKeyImport = await request('/api/v1/imports', {
    method: 'POST', headers: apiKeyHeaders,
    body: JSON.stringify({ format: 'json', content: '[]', idempotency_key: `denied-${crypto.randomUUID()}` }),
  });
  expect(apiKeyImport.response.status).toBe(403);
  const apiKeyDataset = await request('/api/v1/datasets', { headers: apiKeyHeaders });
  expect(apiKeyDataset.response.status).toBe(403);
  const apiKeyTraining = await request('/api/v1/training/models', { headers: apiKeyHeaders });
  expect(apiKeyTraining.response.status).toBe(403);
  const apiKeyMemory = await request('/api/v1/memory/events', { headers: apiKeyHeaders });
  expect(apiKeyMemory.response.status).toBe(403);

  const sourceWriterKey = await request('/api/v1/auth/api-keys', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Source writer integration key', scopes: ['sources:write'] }),
  });
  expect(sourceWriterKey.response.status).toBe(201);
  createdApiKeyIds.push(sourceWriterKey.body.data.id);
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
  createdSourceIds.push(apiKeySourceId);

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
  createdSourceIds.push(sourceId);

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
  createdRecordIds.push(recordId);
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

  const assignedTags = await request(`/api/v1/records/${recordId}/tags`, {
    method: 'POST', headers,
    body: JSON.stringify({ tags: ['Important', ' important ', '日本語'] }),
  });
  expect(assignedTags.response.status).toBe(201);
  expect(assignedTags.body.data).toHaveLength(2);
  createdTagIds.push(...assignedTags.body.data.map((tag) => tag.id));
  const listedTags = await request(`/api/v1/records/${recordId}/tags`, { headers });
  expect(listedTags.response.status).toBe(200);
  expect(listedTags.body.data.map((tag) => tag.normalized_name)).toContain('important');

  const annotation = await request(`/api/v1/records/${recordId}/annotations`, {
    method: 'POST', headers,
    body: JSON.stringify({ annotation_type: 'correction', payload: { field: 'output', suggestion: 'PONG' } }),
  });
  expect(annotation.response.status).toBe(201);
  expect(annotation.body.data.record_version_id).toBe(recordRestored.body.data.current_version_id);
  const resolvedAnnotation = await request(
    `/api/v1/records/${recordId}/annotations/${annotation.body.data.id}/resolve`,
    { method: 'POST', headers },
  );
  expect(resolvedAnnotation.response.status).toBe(200);
  expect(resolvedAnnotation.body.data.status).toBe('resolved');

  const invalidEvaluation = await request(`/api/v1/records/${recordId}/evaluations`, {
    method: 'POST', headers,
    body: JSON.stringify({ metric: 'correctness', score: 1.1, verdict: 'pass' }),
  });
  expect(invalidEvaluation.response.status).toBe(400);
  const evaluation = await request(`/api/v1/records/${recordId}/evaluations`, {
    method: 'POST', headers,
    body: JSON.stringify({ metric: 'correctness', score: 0.95, verdict: 'pass', notes: 'Verified fixture' }),
  });
  expect(evaluation.response.status).toBe(201);
  expect(evaluation.body.data.score).toBe(0.95);

  const submittedReview = await request(`/api/v1/records/${recordId}/submit-review`, {
    method: 'POST', headers, body: JSON.stringify({ note: 'Ready for review' }),
  });
  expect(submittedReview.response.status).toBe(201);
  const duplicateReview = await request(`/api/v1/records/${recordId}/submit-review`, {
    method: 'POST', headers, body: '{}',
  });
  expect(duplicateReview.response.status).toBe(409);
  const blockedUpdate = await request(`/api/v1/records/${recordId}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ expected_version: 3, title: 'Must wait for review' }),
  });
  expect(blockedUpdate.response.status).toBe(409);
  expect(blockedUpdate.body.error.code).toBe('RECORD_PENDING_REVIEW');
  const blockedDelete = await request(`/api/v1/records/${recordId}`, { method: 'DELETE', headers });
  expect(blockedDelete.response.status).toBe(409);
  expect(blockedDelete.body.error.code).toBe('RECORD_PENDING_REVIEW');
  const reviewQueue = await request('/api/v1/review-queue', { headers });
  expect(reviewQueue.response.status).toBe(200);
  expect(reviewQueue.body.data.some((review) => review.id === submittedReview.body.data.id)).toBe(true);
  const approvedReview = await request(
    `/api/v1/records/${recordId}/reviews/${submittedReview.body.data.id}/decision`,
    { method: 'POST', headers, body: JSON.stringify({ decision: 'approved', note: 'Accepted' }) },
  );
  expect(approvedReview.response.status).toBe(200);
  expect(approvedReview.body.data.status).toBe('approved');
  const reviewHistory = await request(`/api/v1/records/${recordId}/reviews`, { headers });
  expect(reviewHistory.response.status).toBe(200);
  expect(reviewHistory.body.data[0].reviewed_by).toBe(login.body.data.user.id);
  const reviewAuditFilter = await request('/api/v1/audit-logs?action=submit_review&limit=20', { headers });
  expect(reviewAuditFilter.response.status).toBe(200);
  expect(reviewAuditFilter.body.data.some((entry) => entry.resource_id === recordId)).toBe(true);

  const importLanguage = `it-${crypto.randomUUID().slice(0, 8)}`;
  const jsonlContent = [
    JSON.stringify({ instruction: 'Say hello', output: 'Hello', title: 'Imported instruction' }),
    JSON.stringify({ record_type: 'unsupported_type', content: { invalid: true } }),
    JSON.stringify({ record_type: 'plain_text', title: 'Imported plain text', text: 'Knowledge survives models.' }),
  ].join('\n');
  const importKey = `integration-${crypto.randomUUID()}`;
  const importedJsonl = await request('/api/v1/imports', {
    method: 'POST', headers,
    body: JSON.stringify({
      format: 'jsonl', content: jsonlContent, idempotency_key: importKey,
      file_name: 'integration.jsonl', defaults: { language_code: importLanguage },
    }),
  });
  expect(importedJsonl.response.status).toBe(201);
  expect(importedJsonl.body.data.status).toBe('completed_with_errors');
  expect(importedJsonl.body.data.succeeded_count).toBe(2);
  expect(importedJsonl.body.data.failed_count).toBe(1);
  expect(importedJsonl.body.data.raw_content).toBeUndefined();
  createdImportJobIds.push(importedJsonl.body.data.id);
  createdSourceIds.push(importedJsonl.body.data.source_id);

  const replayedImport = await request('/api/v1/imports', {
    method: 'POST', headers,
    body: JSON.stringify({ format: 'jsonl', content: jsonlContent, idempotency_key: importKey }),
  });
  expect(replayedImport.response.status).toBe(200);
  expect(replayedImport.body.meta.replayed).toBe(true);
  expect(replayedImport.body.data.id).toBe(importedJsonl.body.data.id);
  const conflictingReplay = await request('/api/v1/imports', {
    method: 'POST', headers,
    body: JSON.stringify({ format: 'jsonl', content: '{}', idempotency_key: importKey }),
  });
  expect(conflictingReplay.response.status).toBe(409);
  expect(conflictingReplay.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

  const jsonlDetail = await request(`/api/v1/imports/${importedJsonl.body.data.id}`, { headers });
  expect(jsonlDetail.response.status).toBe(200);
  expect(jsonlDetail.body.data.items).toHaveLength(3);
  expect(jsonlDetail.body.data.items.filter((item) => item.status === 'failed')).toHaveLength(1);
  createdRecordIds.push(...jsonlDetail.body.data.items.map((item) => item.record_id).filter(Boolean));

  const importedJson = await request('/api/v1/imports', {
    method: 'POST', headers,
    body: JSON.stringify({
      format: 'json',
      content: JSON.stringify([{ record_type: 'qa', title: 'JSON import', content: { question: 'Q', answer: 'A' } }]),
      idempotency_key: `json-${crypto.randomUUID()}`,
      defaults: { language_code: importLanguage },
    }),
  });
  expect(importedJson.response.status).toBe(201);
  expect(importedJson.body.data.succeeded_count).toBe(1);
  createdImportJobIds.push(importedJson.body.data.id);
  createdSourceIds.push(importedJson.body.data.source_id);
  const jsonDetail = await request(`/api/v1/imports/${importedJson.body.data.id}`, { headers });
  createdRecordIds.push(...jsonDetail.body.data.items.map((item) => item.record_id).filter(Boolean));

  const importedCsv = await request('/api/v1/imports', {
    method: 'POST', headers,
    body: JSON.stringify({
      format: 'csv',
      content: `record_type,title,language_code,text\nplain_text,"CSV, title",${importLanguage},hello`,
      idempotency_key: `csv-${crypto.randomUUID()}`,
    }),
  });
  expect(importedCsv.response.status).toBe(201);
  expect(importedCsv.body.data.succeeded_count).toBe(1);
  createdImportJobIds.push(importedCsv.body.data.id);
  createdSourceIds.push(importedCsv.body.data.source_id);
  const csvDetail = await request(`/api/v1/imports/${importedCsv.body.data.id}`, { headers });
  createdRecordIds.push(...csvDetail.body.data.items.map((item) => item.record_id).filter(Boolean));

  const malformedImport = await request('/api/v1/imports', {
    method: 'POST', headers,
    body: JSON.stringify({ format: 'json', content: '{broken', idempotency_key: `broken-${crypto.randomUUID()}` }),
  });
  expect(malformedImport.response.status).toBe(422);
  expect(malformedImport.body.data.status).toBe('failed');
  expect(typeof malformedImport.body.meta.parse_error).toBe('string');
  createdImportJobIds.push(malformedImport.body.data.id);
  createdSourceIds.push(malformedImport.body.data.source_id);

  for (const format of ['json', 'jsonl', 'csv']) {
    const response = await app.request('/api/v1/exports', {
      method: 'POST', headers,
      body: JSON.stringify({ format, language_code: importLanguage }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain(`.${format}`);
    expect(response.headers.get('X-Content-SHA256')).toStartWith('sha256:');
    const exportId = response.headers.get('X-Export-ID');
    createdExportJobIds.push(exportId);
    const content = await response.text();
    expect(content).toContain('Imported instruction');
    const exportDetail = await request(`/api/v1/exports/${exportId}`, { headers });
    expect(exportDetail.response.status).toBe(200);
    expect(exportDetail.body.data.record_count).toBe(4);
  }

  const asyncLanguage = `async-${crypto.randomUUID().slice(0, 8)}`;
  const asyncImport = await request('/api/v1/imports/async', {
    method: 'POST', headers,
    body: JSON.stringify({
      format: 'jsonl',
      content: [1, 2, 3].map((number) => JSON.stringify({
        record_type: 'plain_text', title: `Async imported ${number}`, text: `async-${number}`,
      })).join('\n'),
      idempotency_key: `async-import-${crypto.randomUUID()}`,
      file_name: 'async-integration.jsonl',
      defaults: { language_code: asyncLanguage },
    }),
  });
  expect(asyncImport.response.status).toBe(202);
  expect(asyncImport.body.data.mode).toBe('async');
  expect(asyncImport.body.data.status).toBe('queued');
  createdImportJobIds.push(asyncImport.body.data.id);
  createdSourceIds.push(asyncImport.body.data.source_id);
  createdObjectKeys.push(asyncImport.body.data.object_key);

  let asyncImportDetail;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    asyncImportDetail = await request(`/api/v1/imports/${asyncImport.body.data.id}`, { headers });
    if (['completed', 'completed_with_errors', 'failed'].includes(asyncImportDetail.body.data.status)) break;
    await Bun.sleep(100);
  }
  expect(asyncImportDetail.body.data.status).toBe('completed');
  expect(asyncImportDetail.body.data.processed_count).toBe(3);
  expect(asyncImportDetail.body.data.items).toHaveLength(3);
  createdRecordIds.push(...asyncImportDetail.body.data.items.map((item) => item.record_id).filter(Boolean));

  const asyncExport = await request('/api/v1/exports/async', {
    method: 'POST', headers,
    body: JSON.stringify({
      format: 'jsonl', language_code: asyncLanguage,
      idempotency_key: `async-export-${crypto.randomUUID()}`,
    }),
  });
  expect(asyncExport.response.status).toBe(202);
  expect(asyncExport.body.data.status).toBe('queued');
  createdExportJobIds.push(asyncExport.body.data.id);
  createdObjectKeys.push(asyncExport.body.data.object_key);

  let asyncExportDetail;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    asyncExportDetail = await request(`/api/v1/exports/${asyncExport.body.data.id}`, { headers });
    if (['completed', 'failed'].includes(asyncExportDetail.body.data.status)) break;
    await Bun.sleep(100);
  }
  expect(asyncExportDetail.body.data.status).toBe('completed');
  expect(asyncExportDetail.body.data.record_count).toBe(3);
  const asyncDownload = await app.request(`/api/v1/exports/${asyncExport.body.data.id}/download`, { headers });
  expect(asyncDownload.status).toBe(200);
  expect(asyncDownload.headers.get('X-Content-SHA256')).toStartWith('sha256:');
  expect(await asyncDownload.text()).toContain('Async imported 1');
  const completedCancel = await request(`/api/v1/exports/${asyncExport.body.data.id}/cancel`, { method: 'POST', headers });
  expect(completedCancel.response.status).toBe(409);
  expect(completedCancel.body.error.code).toBe('JOB_NOT_CANCELLABLE');

  const datasetDefinition = await request('/api/v1/datasets', {
    method: 'POST', headers,
    body: JSON.stringify({
      name: `Async training dataset ${crypto.randomUUID()}`,
      description: 'Immutable integration snapshot',
      filters: { statuses: ['draft'], record_types: ['plain_text'], language_codes: [asyncLanguage] },
      manifest_format: 'jsonl',
    }),
  });
  expect(datasetDefinition.response.status).toBe(201);
  createdDatasetDefinitionIds.push(datasetDefinition.body.data.id);
  const duplicateDataset = await request('/api/v1/datasets', {
    method: 'POST', headers,
    body: JSON.stringify({
      name: datasetDefinition.body.data.name,
      filters: { language_codes: [asyncLanguage] },
      manifest_format: 'jsonl',
    }),
  });
  expect(duplicateDataset.response.status).toBe(409);

  const datasetSnapshot = await request(`/api/v1/datasets/${datasetDefinition.body.data.id}/snapshots`, {
    method: 'POST', headers, body: '{}',
  });
  expect(datasetSnapshot.response.status).toBe(201);
  expect(datasetSnapshot.body.data.status).toBe('completed');
  expect(datasetSnapshot.body.data.record_count).toBe(3);
  expect(datasetSnapshot.body.data.manifest_hash).toStartWith('sha256:');
  createdDatasetSnapshotIds.push(datasetSnapshot.body.data.id);
  createdObjectKeys.push(datasetSnapshot.body.data.manifest_object_key);

  const snapshotDetailBeforeUpdate = await request(
    `/api/v1/datasets/${datasetDefinition.body.data.id}/snapshots/${datasetSnapshot.body.data.id}`,
    { headers },
  );
  expect(snapshotDetailBeforeUpdate.response.status).toBe(200);
  expect(snapshotDetailBeforeUpdate.body.data.records).toHaveLength(3);
  const frozenMember = snapshotDetailBeforeUpdate.body.data.records[0];
  const updatedAfterSnapshot = await request(`/api/v1/records/${frozenMember.record_id}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ expected_version: 1, title: 'Updated after immutable snapshot' }),
  });
  expect(updatedAfterSnapshot.response.status).toBe(200);
  expect(updatedAfterSnapshot.body.data.current_version_id).not.toBe(frozenMember.record_version_id);
  const snapshotDetailAfterUpdate = await request(
    `/api/v1/datasets/${datasetDefinition.body.data.id}/snapshots/${datasetSnapshot.body.data.id}`,
    { headers },
  );
  expect(snapshotDetailAfterUpdate.body.data.records[0].record_version_id).toBe(frozenMember.record_version_id);

  const manifestResponse = await app.request(
    `/api/v1/datasets/${datasetDefinition.body.data.id}/snapshots/${datasetSnapshot.body.data.id}/manifest`,
    { headers },
  );
  expect(manifestResponse.status).toBe(200);
  expect(manifestResponse.headers.get('X-Content-SHA256')).toBe(datasetSnapshot.body.data.manifest_hash);
  const manifestText = await manifestResponse.text();
  expect(manifestText).toContain(frozenMember.record_version_id);
  expect(manifestText).not.toContain(updatedAfterSnapshot.body.data.current_version_id);

  const trainingModel = await request('/api/v1/training/models', {
    method: 'POST', headers,
    body: JSON.stringify({
      name: `Integration model ${crypto.randomUUID()}`,
      provider: 'local', model_family: 'test-family', model_version: '1.0',
      base_model: 'base/test', configuration: { precision: 'bf16' },
    }),
  });
  expect(trainingModel.response.status).toBe(201);
  createdTrainingModelIds.push(trainingModel.body.data.id);
  const duplicateModel = await request('/api/v1/training/models', {
    method: 'POST', headers,
    body: JSON.stringify({ name: trainingModel.body.data.name }),
  });
  expect(duplicateModel.response.status).toBe(409);

  const invalidSnapshotRun = await request('/api/v1/training/runs', {
    method: 'POST', headers,
    body: JSON.stringify({
      run_uid: `invalid-${crypto.randomUUID()}`, model_id: trainingModel.body.data.id,
      dataset_snapshot_id: crypto.randomUUID(), task_type: 'sft',
      transformer: { name: 'chatml', version: '1.0' },
    }),
  });
  expect(invalidSnapshotRun.response.status).toBe(409);
  expect(invalidSnapshotRun.body.error.code).toBe('SNAPSHOT_NOT_READY');

  const trainingRun = await request('/api/v1/training/runs', {
    method: 'POST', headers,
    body: JSON.stringify({
      run_uid: `run-${crypto.randomUUID()}`, model_id: trainingModel.body.data.id,
      dataset_snapshot_id: datasetSnapshot.body.data.id, task_type: 'sft',
      transformer: { name: 'chatml', version: '1.0', configuration: { include_system: true } },
      parameters: { epochs: 2, learning_rate: 0.00002 },
      environment: { runtime: 'integration' }, code_revision: 'test-revision', seed: 42,
    }),
  });
  expect(trainingRun.response.status).toBe(201);
  expect(trainingRun.body.data.status).toBe('queued');
  expect(trainingRun.body.data.dataset_snapshot_id).toBe(datasetSnapshot.body.data.id);
  expect(trainingRun.body.data.model_snapshot.model_version).toBe('1.0');
  createdTrainingRunIds.push(trainingRun.body.data.id);

  const updatedTrainingModel = await request(`/api/v1/training/models/${trainingModel.body.data.id}`, {
    method: 'PATCH', headers, body: JSON.stringify({ model_version: '2.0' }),
  });
  expect(updatedTrainingModel.response.status).toBe(200);
  expect(updatedTrainingModel.body.data.model_version).toBe('2.0');

  const queuedMetric = await request(`/api/v1/training/runs/${trainingRun.body.data.id}/metrics`, {
    method: 'POST', headers,
    body: JSON.stringify({ metric_name: 'loss', metric_value: 1.5, split: 'train', step: 1 }),
  });
  expect(queuedMetric.response.status).toBe(409);

  const runningRun = await request(`/api/v1/training/runs/${trainingRun.body.data.id}/status`, {
    method: 'POST', headers, body: JSON.stringify({ status: 'running' }),
  });
  expect(runningRun.response.status).toBe(200);
  expect(runningRun.body.data.status).toBe('running');
  expect(runningRun.body.data.started_at).not.toBeNull();

  const lossMetric = await request(`/api/v1/training/runs/${trainingRun.body.data.id}/metrics`, {
    method: 'POST', headers,
    body: JSON.stringify({ metric_name: 'loss', metric_value: 0.42, split: 'train', step: 1, epoch: 0.5 }),
  });
  expect(lossMetric.response.status).toBe(201);
  const duplicateMetric = await request(`/api/v1/training/runs/${trainingRun.body.data.id}/metrics`, {
    method: 'POST', headers,
    body: JSON.stringify({ metric_name: 'loss', metric_value: 0.41, split: 'train', step: 1 }),
  });
  expect(duplicateMetric.response.status).toBe(409);

  const completedRun = await request(`/api/v1/training/runs/${trainingRun.body.data.id}/status`, {
    method: 'POST', headers,
    body: JSON.stringify({ status: 'completed', output_object_key: 'training/integration/checkpoint' }),
  });
  expect(completedRun.response.status).toBe(200);
  expect(completedRun.body.data.status).toBe('completed');
  expect(completedRun.body.data.finished_at).not.toBeNull();
  const repeatedCompletion = await request(`/api/v1/training/runs/${trainingRun.body.data.id}/status`, {
    method: 'POST', headers, body: JSON.stringify({ status: 'completed' }),
  });
  expect(repeatedCompletion.response.status).toBe(409);

  const evaluationMetric = await request(`/api/v1/training/runs/${trainingRun.body.data.id}/metrics`, {
    method: 'POST', headers,
    body: JSON.stringify({ metric_name: 'accuracy', metric_value: 0.91, split: 'validation', step: 2 }),
  });
  expect(evaluationMetric.response.status).toBe(201);
  const trainingRunDetail = await request(`/api/v1/training/runs/${trainingRun.body.data.id}`, { headers });
  expect(trainingRunDetail.response.status).toBe(200);
  expect(trainingRunDetail.body.data.dataset_snapshot_id).toBe(datasetSnapshot.body.data.id);
  expect(trainingRunDetail.body.data.model_snapshot.model_version).toBe('1.0');
  expect(trainingRunDetail.body.data.transformer.version).toBe('1.0');
  expect(trainingRunDetail.body.data.metrics).toHaveLength(2);

  const experience = await request('/api/v1/memory/experiences', {
    method: 'POST', headers,
    body: JSON.stringify({
      experience_uid: `experience-${crypto.randomUUID()}`, source_id: sourceId,
      title: 'Bell and meal observation', state_before: { hungry: true },
      event_summary: { event_count: 1 }, state_after: { food_available: true },
      reward: 0.2, prediction_error: 0.8, quality_score: 0.9,
      curriculum_level: 'observation', metadata: { session: 'integration' },
    }),
  });
  expect(experience.response.status).toBe(201);
  expect(experience.body.data.source_id).toBe(sourceId);
  createdMemoryExperienceIds.push(experience.body.data.id);

  const eventUid = `event-${crypto.randomUUID()}`;
  const memoryEvent = await request('/api/v1/memory/events', {
    method: 'POST', headers,
    body: JSON.stringify({
      event_uid: eventUid, source_id: sourceId, experience_id: experience.body.data.id,
      occurred_at: '2026-08-31T12:00:00+09:00', sequence_time: 0, duration: 0.5,
      modality: 'audio', channel: 'microphone', event_type: 'observation', symbol: 'bell',
      payload: { amplitude: 0.7 }, reward: 0.2, prediction_error: 0.8,
      confidence: 0.7, quality_score: 0.8, proposal_source: 'llm',
      extractor_name: 'integration-extractor', extractor_version: '1.0',
      verification_state: 'candidate', novelty: 0.6,
    }),
  });
  expect(memoryEvent.response.status).toBe(201);
  expect(memoryEvent.body.data.verification_state).toBe('candidate');
  createdMemoryEventIds.push(memoryEvent.body.data.id);
  const duplicateEvent = await request('/api/v1/memory/events', {
    method: 'POST', headers,
    body: JSON.stringify({ event_uid: eventUid, modality: 'audio', event_type: 'observation', proposal_source: 'human' }),
  });
  expect(duplicateEvent.response.status).toBe(409);

  const batchUid = `batch-${crypto.randomUUID()}`;
  const bulkEvents = [1, 2, 3].map((position) => ({
    event_uid: `bulk-event-${crypto.randomUUID()}`,
    source_id: sourceId,
    experience_id: experience.body.data.id,
    occurred_at: `2026-08-31T12:00:0${position}+09:00`,
    sequence_time: position,
    modality: position === 1 ? 'audio' : 'state',
    event_type: 'observation',
    symbol: position === 1 ? 'bell' : `state-${position}`,
    payload: { position },
    confidence: 0.7,
    proposal_source: 'rule',
    verification_state: 'candidate',
  }));
  const bulkEventCreate = await request('/api/v1/memory/events/bulk', {
    method: 'POST', headers, body: JSON.stringify({ batch_uid: batchUid, events: bulkEvents }),
  });
  expect(bulkEventCreate.response.status).toBe(201);
  expect(bulkEventCreate.body.data.replayed).toBe(false);
  expect(bulkEventCreate.body.data.event_count).toBe(3);
  expect(bulkEventCreate.body.data.events.map((event) => event.batch_position)).toEqual([1, 2, 3]);
  createdMemoryBatchIds.push(bulkEventCreate.body.data.batch_id);
  createdMemoryEventIds.push(...bulkEventCreate.body.data.events.map((event) => event.id));

  const bulkEventReplay = await request('/api/v1/memory/events/bulk', {
    method: 'POST', headers, body: JSON.stringify({ batch_uid: batchUid, events: bulkEvents }),
  });
  expect(bulkEventReplay.response.status).toBe(200);
  expect(bulkEventReplay.body.data.replayed).toBe(true);
  expect(bulkEventReplay.body.data.events.map((event) => event.id))
    .toEqual(bulkEventCreate.body.data.events.map((event) => event.id));

  const changedBatch = await request('/api/v1/memory/events/bulk', {
    method: 'POST', headers,
    body: JSON.stringify({ batch_uid: batchUid, events: [{ ...bulkEvents[0], symbol: 'changed' }] }),
  });
  expect(changedBatch.response.status).toBe(409);
  expect(changedBatch.body.error.code).toBe('BATCH_UID_CONFLICT');

  const duplicateBulkUid = await request('/api/v1/memory/events/bulk', {
    method: 'POST', headers,
    body: JSON.stringify({ batch_uid: `duplicate-${crypto.randomUUID()}`, events: [bulkEvents[0], bulkEvents[0]] }),
  });
  expect(duplicateBulkUid.response.status).toBe(400);
  expect(duplicateBulkUid.body.error.code).toBe('DUPLICATE_EVENT_UID');

  const rolledBackBatchUid = `rollback-${crypto.randomUUID()}`;
  const conflictingBulk = await request('/api/v1/memory/events/bulk', {
    method: 'POST', headers,
    body: JSON.stringify({
      batch_uid: rolledBackBatchUid,
      events: [{ ...bulkEvents[0], event_uid: eventUid }],
    }),
  });
  expect(conflictingBulk.response.status).toBe(409);
  expect(conflictingBulk.body.error.code).toBe('EVENT_UID_CONFLICT');
  const rolledBackBatches = await db.select({ id: memoryEventIngestionBatches.id })
    .from(memoryEventIngestionBatches)
    .where(and(
      eq(memoryEventIngestionBatches.createdBy, login.body.data.user.id),
      eq(memoryEventIngestionBatches.batchUid, rolledBackBatchUid),
    ));
  expect(rolledBackBatches).toHaveLength(0);

  const memoryWriterKey = await request('/api/v1/auth/api-keys', {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'Signed SARA event writer', scopes: ['memory:write'] }),
  });
  expect(memoryWriterKey.response.status).toBe(201);
  createdApiKeyIds.push(memoryWriterKey.body.data.id);
  const signedPath = '/api/v1/memory/events/bulk';
  const signedBatchUid = `signed-${crypto.randomUUID()}`;
  const signedBody = JSON.stringify({
    batch_uid: signedBatchUid,
    events: [{
      event_uid: `signed-event-${crypto.randomUUID()}`,
      source_id: sourceId,
      experience_id: experience.body.data.id,
      occurred_at: '2026-08-31T12:01:00+09:00',
      modality: 'state', event_type: 'observation', symbol: 'signed-ingress',
      proposal_source: 'rule', verification_state: 'candidate',
    }],
  });

  const unsignedIngress = await request(signedPath, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memoryWriterKey.body.data.key}`, 'Content-Type': 'application/json' },
    body: signedBody,
  });
  expect(unsignedIngress.response.status).toBe(401);
  expect(unsignedIngress.body.error.code).toBe('HMAC_REQUIRED');

  const signedRequestHeaders = await signedHeaders({
    apiKey: memoryWriterKey.body.data.key, path: signedPath, body: signedBody, idempotencyKey: signedBatchUid,
  });
  const signedIngress = await request(signedPath, { method: 'POST', headers: signedRequestHeaders, body: signedBody });
  expect(signedIngress.response.status).toBe(201);
  expect(signedIngress.body.data.replayed).toBe(false);
  createdMemoryBatchIds.push(signedIngress.body.data.batch_id);
  createdMemoryEventIds.push(...signedIngress.body.data.events.map((event) => event.id));

  const nonceReplay = await request(signedPath, { method: 'POST', headers: signedRequestHeaders, body: signedBody });
  expect(nonceReplay.response.status).toBe(409);
  expect(nonceReplay.body.error.code).toBe('HMAC_NONCE_REPLAY');

  const retryHeaders = await signedHeaders({
    apiKey: memoryWriterKey.body.data.key, path: signedPath, body: signedBody,
    nonce: crypto.randomUUID(), idempotencyKey: signedBatchUid,
  });
  const idempotentRetry = await request(signedPath, { method: 'POST', headers: retryHeaders, body: signedBody });
  expect(idempotentRetry.response.status).toBe(200);
  expect(idempotentRetry.body.data.replayed).toBe(true);
  expect(idempotentRetry.body.data.events[0].id).toBe(signedIngress.body.data.events[0].id);

  const expiredHeaders = await signedHeaders({
    apiKey: memoryWriterKey.body.data.key, path: signedPath, body: signedBody,
    nonce: crypto.randomUUID(), timestamp: Math.floor(Date.now() / 1000) - 3600, idempotencyKey: signedBatchUid,
  });
  const expiredSignature = await request(signedPath, { method: 'POST', headers: expiredHeaders, body: signedBody });
  expect(expiredSignature.response.status).toBe(401);
  expect(expiredSignature.body.error.code).toBe('HMAC_TIMESTAMP_EXPIRED');

  const tamperedHeaders = await signedHeaders({
    apiKey: memoryWriterKey.body.data.key, path: signedPath, body: signedBody,
    nonce: crypto.randomUUID(), idempotencyKey: signedBatchUid,
  });
  const tamperedSignature = await request(signedPath, {
    method: 'POST', headers: tamperedHeaders,
    body: signedBody.replace('signed-ingress', 'tampered-ingress'),
  });
  expect(tamperedSignature.response.status).toBe(401);
  expect(tamperedSignature.body.error.code).toBe('HMAC_SIGNATURE_INVALID');

  const invalidSourceEntity = await request('/api/v1/memory/entities', {
    method: 'POST', headers,
    body: JSON.stringify({ entity_uid: `invalid-${crypto.randomUUID()}`, entity_type: 'object', proposal_source: 'human', source_id: crypto.randomUUID() }),
  });
  expect(invalidSourceEntity.response.status).toBe(404);
  expect(invalidSourceEntity.body.error.code).toBe('SOURCE_NOT_FOUND');

  const entity = await request('/api/v1/memory/entities', {
    method: 'POST', headers,
    body: JSON.stringify({
      entity_uid: `entity-${crypto.randomUUID()}`, entity_type: 'object', canonical_name: 'bell',
      properties: { material: 'metal' }, confidence: 0.95,
      verification_state: 'candidate', proposal_source: 'human', source_id: sourceId,
    }),
  });
  expect(entity.response.status).toBe(201);
  createdMemoryEntityIds.push(entity.body.data.id);

  const entityAlias = await request(`/api/v1/memory/entities/${entity.body.data.id}/aliases`, {
    method: 'POST', headers,
    body: JSON.stringify({
      alias: 'Ｂｅｌｌ', language_code: 'en', alias_type: 'name', confidence: 0.9,
      proposal_source: 'human', verification_state: 'candidate',
    }),
  });
  expect(entityAlias.response.status).toBe(201);
  expect(entityAlias.body.data.normalized_alias).toBe('bell');
  createdMemoryAliasIds.push(entityAlias.body.data.id);
  const duplicateAlias = await request(`/api/v1/memory/entities/${entity.body.data.id}/aliases`, {
    method: 'POST', headers,
    body: JSON.stringify({ alias: ' bell ', language_code: 'EN', proposal_source: 'human' }),
  });
  expect(duplicateAlias.response.status).toBe(409);

  const concept = await request('/api/v1/memory/concepts', {
    method: 'POST', headers,
    body: JSON.stringify({
      concept_uid: `concept-${crypto.randomUUID()}`, concept_type: 'prediction', label: 'bell predicts meal',
      evidence_count: 1, contradiction_count: 0, verification_state: 'candidate',
      proposal_source: 'rule', utility_score: 0.4, event_pattern: { sequence: ['bell', 'meal'] },
      source_id: sourceId,
    }),
  });
  expect(concept.response.status).toBe(201);
  createdMemoryConceptIds.push(concept.body.data.id);

  const invalidRelation = await request('/api/v1/memory/relations', {
    method: 'POST', headers,
    body: JSON.stringify({
      relation_uid: `invalid-relation-${crypto.randomUUID()}`,
      source_type: 'entity', source_id: entity.body.data.id, relation_type: 'predicts',
      target_type: 'concept', target_id: crypto.randomUUID(), proposal_source: 'rule',
    }),
  });
  expect(invalidRelation.response.status).toBe(404);
  expect(invalidRelation.body.error.code).toBe('TARGET_NODE_NOT_FOUND');

  const relation = await request('/api/v1/memory/relations', {
    method: 'POST', headers,
    body: JSON.stringify({
      relation_uid: `relation-${crypto.randomUUID()}`,
      source_type: 'entity', source_id: entity.body.data.id, relation_type: 'associated_with',
      target_type: 'concept', target_id: concept.body.data.id,
      strength: 0.75, confidence: 0.65, evidence_count: 1,
      min_delay_ms: 100, max_delay_ms: 2000, verification_state: 'candidate',
      proposal_source: 'rule', context: { environment: 'lab' },
    }),
  });
  expect(relation.response.status).toBe(201);
  expect(relation.body.data.source_id).toBe(entity.body.data.id);
  createdMemoryRelationIds.push(relation.body.data.id);

  const predictionRelation = await request('/api/v1/memory/relations', {
    method: 'POST', headers,
    body: JSON.stringify({
      relation_uid: `relation-${crypto.randomUUID()}`,
      source_type: 'concept', source_id: concept.body.data.id, relation_type: 'predicts',
      target_type: 'event', target_id: bulkEventCreate.body.data.events[0].id,
      strength: 0.7, confidence: 0.8, verification_state: 'candidate',
      proposal_source: 'rule', context: { environment: 'lab' },
    }),
  });
  expect(predictionRelation.response.status).toBe(201);
  createdMemoryRelationIds.push(predictionRelation.body.data.id);

  const traversal = await request('/api/v1/memory/traverse', {
    method: 'POST', headers,
    body: JSON.stringify({
      start_nodes: [{ type: 'entity', id: entity.body.data.id }],
      relation_types: ['associated_with', 'predicts'], direction: 'outgoing',
      max_depth: 2, max_nodes: 10, max_edges: 10,
    }),
  });
  expect(traversal.response.status).toBe(200);
  expect(traversal.body.data.nodes).toHaveLength(3);
  expect(traversal.body.data.relations).toHaveLength(2);
  expect(traversal.body.meta.depth_reached).toBe(2);

  const shallowTraversal = await request('/api/v1/memory/traverse', {
    method: 'POST', headers,
    body: JSON.stringify({
      start_nodes: [{ type: 'entity', id: entity.body.data.id }],
      direction: 'outgoing', max_depth: 1, max_nodes: 10, max_edges: 10,
    }),
  });
  expect(shallowTraversal.response.status).toBe(200);
  expect(shallowTraversal.body.data.nodes).toHaveLength(2);
  expect(shallowTraversal.body.data.relations).toHaveLength(1);

  const filteredTraversal = await request('/api/v1/memory/traverse', {
    method: 'POST', headers,
    body: JSON.stringify({
      start_nodes: [{ type: 'entity', id: entity.body.data.id }],
      relation_types: ['not_present'], max_depth: 2, max_nodes: 10, max_edges: 10,
    }),
  });
  expect(filteredTraversal.response.status).toBe(200);
  expect(filteredTraversal.body.data.nodes).toHaveLength(1);
  expect(filteredTraversal.body.data.relations).toHaveLength(0);

  const nodeLimitedTraversal = await request('/api/v1/memory/traverse', {
    method: 'POST', headers,
    body: JSON.stringify({
      start_nodes: [{ type: 'entity', id: entity.body.data.id }],
      max_depth: 2, max_nodes: 1, max_edges: 10,
    }),
  });
  expect(nodeLimitedTraversal.response.status).toBe(200);
  expect(nodeLimitedTraversal.body.data.nodes).toHaveLength(1);
  expect(nodeLimitedTraversal.body.meta.node_limit_reached).toBe(true);

  const invalidTraversalLimits = await request('/api/v1/memory/traverse', {
    method: 'POST', headers,
    body: JSON.stringify({
      start_nodes: [
        { type: 'entity', id: entity.body.data.id },
        { type: 'concept', id: concept.body.data.id },
      ],
      max_nodes: 1,
    }),
  });
  expect(invalidTraversalLimits.response.status).toBe(400);

  const supportingEvidence = await request(`/api/v1/memory/relations/${relation.body.data.id}/evidence`, {
    method: 'POST', headers,
    body: JSON.stringify({
      evidence_uid: `evidence-${crypto.randomUUID()}`, evidence_type: 'observation',
      reference_type: 'event', reference_id: memoryEvent.body.data.id,
      supports: true, weight: 1.2, details: { note: 'Bell observation supports association' },
    }),
  });
  expect(supportingEvidence.response.status).toBe(201);
  expect(supportingEvidence.body.data.relation.evidence_count).toBe(2);
  createdMemoryEvidenceIds.push(supportingEvidence.body.data.evidence.id);
  const duplicateEvidence = await request(`/api/v1/memory/relations/${relation.body.data.id}/evidence`, {
    method: 'POST', headers,
    body: JSON.stringify({
      evidence_uid: supportingEvidence.body.data.evidence.evidence_uid,
      evidence_type: 'observation', reference_type: 'event', reference_id: memoryEvent.body.data.id,
      supports: true,
    }),
  });
  expect(duplicateEvidence.response.status).toBe(409);
  const counterEvidence = await request(`/api/v1/memory/relations/${relation.body.data.id}/evidence`, {
    method: 'POST', headers,
    body: JSON.stringify({
      evidence_uid: `counter-${crypto.randomUUID()}`, evidence_type: 'external_report',
      reference_type: 'external', supports: false, weight: 0.5,
      details: { url: 'https://example.invalid/counterexample' },
    }),
  });
  expect(counterEvidence.response.status).toBe(201);
  expect(counterEvidence.body.data.relation.evidence_count).toBe(2);
  expect(counterEvidence.body.data.relation.counterexample_count).toBe(1);
  createdMemoryEvidenceIds.push(counterEvidence.body.data.evidence.id);
  const evidenceList = await request(`/api/v1/memory/relations/${relation.body.data.id}/evidence`, { headers });
  expect(evidenceList.response.status).toBe(200);
  expect(evidenceList.body.data).toHaveLength(2);

  const neighbors = await request(`/api/v1/memory/nodes/entity/${entity.body.data.id}/neighbors`, { headers });
  expect(neighbors.response.status).toBe(200);
  expect(neighbors.body.data).toHaveLength(1);
  expect(neighbors.body.data[0].target_id).toBe(concept.body.data.id);

  const directVerificationPatch = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ verification_state: 'verified', evidence_count: 2 }),
  });
  expect(directVerificationPatch.response.status).toBe(400);
  const updatedConceptEvidence = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, {
    method: 'PATCH', headers, body: JSON.stringify({ evidence_count: 2 }),
  });
  expect(updatedConceptEvidence.response.status).toBe(200);
  expect(updatedConceptEvidence.body.data.event_pattern.sequence).toEqual(['bell', 'meal']);

  const verifiedConcept = await request(`/api/v1/memory/verification/concept/${concept.body.data.id}`, {
    method: 'POST', headers,
    body: JSON.stringify({ expected_state: 'candidate', state: 'verified', notes: 'Confirmed by integration reviewer' }),
  });
  expect(verifiedConcept.response.status).toBe(200);
  expect(verifiedConcept.body.data.verification_state).toBe('verified');
  createdMemoryDecisionIds.push(verifiedConcept.body.data.decision.id);
  const repeatedVerification = await request(`/api/v1/memory/verification/concept/${concept.body.data.id}`, {
    method: 'POST', headers,
    body: JSON.stringify({ expected_state: 'candidate', state: 'rejected' }),
  });
  expect(repeatedVerification.response.status).toBe(409);
  const verificationHistory = await request(`/api/v1/memory/verification/concept/${concept.body.data.id}`, { headers });
  expect(verificationHistory.response.status).toBe(200);
  expect(verificationHistory.body.data).toHaveLength(1);
  expect(verificationHistory.body.data[0].to_state).toBe('verified');

  const viewerMemoryRead = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, { headers: viewerHeaders });
  expect(viewerMemoryRead.response.status).toBe(404);

  const referencedConceptDelete = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, { method: 'DELETE', headers });
  expect(referencedConceptDelete.response.status).toBe(409);
  expect(referencedConceptDelete.body.error.code).toBe('MEMORY_NODE_IN_USE');

  const deletedEvent = await request(`/api/v1/memory/events/${memoryEvent.body.data.id}`, { method: 'DELETE', headers });
  expect(deletedEvent.response.status).toBe(200);
  expect(deletedEvent.body.data.deleted_at).not.toBeNull();
  const deletedEventRead = await request(`/api/v1/memory/events/${memoryEvent.body.data.id}`, { headers });
  expect(deletedEventRead.response.status).toBe(404);

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
  expect(recordAudits.body.data).toHaveLength(7);
  expect(new Set(recordAudits.body.data.map((entry) => entry.action)))
    .toEqual(new Set(['create', 'update', 'delete', 'restore', 'submit_review', 'approve']));
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
}, 30_000);
