import { Hono } from 'hono';
import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';
import { db } from '../db/client.js';
import {
  datasetDefinitions,
  datasetSnapshotRecords,
  datasetSnapshots,
  records,
  recordVersions,
} from '../db/schema/index.js';
import { readObject, storeObject } from '../services/background-jobs.js';
import { sha256 } from '../services/import-export.js';

const recordTypes = [
  'plain_text', 'instruction', 'qa', 'chat', 'sharegpt', 'chatml',
  'dpo', 'rlhf', 'classification', 'image_caption', 'multimodal',
  'event_sequence', 'custom',
];
const statuses = ['draft', 'pending_review', 'approved', 'rejected', 'archived'];
const filtersSchema = z.object({
  statuses: z.array(z.enum(statuses)).max(statuses.length).optional(),
  record_types: z.array(z.enum(recordTypes)).max(recordTypes.length).optional(),
  language_codes: z.array(z.string().max(20)).max(50).optional(),
  minimum_quality_score: z.number().min(0).max(1).optional(),
}).default({});
const definitionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  filters: filtersSchema,
  manifest_format: z.enum(['json', 'jsonl']).default('json'),
});
const definitionPatchSchema = definitionSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const uuidSchema = z.string().uuid();
const MAX_SNAPSHOT_RECORDS = 10000;

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

function serializeDefinition(item) {
  return {
    id: item.id, name: item.name, description: item.description, filters: item.filters,
    manifest_format: item.manifestFormat, created_by: item.createdBy,
    created_at: item.createdAt, updated_at: item.updatedAt, deleted_at: item.deletedAt,
  };
}

function serializeSnapshot(item) {
  return {
    id: item.id, definition_id: item.definitionId, status: item.status,
    definition_revision: item.definitionRevision, filters: item.filters,
    manifest_format: item.manifestFormat, record_count: item.recordCount,
    manifest_object_key: item.manifestObjectKey, manifest_hash: item.manifestHash,
    error_message: item.errorMessage, created_by: item.createdBy,
    created_at: item.createdAt, completed_at: item.completedAt,
  };
}

async function ownedDefinition(id, ownerId) {
  const [item] = await db.select().from(datasetDefinitions)
    .where(and(eq(datasetDefinitions.id, id), eq(datasetDefinitions.createdBy, ownerId), isNull(datasetDefinitions.deletedAt))).limit(1);
  return item;
}

function formatManifest(snapshot, definition, rows) {
  const metadata = {
    schema: 'sara.dataset-manifest/1.0', snapshot_id: snapshot.id,
    definition_id: definition.id, definition_revision: definition.updatedAt.toISOString(),
    created_at: snapshot.createdAt.toISOString(), filters: definition.filters,
    record_count: rows.length,
  };
  const entries = rows.map(({ record, version }, index) => ({
    ordinal: index + 1, record_id: record.id, record_version_id: version.id,
    version_number: version.versionNumber, record_type: record.recordType,
    status: record.status, language_code: record.languageCode,
    quality_score: record.qualityScore, confidence: record.confidence,
    source_id: record.sourceId, schema_version: version.schemaVersion,
  }));
  if (snapshot.manifestFormat === 'json') return JSON.stringify({ ...metadata, records: entries }, null, 2);
  return `${[JSON.stringify({ type: 'manifest', ...metadata }), ...entries.map((entry) => JSON.stringify({ type: 'record', ...entry }))].join('\n')}\n`;
}

const datasetRoutes = new Hono();
datasetRoutes.use('*', requireAuth);

datasetRoutes.get('/', requireScopes('datasets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const query = listSchema.safeParse({ limit: c.req.query('limit') });
  if (!query.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset query is invalid.', query.error.issues);
  const items = await db.select().from(datasetDefinitions)
    .where(and(eq(datasetDefinitions.createdBy, c.get('auth').sub), isNull(datasetDefinitions.deletedAt)))
    .orderBy(desc(datasetDefinitions.updatedAt)).limit(query.data.limit);
  return c.json({ data: items.map(serializeDefinition), meta: { limit: query.data.limit }, error: null });
});

datasetRoutes.post('/', requireScopes('datasets:write'), requireRoles('admin', 'editor'), async (c) => {
  const input = definitionSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset definition is invalid.', input.error.issues);
  try {
    const [created] = await db.insert(datasetDefinitions).values({
      name: input.data.name, description: input.data.description ?? null,
      filters: input.data.filters, manifestFormat: input.data.manifest_format,
      createdBy: c.get('auth').sub,
    }).returning();
    return c.json({ data: serializeDefinition(created), meta: {}, error: null }, 201);
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'DATASET_NAME_CONFLICT', 'A dataset with this name already exists.');
    throw error;
  }
});

datasetRoutes.get('/:id', requireScopes('datasets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset ID must be a UUID.');
  const item = await ownedDefinition(id.data, c.get('auth').sub);
  if (!item) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
  return c.json({ data: serializeDefinition(item), meta: {}, error: null });
});

datasetRoutes.patch('/:id', requireScopes('datasets:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = definitionPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset update is invalid.', input.error?.issues || []);
  try {
    const [updated] = await db.update(datasetDefinitions).set({
      ...(input.data.name === undefined ? {} : { name: input.data.name }),
      ...(input.data.description === undefined ? {} : { description: input.data.description }),
      ...(input.data.filters === undefined ? {} : { filters: input.data.filters }),
      ...(input.data.manifest_format === undefined ? {} : { manifestFormat: input.data.manifest_format }),
      updatedAt: new Date(),
    }).where(and(eq(datasetDefinitions.id, id.data), eq(datasetDefinitions.createdBy, c.get('auth').sub), isNull(datasetDefinitions.deletedAt))).returning();
    if (!updated) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
    return c.json({ data: serializeDefinition(updated), meta: {}, error: null });
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'DATASET_NAME_CONFLICT', 'A dataset with this name already exists.');
    throw error;
  }
});

datasetRoutes.get('/:id/snapshots', requireScopes('datasets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset ID must be a UUID.');
  const definition = await ownedDefinition(id.data, c.get('auth').sub);
  if (!definition) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
  const items = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.definitionId, definition.id)).orderBy(desc(datasetSnapshots.createdAt));
  return c.json({ data: items.map(serializeSnapshot), meta: {}, error: null });
});

datasetRoutes.post('/:id/snapshots', requireScopes('datasets:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset ID must be a UUID.');
  const definition = await ownedDefinition(id.data, c.get('auth').sub);
  if (!definition) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
  const filters = definition.filters || {};
  const conditions = [isNull(records.deletedAt)];
  if (filters.statuses?.length) conditions.push(inArray(records.status, filters.statuses));
  if (filters.record_types?.length) conditions.push(inArray(records.recordType, filters.record_types));
  if (filters.language_codes?.length) conditions.push(inArray(records.languageCode, filters.language_codes));
  if (filters.minimum_quality_score !== undefined) conditions.push(gte(records.qualityScore, filters.minimum_quality_score));
  const snapshotId = crypto.randomUUID();
  const now = new Date();
  let frozen;
  try {
    frozen = await db.transaction(async (tx) => {
      const selectedRows = await tx.select({ record: records, version: recordVersions })
        .from(records).innerJoin(recordVersions, eq(records.currentVersionId, recordVersions.id))
        .where(and(...conditions)).orderBy(asc(records.id)).limit(MAX_SNAPSHOT_RECORDS + 1);
      if (selectedRows.length > MAX_SNAPSHOT_RECORDS) {
        const error = new Error(`Synchronous snapshots are limited to ${MAX_SNAPSHOT_RECORDS} records.`);
        error.code = 'SNAPSHOT_TOO_LARGE';
        throw error;
      }
      const [created] = await tx.insert(datasetSnapshots).values({
        id: snapshotId, definitionId: definition.id, definitionRevision: definition.updatedAt,
        filters: definition.filters, manifestFormat: definition.manifestFormat,
        recordCount: selectedRows.length, createdBy: c.get('auth').sub, createdAt: now,
      }).returning();
      if (selectedRows.length) await tx.insert(datasetSnapshotRecords).values(selectedRows.map(({ record, version }, index) => ({
        snapshotId, recordId: record.id, recordVersionId: version.id, ordinal: index + 1, createdAt: now,
      })));
      return { snapshot: created, rows: selectedRows };
    });
  } catch (error) {
    if (error?.code === 'SNAPSHOT_TOO_LARGE') return errorResponse(c, 413, 'SNAPSHOT_TOO_LARGE', error.message);
    throw error;
  }
  const { snapshot, rows } = frozen;
  const objectKey = `datasets/${c.get('auth').sub}/${definition.id}/${snapshot.id}/manifest.${snapshot.manifestFormat}`;
  try {
    const manifest = formatManifest(snapshot, definition, rows);
    await storeObject(objectKey, manifest, snapshot.manifestFormat === 'jsonl' ? 'application/x-ndjson' : 'application/json');
    const [completed] = await db.update(datasetSnapshots).set({
      status: 'completed', manifestObjectKey: objectKey, manifestHash: await sha256(manifest), completedAt: new Date(),
    }).where(eq(datasetSnapshots.id, snapshot.id)).returning();
    return c.json({ data: serializeSnapshot(completed), meta: {}, error: null }, 201);
  } catch (error) {
    const [failed] = await db.update(datasetSnapshots).set({ status: 'failed', errorMessage: String(error.message || error).slice(0, 2000), completedAt: new Date() })
      .where(eq(datasetSnapshots.id, snapshot.id)).returning();
    return c.json({ data: serializeSnapshot(failed), meta: {}, error: null }, 502);
  }
});

datasetRoutes.get('/:id/snapshots/:snapshotId', requireScopes('datasets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id')); const snapshotId = uuidSchema.safeParse(c.req.param('snapshotId'));
  if (!id.success || !snapshotId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset and snapshot IDs must be UUIDs.');
  const definition = await ownedDefinition(id.data, c.get('auth').sub);
  if (!definition) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
  const [snapshot] = await db.select().from(datasetSnapshots)
    .where(and(eq(datasetSnapshots.id, snapshotId.data), eq(datasetSnapshots.definitionId, definition.id))).limit(1);
  if (!snapshot) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset snapshot was not found.');
  const members = await db.select().from(datasetSnapshotRecords).where(eq(datasetSnapshotRecords.snapshotId, snapshot.id)).orderBy(asc(datasetSnapshotRecords.ordinal));
  return c.json({ data: { ...serializeSnapshot(snapshot), records: members.map((item) => ({ ordinal: item.ordinal, record_id: item.recordId, record_version_id: item.recordVersionId })) }, meta: {}, error: null });
});

datasetRoutes.get('/:id/snapshots/:snapshotId/manifest', requireScopes('datasets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id')); const snapshotId = uuidSchema.safeParse(c.req.param('snapshotId'));
  if (!id.success || !snapshotId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset and snapshot IDs must be UUIDs.');
  const definition = await ownedDefinition(id.data, c.get('auth').sub);
  if (!definition) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
  const [snapshot] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.id, snapshotId.data), eq(datasetSnapshots.definitionId, definition.id))).limit(1);
  if (!snapshot || snapshot.status !== 'completed' || !snapshot.manifestObjectKey) return errorResponse(c, 409, 'MANIFEST_NOT_READY', 'Dataset manifest is not ready.');
  const content = await readObject(snapshot.manifestObjectKey);
  c.header('Content-Type', snapshot.manifestFormat === 'jsonl' ? 'application/x-ndjson; charset=utf-8' : 'application/json; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="dataset-${definition.id}-${snapshot.id}.${snapshot.manifestFormat}"`);
  c.header('X-Content-SHA256', snapshot.manifestHash);
  return c.body(content);
});

export default datasetRoutes;
