import { expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { memoryEventIngestionBatches, memoryEventIngestionJobs, memoryEvents, sources } from '../src/db/schema/index.js';
import { statObject } from '../src/services/background-jobs.js';
import { withWorkspaceFixture } from './support/workspace-fixture.js';
const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

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

integrationTest('Memory bulk ingestion is atomic and signed retries reject tampering and nonce reuse', async () => {
  await withWorkspaceFixture(async ({ request, headers, login }) => {
    const source = await request('/api/v1/sources', { method: 'POST', headers, body: JSON.stringify({ source_type: 'manual', title: 'Independent Memory source' }) });
    expect(source.response.status).toBe(201);
    const sourceId = source.body.data.id;
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


  });
}, 30_000);

integrationTest('Memory Worker ingestion completes independently with immutable batch identity', async () => {
  await withWorkspaceFixture(async ({ request, headers, login }) => {
    const source = await request('/api/v1/sources', { method: 'POST', headers, body: JSON.stringify({ source_type: 'manual', title: 'Independent Memory source' }) });
    expect(source.response.status).toBe(201);
    const sourceId = source.body.data.id;
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

    const asyncBatchUid = `async-events-${crypto.randomUUID()}`;
    const asyncEvents = Array.from({ length: 501 }, (_, index) => ({
      event_uid: `async-event-${crypto.randomUUID()}`,
      source_id: sourceId,
      experience_id: experience.body.data.id,
      occurred_at: new Date(Date.parse('2026-08-31T04:00:00Z') + index * 1000).toISOString(),
      sequence_time: index,
      modality: 'state', event_type: 'observation', symbol: `async-${index}`,
      payload: { index }, proposal_source: 'rule', verification_state: 'candidate',
    }));
    const asyncEventBody = JSON.stringify({ batch_uid: asyncBatchUid, events: asyncEvents });
    const asyncEventJob = await request('/api/v1/memory/events/async', {
      method: 'POST', headers, body: asyncEventBody,
    });
    expect(asyncEventJob.response.status).toBe(202);
    expect(asyncEventJob.body.data.status).toBe('queued');
    expect(asyncEventJob.body.data.event_count).toBe(501);
    expect(asyncEventJob.body.data.claim_generation).toBe(0);
    expect(asyncEventJob.body.data.attempt_count).toBe(0);
    expect(asyncEventJob.body.data.max_attempts).toBe(3);
    const asyncEventReplay = await request('/api/v1/memory/events/async', {
      method: 'POST', headers, body: asyncEventBody,
    });
    expect(asyncEventReplay.response.status).toBe(200);
    expect(asyncEventReplay.body.meta.replayed).toBe(true);
    expect(asyncEventReplay.body.data.id).toBe(asyncEventJob.body.data.id);

    let asyncEventDetail;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      asyncEventDetail = await request(`/api/v1/memory/event-jobs/${asyncEventJob.body.data.id}`, { headers });
      if (['completed', 'failed', 'cancelled'].includes(asyncEventDetail.body.data.status)) break;
      await Bun.sleep(100);
    }
    expect(asyncEventDetail.body.data.status).toBe('completed');
    expect(asyncEventDetail.body.data.processed_count).toBe(501);
    expect(asyncEventDetail.body.data.ingestion_batch_id).not.toBeNull();
    expect(asyncEventDetail.body.data.claim_generation).toBe(1);
    expect(asyncEventDetail.body.data.attempt_count).toBe(1);
    expect(asyncEventDetail.body.data.heartbeat_at).toBeNull();
    expect(asyncEventDetail.body.data.lease_expires_at).toBeNull();
    const asyncCreatedEvents = await db.select({ id: memoryEvents.id }).from(memoryEvents)
      .where(eq(memoryEvents.ingestionBatchId, asyncEventDetail.body.data.ingestion_batch_id));
    expect(asyncCreatedEvents).toHaveLength(501);

    const completedEventCancel = await request(`/api/v1/memory/event-jobs/${asyncEventJob.body.data.id}/cancel`, {
      method: 'POST', headers,
    });
    expect(completedEventCancel.response.status).toBe(409);
    expect(completedEventCancel.body.error.code).toBe('JOB_NOT_CANCELLABLE');

    const changedAsyncEvents = [...asyncEvents];
    changedAsyncEvents[0] = { ...changedAsyncEvents[0], symbol: 'changed-async' };
    const changedAsyncBatch = await request('/api/v1/memory/events/async', {
      method: 'POST', headers,
      body: JSON.stringify({ batch_uid: asyncBatchUid, events: changedAsyncEvents }),
    });
    expect(changedAsyncBatch.response.status).toBe(409);
    expect(changedAsyncBatch.body.error.code).toBe('BATCH_UID_CONFLICT');


  });
}, 30_000);

integrationTest('Memory fixture cancels or settles its Worker job and removes partial data after an assertion failure', async () => {
  let sourceId;
  let jobId;
  let objectKey;
  await expect(withWorkspaceFixture(async ({ request, headers }) => {
    const source = await request('/api/v1/sources', { method: 'POST', headers, body: JSON.stringify({ source_type: 'manual', title: 'Memory cleanup failure fixture' }) });
    expect(source.response.status).toBe(201);
    sourceId = source.body.data.id;
    const events = Array.from({ length: 501 }, () => ({ event_uid: `cleanup-${crypto.randomUUID()}`, source_id: sourceId, modality: 'state', event_type: 'observation', proposal_source: 'rule' }));
    const job = await request('/api/v1/memory/events/async', { method: 'POST', headers, body: JSON.stringify({ batch_uid: `cleanup-${crypto.randomUUID()}`, events }) });
    expect(job.response.status).toBe(202);
    jobId = job.body.data.id;
    const [stored] = await db.select().from(memoryEventIngestionJobs).where(eq(memoryEventIngestionJobs.id, jobId));
    objectKey = stored.objectKey;
    throw new Error('Injected assertion failure');
  })).rejects.toThrow('Injected assertion failure');
  expect(await db.select().from(memoryEventIngestionJobs).where(eq(memoryEventIngestionJobs.id, jobId))).toHaveLength(0);
  expect(await db.select().from(memoryEvents).where(eq(memoryEvents.sourceId, sourceId))).toHaveLength(0);
  expect(await db.select().from(sources).where(eq(sources.id, sourceId))).toHaveLength(0);
  await expect(statObject(objectKey)).rejects.toThrow();
}, 30_000);
