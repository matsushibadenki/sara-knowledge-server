import { Hono } from 'hono';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { records, sources } from '../db/schema/index.js';

const sourceTypes = [
  'manual', 'website', 'document', 'book', 'dataset', 'conversation',
  'sensor', 'generated', 'imported', 'wordpress',
];

const nullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();

const sourceInputSchema = z.object({
  source_type: z.enum(sourceTypes),
  title: z.string().max(1000).nullable().optional(),
  url: z.string().url().max(4000).nullable().optional(),
  author: z.string().max(500).nullable().optional(),
  publisher: z.string().max(500).nullable().optional(),
  published_at: nullableDateTimeSchema.optional(),
  retrieved_at: nullableDateTimeSchema.optional(),
  license_type: z.string().max(200).nullable().optional(),
  license_text: z.string().max(20000).nullable().optional(),
  copyright_status: z.string().max(100).nullable().optional(),
  content_hash: z.string().max(256).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const sourcePatchSchema = sourceInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one source field must be provided.' },
);

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  source_type: z.enum(sourceTypes).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

const uuidSchema = z.string().uuid();

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

export function serializeSource(source) {
  if (!source) return null;
  return {
    id: source.id,
    source_type: source.sourceType,
    title: source.title,
    url: source.url,
    author: source.author,
    publisher: source.publisher,
    published_at: source.publishedAt,
    retrieved_at: source.retrievedAt,
    license_type: source.licenseType,
    license_text: source.licenseText,
    copyright_status: source.copyrightStatus,
    content_hash: source.contentHash,
    metadata: source.metadata,
    created_by: source.createdBy,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
    deleted_at: source.deletedAt,
  };
}

function sourceValues(input) {
  return {
    ...(input.source_type === undefined ? {} : { sourceType: input.source_type }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(input.author === undefined ? {} : { author: input.author }),
    ...(input.publisher === undefined ? {} : { publisher: input.publisher }),
    ...(input.published_at === undefined ? {} : {
      publishedAt: input.published_at === null ? null : new Date(input.published_at),
    }),
    ...(input.retrieved_at === undefined ? {} : {
      retrievedAt: input.retrieved_at === null ? null : new Date(input.retrieved_at),
    }),
    ...(input.license_type === undefined ? {} : { licenseType: input.license_type }),
    ...(input.license_text === undefined ? {} : { licenseText: input.license_text }),
    ...(input.copyright_status === undefined ? {} : { copyrightStatus: input.copyright_status }),
    ...(input.content_hash === undefined ? {} : { contentHash: input.content_hash }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

async function findSource(id, includeDeleted = false) {
  const conditions = [eq(sources.id, id)];
  if (!includeDeleted) conditions.push(isNull(sources.deletedAt));
  const [source] = await db.select().from(sources).where(and(...conditions)).limit(1);
  return source;
}

const sourcesRoutes = new Hono();
sourcesRoutes.use('*', requireAuth);

sourcesRoutes.get('/', requireScopes('sources:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const queryResult = listQuerySchema.safeParse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
    source_type: c.req.query('source_type'),
    q: c.req.query('q'),
  });
  if (!queryResult.success) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Source query is invalid.', queryResult.error.issues);
  }

  const { page, limit, source_type: sourceType, q } = queryResult.data;
  const conditions = [isNull(sources.deletedAt)];
  if (sourceType) conditions.push(eq(sources.sourceType, sourceType));
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(
      ilike(sources.title, pattern),
      ilike(sources.url, pattern),
      ilike(sources.author, pattern),
      ilike(sources.publisher, pattern),
    ));
  }

  const where = and(...conditions);
  const [items, countResult] = await Promise.all([
    db.select().from(sources)
      .where(where)
      .orderBy(desc(sources.updatedAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ count: sql`count(*)::int` }).from(sources).where(where),
  ]);

  return c.json({
    data: items.map(serializeSource),
    meta: { page, limit, total: Number(countResult[0]?.count || 0) },
    error: null,
  });
});

sourcesRoutes.post('/', requireScopes('sources:write'), requireRoles('admin', 'editor'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = sourceInputSchema.safeParse(body);
  if (!result.success) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Source input is invalid.', result.error.issues);
  }

  const now = new Date();
  const [source] = await db.insert(sources).values({
    ...sourceValues(result.data),
    createdBy: c.get('auth').sub,
    createdAt: now,
    updatedAt: now,
  }).returning();

  return c.json({ data: serializeSource(source), meta: {}, error: null }, 201);
});

sourcesRoutes.get('/:id', requireScopes('sources:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Source ID must be a UUID.');
  const source = await findSource(idResult.data);
  if (!source) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Source was not found.');

  const [usage] = await db.select({ count: sql`count(*)::int` })
    .from(records)
    .where(and(eq(records.sourceId, source.id), isNull(records.deletedAt)));

  return c.json({
    data: serializeSource(source),
    meta: { active_record_count: Number(usage?.count || 0) },
    error: null,
  });
});

sourcesRoutes.patch('/:id', requireScopes('sources:write'), requireRoles('admin', 'editor'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Source ID must be a UUID.');
  const body = await c.req.json().catch(() => null);
  const result = sourcePatchSchema.safeParse(body);
  if (!result.success) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Source update is invalid.', result.error.issues);
  }

  const [source] = await db.update(sources)
    .set({ ...sourceValues(result.data), updatedAt: new Date() })
    .where(and(eq(sources.id, idResult.data), isNull(sources.deletedAt)))
    .returning();
  if (!source) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Source was not found.');

  return c.json({ data: serializeSource(source), meta: {}, error: null });
});

sourcesRoutes.delete('/:id', requireScopes('sources:write'), requireRoles('admin', 'editor'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Source ID must be a UUID.');
  const now = new Date();
  const [source] = await db.update(sources)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(sources.id, idResult.data), isNull(sources.deletedAt)))
    .returning();
  if (!source) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Source was not found.');

  return c.json({ data: serializeSource(source), meta: {}, error: null });
});

sourcesRoutes.post('/:id/restore', requireScopes('sources:write'), requireRoles('admin', 'editor'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Source ID must be a UUID.');
  const source = await findSource(idResult.data, true);
  if (!source) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Source was not found.');
  if (!source.deletedAt) return c.json({ data: serializeSource(source), meta: {}, error: null });

  const now = new Date();
  const [restored] = await db.update(sources)
    .set({ deletedAt: null, updatedAt: now })
    .where(eq(sources.id, source.id))
    .returning();

  return c.json({ data: serializeSource(restored), meta: {}, error: null });
});

export default sourcesRoutes;
