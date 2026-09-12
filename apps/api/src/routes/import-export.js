import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { exportJobs, importItems, importJobs, sources } from '../db/schema/index.js';
import {
  createExport,
  createImportJob,
  MAX_IMPORT_BYTES,
  sha256,
} from '../services/import-export.js';
import { enqueueBackgroundJob, readObject, storeObject } from '../services/background-jobs.js';
import { appendAuditLog, changedFields, sourceAuditSnapshot } from '../services/audit.js';

const formats = ['json', 'jsonl', 'csv'];
const recordTypes = [
  'plain_text', 'instruction', 'qa', 'chat', 'sharegpt', 'chatml',
  'dpo', 'rlhf', 'classification', 'image_caption', 'multimodal',
  'event_sequence', 'custom',
];
const recordStatuses = ['draft', 'pending_review', 'approved', 'rejected', 'archived'];
const uuidSchema = z.string().uuid();
const importSchema = z.object({
  format: z.enum(formats),
  content: z.string().min(1),
  idempotency_key: z.string().trim().min(8).max(200),
  file_name: z.string().trim().min(1).max(255).nullable().optional(),
  defaults: z.object({
    record_type: z.enum(recordTypes).optional(),
    status: z.enum(recordStatuses).optional(),
    language_code: z.string().max(20).nullable().optional(),
  }).optional(),
});
const exportSchema = z.object({
  format: z.enum(formats),
  status: z.enum(recordStatuses).optional(),
  record_type: z.enum(recordTypes).optional(),
  language_code: z.string().max(20).optional(),
});
const asyncImportSchema = importSchema.extend({ content: z.string().min(1) });
const asyncExportSchema = exportSchema.extend({
  idempotency_key: z.string().trim().min(8).max(200),
});
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const configuredJobMaxAttempts = Number(process.env.JOB_MAX_ATTEMPTS || 3);
const jobMaxAttempts = Number.isInteger(configuredJobMaxAttempts)
  ? Math.max(1, Math.min(100, configuredJobMaxAttempts))
  : 3;

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

function serializeImport(job) {
  return {
    id: job.id,
    format: job.format,
    status: job.status,
    mode: job.mode,
    idempotency_key: job.idempotencyKey,
    file_name: job.fileName,
    content_hash: job.contentHash,
    object_key: job.objectKey,
    byte_size: job.byteSize,
    options: job.options,
    total_count: job.totalCount,
    succeeded_count: job.succeededCount,
    failed_count: job.failedCount,
    processed_count: job.processedCount,
    cancel_requested: job.cancelRequested,
    claim_generation: job.claimGeneration,
    attempt_count: job.attemptCount,
    max_attempts: job.maxAttempts,
    heartbeat_at: job.heartbeatAt,
    lease_expires_at: job.leaseExpiresAt,
    next_attempt_at: job.nextAttemptAt,
    error_message: job.errorMessage,
    source_id: job.sourceId,
    created_by: job.createdBy,
    created_at: job.createdAt,
    started_at: job.startedAt,
    completed_at: job.completedAt,
  };
}

function serializeExport(job) {
  return {
    id: job.id,
    format: job.format,
    status: job.status,
    mode: job.mode,
    filters: job.filters,
    record_count: job.recordCount,
    byte_size: job.byteSize,
    content_hash: job.contentHash,
    object_key: job.objectKey,
    cancel_requested: job.cancelRequested,
    claim_generation: job.claimGeneration,
    attempt_count: job.attemptCount,
    max_attempts: job.maxAttempts,
    heartbeat_at: job.heartbeatAt,
    lease_expires_at: job.leaseExpiresAt,
    next_attempt_at: job.nextAttemptAt,
    error_message: job.errorMessage,
    created_by: job.createdBy,
    created_at: job.createdAt,
    started_at: job.startedAt,
    completed_at: job.completedAt,
  };
}

export const importRoutes = new Hono();
importRoutes.use('*', requireAuth, requireScopes('imports:create'), requireRoles('admin', 'editor'));

importRoutes.post('/', async (c) => {
  const result = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!result.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Import input is invalid.', result.error.issues);
  const byteSize = new TextEncoder().encode(result.data.content).byteLength;
  if (byteSize > MAX_IMPORT_BYTES) {
    return errorResponse(c, 413, 'IMPORT_TOO_LARGE', `Synchronous imports are limited to ${MAX_IMPORT_BYTES} bytes.`);
  }
  const outcome = await createImportJob(c, {
    format: result.data.format,
    content: result.data.content,
    idempotencyKey: result.data.idempotency_key,
    fileName: result.data.file_name || null,
    defaults: result.data.defaults || {},
  });
  if (outcome.idempotencyConflict) {
    return errorResponse(c, 409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with different content.');
  }
  const status = outcome.parseError ? 422 : outcome.replayed ? 200 : 201;
  return c.json({
    data: serializeImport(outcome.job),
    meta: { replayed: Boolean(outcome.replayed), ...(outcome.parseError ? { parse_error: outcome.parseError } : {}) },
    error: null,
  }, status);
});

importRoutes.post('/async', async (c) => {
  const result = asyncImportSchema.safeParse(await c.req.json().catch(() => null));
  if (!result.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Async import input is invalid.', result.error.issues);
  const byteSize = new TextEncoder().encode(result.data.content).byteLength;
  const maxBytes = Number(process.env.MAX_UPLOAD_SIZE_MB || 100) * 1024 * 1024;
  if (byteSize > maxBytes) return errorResponse(c, 413, 'IMPORT_TOO_LARGE', `Async imports are limited to ${maxBytes} bytes.`);
  const auth = c.get('auth');
  const contentHash = await sha256(result.data.content);
  const [existing] = await db.select().from(importJobs)
    .where(and(eq(importJobs.createdBy, auth.sub), eq(importJobs.idempotencyKey, result.data.idempotency_key))).limit(1);
  if (existing) {
    if (existing.contentHash !== contentHash) return errorResponse(c, 409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with different content.');
    return c.json({ data: serializeImport(existing), meta: { replayed: true }, error: null });
  }
  const jobId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const objectKey = `imports/${auth.sub}/${jobId}/source.${result.data.format}`;
  await storeObject(objectKey, result.data.content, 'text/plain; charset=utf-8');
  const now = new Date();
  const job = await db.transaction(async (tx) => {
    const [source] = await tx.insert(sources).values({
      id: sourceId, sourceType: 'imported', title: result.data.file_name || `Async ${result.data.format.toUpperCase()} import`,
      contentHash, metadata: { import_job_id: jobId, format: result.data.format, storage: 'minio' },
      createdBy: auth.sub, createdAt: now, updatedAt: now,
    }).returning();
    const [created] = await tx.insert(importJobs).values({
      id: jobId, mode: 'async', status: 'queued', format: result.data.format,
      idempotencyKey: result.data.idempotency_key, fileName: result.data.file_name || null,
      contentHash, byteSize, rawContent: null, objectKey, options: result.data.defaults || {},
      sourceId, maxAttempts: jobMaxAttempts, createdBy: auth.sub, createdAt: now,
    }).returning();
    const snapshot = sourceAuditSnapshot(source);
    await appendAuditLog(tx, c, {
      action: 'create', resourceType: 'source', resourceId: source.id, afterData: snapshot,
      metadata: { import_job_id: jobId, async: true, changed_fields: changedFields(null, snapshot) }, createdAt: now,
    });
    return created;
  });
  await enqueueBackgroundJob('import', job.id);
  return c.json({ data: serializeImport(job), meta: { replayed: false }, error: null }, 202);
});

importRoutes.post('/:id/cancel', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Import ID must be a UUID.');
  const [job] = await db.update(importJobs).set({ cancelRequested: true })
    .where(and(eq(importJobs.id, id.data), inArray(importJobs.status, ['queued', 'processing']))).returning();
  if (!job) {
    const [existing] = await db.select({ id: importJobs.id }).from(importJobs)
      .where(eq(importJobs.id, id.data)).limit(1);
    return existing
      ? errorResponse(c, 409, 'JOB_NOT_CANCELLABLE', 'Only queued or processing imports can be cancelled.')
      : errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Import was not found.');
  }
  return c.json({ data: serializeImport(job), meta: {}, error: null });
});

importRoutes.get('/', async (c) => {
  const query = listSchema.safeParse({ limit: c.req.query('limit') });
  if (!query.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Import query is invalid.', query.error.issues);
  const jobs = await db.select().from(importJobs)
    .orderBy(desc(importJobs.createdAt)).limit(query.data.limit);
  return c.json({ data: jobs.map(serializeImport), meta: { limit: query.data.limit }, error: null });
});

importRoutes.get('/:id', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Import ID must be a UUID.');
  const [job] = await db.select().from(importJobs)
    .where(eq(importJobs.id, id.data)).limit(1);
  if (!job) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Import was not found.');
  const items = await db.select().from(importItems)
    .where(eq(importItems.importJobId, job.id)).orderBy(importItems.rowNumber);
  return c.json({
    data: {
      ...serializeImport(job),
      items: items.map((item) => ({
        row_number: item.rowNumber,
        status: item.status,
        record_id: item.recordId,
        error_code: item.errorCode,
        error_message: item.errorMessage,
      })),
    },
    meta: {}, error: null,
  });
});

export const exportRoutes = new Hono();
exportRoutes.use('*', requireAuth, requireScopes('exports:create'), requireRoles('admin', 'editor', 'reviewer'));

exportRoutes.post('/', async (c) => {
  const result = exportSchema.safeParse(await c.req.json().catch(() => null));
  if (!result.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Export input is invalid.', result.error.issues);
  const outcome = await createExport(c, {
    format: result.data.format,
    status: result.data.status,
    recordType: result.data.record_type,
    languageCode: result.data.language_code,
  });
  if (outcome.tooLarge) return errorResponse(c, 413, 'EXPORT_TOO_LARGE', 'Synchronous exports are limited to 1000 records.');
  const contentType = result.data.format === 'csv'
    ? 'text/csv; charset=utf-8'
    : result.data.format === 'jsonl' ? 'application/x-ndjson; charset=utf-8' : 'application/json; charset=utf-8';
  c.header('Content-Type', contentType);
  c.header('Content-Disposition', `attachment; filename="sara-export-${outcome.job.id}.${result.data.format}"`);
  c.header('X-Export-ID', outcome.job.id);
  c.header('X-Content-SHA256', outcome.job.contentHash);
  return c.body(outcome.content, 200);
});

exportRoutes.post('/async', async (c) => {
  const result = asyncExportSchema.safeParse(await c.req.json().catch(() => null));
  if (!result.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Async export input is invalid.', result.error.issues);
  const auth = c.get('auth');
  const [existing] = await db.select().from(exportJobs)
    .where(and(eq(exportJobs.createdBy, auth.sub), eq(exportJobs.idempotencyKey, result.data.idempotency_key))).limit(1);
  if (existing) {
    const requestedFilters = { status: result.data.status, record_type: result.data.record_type, language_code: result.data.language_code };
    if (JSON.stringify(existing.filters) !== JSON.stringify(requestedFilters)) {
      return errorResponse(c, 409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with different export filters.');
    }
    return c.json({ data: serializeExport(existing), meta: { replayed: true }, error: null });
  }
  const id = crypto.randomUUID();
  const objectKey = `exports/${auth.sub}/${id}/records.${result.data.format}`;
  const [job] = await db.insert(exportJobs).values({
    id, mode: 'async', status: 'queued', format: result.data.format,
    idempotencyKey: result.data.idempotency_key,
    filters: { status: result.data.status, record_type: result.data.record_type, language_code: result.data.language_code },
    objectKey, contentHash: null, maxAttempts: jobMaxAttempts,
    createdBy: auth.sub, createdAt: new Date(), completedAt: null,
  }).returning();
  await enqueueBackgroundJob('export', job.id);
  return c.json({ data: serializeExport(job), meta: { replayed: false }, error: null }, 202);
});

exportRoutes.post('/:id/cancel', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Export ID must be a UUID.');
  const [job] = await db.update(exportJobs).set({ cancelRequested: true })
    .where(and(eq(exportJobs.id, id.data), inArray(exportJobs.status, ['queued', 'processing']))).returning();
  if (!job) {
    const [existing] = await db.select({ id: exportJobs.id }).from(exportJobs)
      .where(eq(exportJobs.id, id.data)).limit(1);
    return existing
      ? errorResponse(c, 409, 'JOB_NOT_CANCELLABLE', 'Only queued or processing exports can be cancelled.')
      : errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Export was not found.');
  }
  return c.json({ data: serializeExport(job), meta: {}, error: null });
});

exportRoutes.get('/:id/download', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Export ID must be a UUID.');
  const [job] = await db.select().from(exportJobs)
    .where(eq(exportJobs.id, id.data)).limit(1);
  if (!job) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Export was not found.');
  if (job.status !== 'completed' || !job.objectKey) return errorResponse(c, 409, 'EXPORT_NOT_READY', 'Export is not ready for download.');
  const content = await readObject(job.objectKey);
  c.header('Content-Type', job.format === 'csv' ? 'text/csv; charset=utf-8' : job.format === 'jsonl' ? 'application/x-ndjson; charset=utf-8' : 'application/json; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="sara-export-${job.id}.${job.format}"`);
  c.header('X-Export-ID', job.id);
  c.header('X-Content-SHA256', job.contentHash);
  return c.body(content);
});

exportRoutes.get('/:id', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Export ID must be a UUID.');
  const [job] = await db.select().from(exportJobs)
    .where(eq(exportJobs.id, id.data)).limit(1);
  if (!job) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Export was not found.');
  return c.json({ data: serializeExport(job), meta: {}, error: null });
});
