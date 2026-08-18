// /apps/api/src/routes/records.js
import { Hono } from 'hono';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { recordVersions, records } from '../db/schema/index.js';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';

const recordTypes = [
  'plain_text', 'instruction', 'qa', 'chat', 'sharegpt', 'chatml',
  'dpo', 'rlhf', 'classification', 'image_caption', 'multimodal',
  'event_sequence', 'custom',
];

const recordStatuses = ['draft', 'pending_review', 'approved', 'rejected', 'archived'];

const recordInputSchema = z.object({
  record_type: z.enum(recordTypes),
  title: z.string().max(500).nullable().optional(),
  status: z.enum(recordStatuses).optional(),
  language_code: z.string().max(20).nullable().optional(),
  quality_score: z.number().min(0).max(1).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  source_id: z.string().uuid().nullable().optional(),
  content: z.unknown().refine((value) => value !== undefined, 'content is required'),
  plain_text: z.string().nullable().optional(),
  schema_version: z.string().max(50).optional(),
  change_summary: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const recordPatchSchema = recordInputSchema.partial().extend({
  expected_version: z.number().int().positive(),
}).refine(
  (value) => Object.keys(value).some((key) => key !== 'expected_version'),
  { message: 'At least one record field must be provided.' },
);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(recordStatuses).optional(),
  record_type: z.enum(recordTypes).optional(),
});

const uuidSchema = z.string().uuid();

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

function serializeRecord(record, version = null) {
  return {
    id: record.id,
    record_type: record.recordType,
    title: record.title,
    status: record.status,
    current_version_id: record.currentVersionId,
    language_code: record.languageCode,
    quality_score: record.qualityScore,
    confidence: record.confidence,
    source_id: record.sourceId,
    owner_id: record.ownerId,
    external_system: record.externalSystem,
    external_id: record.externalId,
    metadata: record.metadata,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt,
    ...(version ? {
      current_version: {
        id: version.id,
        version_number: version.versionNumber,
        schema_version: version.schemaVersion,
        content: version.content,
        plain_text: version.plainText,
        change_summary: version.changeSummary,
        created_by: version.createdBy,
        created_at: version.createdAt,
      },
    } : {}),
  };
}

function serializeVersion(version) {
  return {
    id: version.id,
    record_id: version.recordId,
    version_number: version.versionNumber,
    schema_version: version.schemaVersion,
    content: version.content,
    plain_text: version.plainText,
    change_summary: version.changeSummary,
    created_by: version.createdBy,
    created_at: version.createdAt,
    is_current: version.isCurrent,
  };
}

async function findRecord(id, includeDeleted = false) {
  const conditions = [eq(records.id, id)];
  if (!includeDeleted) conditions.push(isNull(records.deletedAt));
  const [record] = await db.select().from(records).where(and(...conditions)).limit(1);
  return record;
}

const recordsRoutes = new Hono();
recordsRoutes.use('*', requireAuth);

recordsRoutes.get('/', requireScopes('records:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const queryResult = listQuerySchema.safeParse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    status: c.req.query('status'),
    record_type: c.req.query('record_type'),
  });
  if (!queryResult.success) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record query is invalid.', queryResult.error.issues);
  }

  const { page, limit, status, record_type: recordType } = queryResult.data;
  const offset = (page - 1) * limit;
  const conditions = [isNull(records.deletedAt)];

  if (status) conditions.push(eq(records.status, status));
  if (recordType) conditions.push(eq(records.recordType, recordType));

  const [items, countResult] = await Promise.all([
    db.select().from(records)
      .where(and(...conditions))
      .orderBy(desc(records.updatedAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`count(*)::int` }).from(records).where(and(...conditions)),
  ]);

  return c.json({
    data: items.map((record) => serializeRecord(record)),
    meta: {
      page,
      limit,
      total: Number(countResult[0]?.count || 0),
    },
    error: null,
  });
});

recordsRoutes.post('/', requireScopes('records:write'), requireRoles('admin', 'editor'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = recordInputSchema.safeParse(body);

  if (!result.success) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record input is invalid.', result.error.issues);
  }

  const auth = c.get('auth');
  const recordId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date();
  const input = result.data;

  const created = await db.transaction(async (tx) => {
    const [record] = await tx.insert(records).values({
      id: recordId,
      recordType: input.record_type,
      title: input.title ?? null,
      status: input.status || 'draft',
      currentVersionId: null,
      languageCode: input.language_code ?? null,
      qualityScore: input.quality_score ?? null,
      confidence: input.confidence ?? null,
      sourceId: input.source_id ?? null,
      ownerId: auth.sub,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    }).returning();

    const [version] = await tx.insert(recordVersions).values({
      id: versionId,
      recordId,
      versionNumber: 1,
      schemaVersion: input.schema_version || '1.0',
      content: input.content,
      plainText: input.plain_text ?? null,
      changeSummary: input.change_summary ?? 'Initial version',
      createdBy: auth.sub,
      createdAt: now,
      updatedAt: now,
      isCurrent: true,
    }).returning();

    const [currentRecord] = await tx.update(records)
      .set({ currentVersionId: versionId })
      .where(eq(records.id, recordId))
      .returning();

    return { record: currentRecord || record, version };
  });

  return c.json({ data: serializeRecord(created.record, created.version), meta: {}, error: null }, 201);
});

recordsRoutes.get('/:id', requireScopes('records:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const record = await findRecord(idResult.data);
  if (!record) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');

  const [version] = await db.select()
    .from(recordVersions)
    .where(eq(recordVersions.id, record.currentVersionId))
    .limit(1);

  return c.json({ data: serializeRecord(record, version), meta: {}, error: null });
});

recordsRoutes.get('/:id/versions', requireScopes('records:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const record = await findRecord(idResult.data);
  if (!record) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');

  const versions = await db.select()
    .from(recordVersions)
    .where(and(eq(recordVersions.recordId, record.id), isNull(recordVersions.deletedAt)))
    .orderBy(desc(recordVersions.versionNumber));

  return c.json({ data: versions.map(serializeVersion), meta: {}, error: null });
});

recordsRoutes.patch('/:id', requireScopes('records:write'), requireRoles('admin', 'editor'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const body = await c.req.json().catch(() => null);
  const result = recordPatchSchema.safeParse(body);
  if (!result.success) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record update is invalid.', result.error.issues);
  }

  const auth = c.get('auth');
  const input = result.data;
  const nextVersionId = crypto.randomUUID();
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [record] = await tx.select()
      .from(records)
      .where(and(eq(records.id, idResult.data), isNull(records.deletedAt)))
      .limit(1)
      .for('update');
    if (!record) return { error: 'not_found' };

    const [currentVersion] = await tx.select()
      .from(recordVersions)
      .where(eq(recordVersions.id, record.currentVersionId))
      .limit(1);
    if (!currentVersion || currentVersion.versionNumber !== input.expected_version) {
      return { error: 'conflict', currentVersion: currentVersion?.versionNumber || null };
    }

    await tx.update(recordVersions)
      .set({ isCurrent: false, updatedAt: now })
      .where(eq(recordVersions.id, currentVersion.id));

    const [version] = await tx.insert(recordVersions).values({
      id: nextVersionId,
      recordId: record.id,
      versionNumber: currentVersion.versionNumber + 1,
      schemaVersion: input.schema_version || currentVersion.schemaVersion,
      content: input.content === undefined ? currentVersion.content : input.content,
      plainText: input.plain_text === undefined ? currentVersion.plainText : input.plain_text,
      changeSummary: input.change_summary ?? null,
      createdBy: auth.sub,
      createdAt: now,
      updatedAt: now,
      isCurrent: true,
    }).returning();

    const [nextRecord] = await tx.update(records)
      .set({
        ...(input.record_type === undefined ? {} : { recordType: input.record_type }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.language_code === undefined ? {} : { languageCode: input.language_code }),
        ...(input.quality_score === undefined ? {} : { qualityScore: input.quality_score }),
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        ...(input.source_id === undefined ? {} : { sourceId: input.source_id }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        currentVersionId: nextVersionId,
        updatedAt: now,
      })
      .where(eq(records.id, record.id))
      .returning();

    return { record: nextRecord, version };
  });

  if (updated.error === 'not_found') {
    return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');
  }
  if (updated.error === 'conflict') {
    return errorResponse(c, 409, 'VERSION_CONFLICT', 'Record version is not current.', {
      expected_version: input.expected_version,
      current_version: updated.currentVersion,
    });
  }

  return c.json({ data: serializeRecord(updated.record, updated.version), meta: {}, error: null });
});

recordsRoutes.delete('/:id', requireScopes('records:write'), requireRoles('admin', 'editor'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const record = await findRecord(idResult.data);
  if (!record) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');

  const now = new Date();
  const [deleted] = await db.update(records)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(records.id, record.id))
    .returning();

  return c.json({ data: serializeRecord(deleted), meta: {}, error: null });
});

recordsRoutes.post('/:id/restore', requireScopes('records:write'), requireRoles('admin', 'editor'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const record = await findRecord(idResult.data, true);
  if (!record) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');
  if (!record.deletedAt) return c.json({ data: serializeRecord(record), meta: {}, error: null });

  const now = new Date();
  const [restored] = await db.update(records)
    .set({ deletedAt: null, updatedAt: now })
    .where(eq(records.id, record.id))
    .returning();

  return c.json({ data: serializeRecord(restored), meta: {}, error: null });
});

export default recordsRoutes;
