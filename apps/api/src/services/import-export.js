import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  exportJobs,
  importItems,
  importJobs,
  records,
  recordVersions,
  sources,
} from '../db/schema/index.js';
import {
  appendAuditLog,
  changedFields,
  recordAuditSnapshot,
  sourceAuditSnapshot,
} from './audit.js';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
export const MAX_EXPORT_ROWS = 1000;

const recordTypes = new Set([
  'plain_text', 'instruction', 'qa', 'chat', 'sharegpt', 'chatml',
  'dpo', 'rlhf', 'classification', 'image_caption', 'multimodal',
  'event_sequence', 'custom',
]);
const recordStatuses = new Set(['draft', 'pending_review', 'approved', 'rejected', 'archived']);

export async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const nonEmpty = rows.filter((values) => values.some((value) => value !== ''));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error('CSV headers must not be empty.');
  return nonEmpty.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? '']),
  ));
}

export function parseImportContent(format, content) {
  let rows;
  if (format === 'jsonl') {
    rows = content.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(`JSONL line ${index + 1} is invalid JSON.`); }
    });
  } else if (format === 'json') {
    const parsed = JSON.parse(content);
    rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [parsed];
  } else rows = parseCsv(content);
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Import exceeds the ${MAX_IMPORT_ROWS} row limit.`);
  return rows;
}

function maybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

export function normalizeImportedRecord(row, defaults = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length === 0) {
    throw new Error('Row must be a non-empty object.');
  }
  let recordType = row.record_type || defaults.record_type;
  if (!recordType) recordType = row.instruction !== undefined ? 'instruction' : 'plain_text';
  if (!recordTypes.has(recordType)) throw new Error(`Unsupported record_type: ${recordType}`);
  const status = row.status || defaults.status || 'draft';
  if (!recordStatuses.has(status)) throw new Error(`Unsupported status: ${status}`);
  const content = row.content === undefined ? row : maybeJson(row.content);
  return {
    recordType,
    title: row.title || null,
    status,
    languageCode: row.language_code || defaults.language_code || null,
    qualityScore: row.quality_score === '' || row.quality_score == null ? null : Number(row.quality_score),
    confidence: row.confidence === '' || row.confidence == null ? null : Number(row.confidence),
    content,
    plainText: row.plain_text || row.text || null,
    schemaVersion: row.schema_version || '1.0',
    metadata: row.metadata && typeof maybeJson(row.metadata) === 'object' ? maybeJson(row.metadata) : {},
  };
}

export async function createImportJob(c, input) {
  const auth = c.get('auth');
  const contentHash = await sha256(input.content);
  const existing = await db.select().from(importJobs)
    .where(and(eq(importJobs.createdBy, auth.sub), eq(importJobs.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing[0]) {
    return existing[0].contentHash === contentHash
      ? { job: existing[0], replayed: true }
      : { job: existing[0], idempotencyConflict: true };
  }

  const jobId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const now = new Date();
  let job;
  try {
    job = await db.transaction(async (tx) => {
    const [source] = await tx.insert(sources).values({
      id: sourceId,
      sourceType: 'imported',
      title: input.fileName || `${input.format.toUpperCase()} import`,
      contentHash,
      metadata: { import_job_id: jobId, format: input.format },
      createdBy: auth.sub,
      createdAt: now,
      updatedAt: now,
    }).returning();
    const [created] = await tx.insert(importJobs).values({
      id: jobId,
      format: input.format,
      idempotencyKey: input.idempotencyKey,
      fileName: input.fileName,
      contentHash,
      byteSize: new TextEncoder().encode(input.content).byteLength,
      rawContent: input.content,
      options: input.defaults,
      sourceId,
      createdBy: auth.sub,
      createdAt: now,
    }).returning();
    await appendAuditLog(tx, c, {
      action: 'create', resourceType: 'source', resourceId: source.id,
      afterData: sourceAuditSnapshot(source),
      metadata: { import_job_id: jobId, changed_fields: changedFields(null, sourceAuditSnapshot(source)) },
      createdAt: now,
    });
      return created;
    });
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const [concurrent] = await db.select().from(importJobs)
      .where(and(eq(importJobs.createdBy, auth.sub), eq(importJobs.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (!concurrent) throw error;
    return concurrent.contentHash === contentHash
      ? { job: concurrent, replayed: true }
      : { job: concurrent, idempotencyConflict: true };
  }

  let rows;
  try {
    rows = parseImportContent(input.format, input.content);
  } catch (error) {
    const [failed] = await db.update(importJobs).set({ status: 'failed', completedAt: new Date() })
      .where(eq(importJobs.id, job.id)).returning();
    return { job: failed, parseError: error.message };
  }

  let succeededCount = 0;
  let failedCount = 0;
  for (let index = 0; index < rows.length; index += 1) {
    try {
      const normalized = normalizeImportedRecord(rows[index], input.defaults);
      if ((normalized.qualityScore != null && (!Number.isFinite(normalized.qualityScore) || normalized.qualityScore < 0 || normalized.qualityScore > 1))
        || (normalized.confidence != null && (!Number.isFinite(normalized.confidence) || normalized.confidence < 0 || normalized.confidence > 1))) {
        throw new Error('quality_score and confidence must be between 0 and 1.');
      }
      await db.transaction(async (tx) => {
        const recordId = crypto.randomUUID();
        const versionId = crypto.randomUUID();
        const createdAt = new Date();
        await tx.insert(records).values({
          id: recordId,
          recordType: normalized.recordType,
          title: normalized.title,
          status: normalized.status,
          currentVersionId: null,
          languageCode: normalized.languageCode,
          qualityScore: normalized.qualityScore,
          confidence: normalized.confidence,
          sourceId,
          ownerId: auth.sub,
          metadata: normalized.metadata,
          createdAt,
          updatedAt: createdAt,
        });
        const [version] = await tx.insert(recordVersions).values({
          id: versionId,
          recordId,
          versionNumber: 1,
          schemaVersion: normalized.schemaVersion,
          content: normalized.content,
          plainText: normalized.plainText,
          changeSummary: `Imported from row ${index + 1}`,
          createdBy: auth.sub,
          createdAt,
          updatedAt: createdAt,
          isCurrent: true,
        }).returning();
        const [record] = await tx.update(records).set({ currentVersionId: versionId })
          .where(eq(records.id, recordId)).returning();
        await tx.insert(importItems).values({ importJobId: job.id, rowNumber: index + 1, status: 'succeeded', recordId });
        const snapshot = recordAuditSnapshot(record, version);
        await appendAuditLog(tx, c, {
          action: 'create', resourceType: 'record', resourceId: recordId,
          afterData: snapshot,
          metadata: { import_job_id: job.id, import_row: index + 1, changed_fields: changedFields(null, snapshot) },
          createdAt,
        });
      });
      succeededCount += 1;
    } catch (error) {
      failedCount += 1;
      await db.insert(importItems).values({
        importJobId: job.id,
        rowNumber: index + 1,
        status: 'failed',
        errorCode: 'INVALID_ROW',
        errorMessage: String(error.message || error).slice(0, 2000),
      });
    }
  }
  const status = failedCount === 0 ? 'completed' : succeededCount === 0 ? 'failed' : 'completed_with_errors';
  const [completed] = await db.update(importJobs).set({
    status,
    totalCount: rows.length,
    succeededCount,
    failedCount,
    completedAt: new Date(),
  }).where(eq(importJobs.id, job.id)).returning();
  return { job: completed, replayed: false };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function formatExport(rows, format) {
  const normalized = rows.map(({ record, version }) => ({
    id: record.id,
    record_type: record.recordType,
    title: record.title,
    status: record.status,
    language_code: record.languageCode,
    quality_score: record.qualityScore,
    confidence: record.confidence,
    source_id: record.sourceId,
    schema_version: version.schemaVersion,
    content: version.content,
    plain_text: version.plainText,
    metadata: record.metadata,
  }));
  if (format === 'json') return JSON.stringify(normalized, null, 2);
  if (format === 'jsonl') return `${normalized.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const headers = ['id', 'record_type', 'title', 'status', 'language_code', 'quality_score', 'confidence', 'source_id', 'schema_version', 'content', 'plain_text', 'metadata'];
  return `${headers.join(',')}\n${normalized.map((row) => headers.map((header) => csvCell(
    ['content', 'metadata'].includes(header) ? JSON.stringify(row[header]) : row[header],
  )).join(',')).join('\n')}\n`;
}

export async function createExport(c, filters) {
  const conditions = [isNull(records.deletedAt)];
  if (filters.status) conditions.push(eq(records.status, filters.status));
  if (filters.recordType) conditions.push(eq(records.recordType, filters.recordType));
  if (filters.languageCode) conditions.push(eq(records.languageCode, filters.languageCode));
  const rows = await db.select({ record: records, version: recordVersions })
    .from(records).innerJoin(recordVersions, eq(records.currentVersionId, recordVersions.id))
    .where(and(...conditions)).orderBy(asc(records.id)).limit(MAX_EXPORT_ROWS + 1);
  if (rows.length > MAX_EXPORT_ROWS) return { tooLarge: true };
  const content = formatExport(rows, filters.format);
  const contentHash = await sha256(content);
  const [job] = await db.insert(exportJobs).values({
    format: filters.format,
    filters: { status: filters.status, record_type: filters.recordType, language_code: filters.languageCode },
    recordCount: rows.length,
    byteSize: new TextEncoder().encode(content).byteLength,
    contentHash,
    createdBy: c.get('auth').sub,
    completedAt: new Date(),
  }).returning();
  return { job, content };
}
