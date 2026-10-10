import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import app from '../src/app.js';
import { db } from '../src/db/client.js';
import { auditLogs, importJobs, importItems, exportJobs, records, recordVersions, sources, refreshTokens } from '../src/db/schema/index.js';
import { hashSecret } from '../src/auth/secrets.js';
import { deleteObject } from '../src/services/background-jobs.js';
import { createIntegrationFixture } from './support/integration-fixture.js';

const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

async function withImportExportFixture(run) {
  const scope = createIntegrationFixture();
  let headers;
  const tracked = new Set();
  function track(kind, id) {
    if (!id || tracked.has(`${kind}:${id}`)) return;
    tracked.add(`${kind}:${id}`);
    const table = kind === 'imports' ? importJobs : exportJobs;
    scope.defer(async () => {
      let job;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        [job] = await db.select().from(table).where(eq(table.id, id));
        if (!job || !['queued', 'processing'].includes(job.status)) break;
        if (attempt === 0) await app.request(`/api/v1/${kind}/${id}/cancel`, { method: 'POST', headers });
        await Bun.sleep(100);
      }
      if (!job) return;
      if (['queued', 'processing'].includes(job.status)) throw new Error(`Worker did not settle before cleanup: ${kind}/${id}`);
      if (job.objectKey) scope.defer(() => deleteObject(job.objectKey));
      await db.transaction(async (tx) => {
        if (kind === 'imports') {
          const imported = await tx.select({ id: records.id, status: records.status }).from(records).where(eq(records.sourceId, job.sourceId));
          await tx.delete(importItems).where(eq(importItems.importJobId, id));
          await tx.delete(importJobs).where(eq(importJobs.id, id));
          for (const record of imported) {
            await tx.delete(auditLogs).where(eq(auditLogs.resourceId, record.id));
            await tx.update(records).set({ currentVersionId: null }).where(eq(records.id, record.id));
            await tx.delete(recordVersions).where(eq(recordVersions.recordId, record.id));
            await tx.delete(records).where(eq(records.id, record.id));
          }
          await tx.delete(auditLogs).where(eq(auditLogs.resourceId, job.sourceId));
          await tx.delete(sources).where(eq(sources.id, job.sourceId));
        } else await tx.delete(exportJobs).where(eq(exportJobs.id, id));
      });
    });
  }
  async function request(path, options = {}) {
    const response = await app.request(path, options);
    const body = await response.json();
    if (options.method === 'POST' && /^\/api\/v1\/(imports|exports)(\/async)?$/.test(path)) track(path.split('/')[3], body.data?.id);
    return { response, body };
  }
  async function assertDraftItems(detail) {
    for (const item of detail.body.data.items.filter((entry) => entry.record_id)) {
      const record = await request(`/api/v1/records/${item.record_id}`, { headers });
      expect(record.response.status).toBe(200);
      expect(record.body.data.status).toBe('draft');
    }
  }
  try {
    const login = await request('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    });
    if (login.body.data?.refresh_token) scope.defer(async () => db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, await hashSecret(login.body.data.refresh_token))));
    expect(login.response.status).toBe(200);
    headers = { Authorization: `Bearer ${login.body.data.access_token}`, 'Content-Type': 'application/json' };
    await run({ request, headers, track, assertDraftItems });
  } finally { await scope.cleanup(); }
}

integrationTest('synchronous import/export isolates parse errors, review bypass and idempotency', async () => {
  await withImportExportFixture(async ({ request, headers, track, assertDraftItems }) => {
    const importLanguage = `it-${crypto.randomUUID().slice(0, 8)}`;
    const jsonlContent = [
      JSON.stringify({ instruction: 'Say hello', output: 'Hello', title: 'Imported instruction' }),
      JSON.stringify({ record_type: 'unsupported_type', content: { invalid: true } }),
      JSON.stringify({ record_type: 'plain_text', status: 'approved', content: { invalid: 'review bypass' } }),
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
  expect(importedJsonl.body.data.failed_count).toBe(2);
  expect(importedJsonl.body.data.raw_content).toBeUndefined();

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
  expect(jsonlDetail.body.data.items).toHaveLength(4);
  expect(jsonlDetail.body.data.items.filter((item) => item.status === 'failed')).toHaveLength(2);

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
  const jsonDetail = await request(`/api/v1/imports/${importedJson.body.data.id}`, { headers });

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
  const csvDetail = await request(`/api/v1/imports/${importedCsv.body.data.id}`, { headers });

  const malformedImport = await request('/api/v1/imports', {
    method: 'POST', headers,
    body: JSON.stringify({ format: 'json', content: '{broken', idempotency_key: `broken-${crypto.randomUUID()}` }),
  });
  expect(malformedImport.response.status).toBe(422);
  expect(malformedImport.body.data.status).toBe('failed');
  expect(typeof malformedImport.body.meta.parse_error).toBe('string');

  for (const format of ['json', 'jsonl', 'csv']) {
    const response = await app.request('/api/v1/exports', {
      method: 'POST', headers,
      body: JSON.stringify({ format, language_code: importLanguage }),
    });
    track('exports', response.headers.get('X-Export-ID'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain(`.${format}`);
    expect(response.headers.get('X-Content-SHA256')).toStartWith('sha256:');
    const exportId = response.headers.get('X-Export-ID');
    const content = await response.text();
    expect(content).toContain('Imported instruction');
    const exportDetail = await request(`/api/v1/exports/${exportId}`, { headers });
    expect(exportDetail.response.status).toBe(200);
    expect(exportDetail.body.data.record_count).toBe(4);
  }


  await assertDraftItems(jsonlDetail);
  await assertDraftItems(jsonDetail);
  await assertDraftItems(csvDetail);
  });
}, 30_000);

integrationTest('worker import/export preserves draft status and downloadable output', async () => {
  await withImportExportFixture(async ({ request, headers, track, assertDraftItems }) => {
    const asyncLanguage = `async-${crypto.randomUUID().slice(0, 8)}`;
    const asyncImport = await request('/api/v1/imports/async', {
      method: 'POST', headers,
      body: JSON.stringify({
        format: 'jsonl',
        content: [1, 2, 3].map((number) => JSON.stringify({
          record_type: 'plain_text', title: `Async imported ${number}`, text: `async-${number}`,
        })).concat(JSON.stringify({
          record_type: 'plain_text', status: 'approved', title: 'Async review bypass', text: 'invalid',
        })).join('\n'),
        idempotency_key: `async-import-${crypto.randomUUID()}`,
        file_name: 'async-integration.jsonl',
        defaults: { language_code: asyncLanguage },
      }),
  });
  expect(asyncImport.response.status).toBe(202);
  expect(asyncImport.body.data.mode).toBe('async');
  expect(asyncImport.body.data.status).toBe('queued');
  expect(asyncImport.body.data.claim_generation).toBe(0);
  expect(asyncImport.body.data.attempt_count).toBe(0);
  expect(asyncImport.body.data.max_attempts).toBe(3);

  let asyncImportDetail;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    asyncImportDetail = await request(`/api/v1/imports/${asyncImport.body.data.id}`, { headers });
    if (['completed', 'completed_with_errors', 'failed'].includes(asyncImportDetail.body.data.status)) break;
    await Bun.sleep(100);
  }
  expect(asyncImportDetail.body.data.status).toBe('completed_with_errors');
  expect(asyncImportDetail.body.data.processed_count).toBe(4);
  expect(asyncImportDetail.body.data.succeeded_count).toBe(3);
  expect(asyncImportDetail.body.data.failed_count).toBe(1);
  expect(asyncImportDetail.body.data.items).toHaveLength(4);
  expect(asyncImportDetail.body.data.claim_generation).toBe(1);
  expect(asyncImportDetail.body.data.attempt_count).toBe(1);
  expect(asyncImportDetail.body.data.heartbeat_at).toBeNull();
  expect(asyncImportDetail.body.data.lease_expires_at).toBeNull();

  const asyncExport = await request('/api/v1/exports/async', {
    method: 'POST', headers,
    body: JSON.stringify({
      format: 'jsonl', language_code: asyncLanguage,
      idempotency_key: `async-export-${crypto.randomUUID()}`,
    }),
  });
  expect(asyncExport.response.status).toBe(202);
  expect(asyncExport.body.data.status).toBe('queued');
  expect(asyncExport.body.data.claim_generation).toBe(0);
  expect(asyncExport.body.data.attempt_count).toBe(0);
  expect(asyncExport.body.data.max_attempts).toBe(3);

  let asyncExportDetail;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    asyncExportDetail = await request(`/api/v1/exports/${asyncExport.body.data.id}`, { headers });
    if (['completed', 'failed'].includes(asyncExportDetail.body.data.status)) break;
    await Bun.sleep(100);
  }
  expect(asyncExportDetail.body.data.status).toBe('completed');
  expect(asyncExportDetail.body.data.record_count).toBe(3);
  expect(asyncExportDetail.body.data.claim_generation).toBe(1);
  expect(asyncExportDetail.body.data.attempt_count).toBe(1);
  expect(asyncExportDetail.body.data.heartbeat_at).toBeNull();
  expect(asyncExportDetail.body.data.lease_expires_at).toBeNull();
  const asyncDownload = await app.request(`/api/v1/exports/${asyncExport.body.data.id}/download`, { headers });
  expect(asyncDownload.status).toBe(200);
  expect(asyncDownload.headers.get('X-Content-SHA256')).toStartWith('sha256:');
  expect(await asyncDownload.text()).toContain('Async imported 1');
  const completedCancel = await request(`/api/v1/exports/${asyncExport.body.data.id}/cancel`, { method: 'POST', headers });
  expect(completedCancel.response.status).toBe(409);
  expect(completedCancel.body.error.code).toBe('JOB_NOT_CANCELLABLE');


  await assertDraftItems(asyncImportDetail);
  });
}, 30_000);

