import { Hono } from 'hono';
import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { requireRoles, requireUserAuth } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { auditLogs } from '../db/schema/index.js';

const actions = [
  'create', 'update', 'delete', 'restore',
  'submit_review', 'approve', 'reject', 'request_changes',
];
const resourceTypes = ['source', 'record'];
const uuidSchema = z.string().uuid();
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(500).optional(),
  action: z.enum(actions).optional(),
  resource_type: z.enum(resourceTypes).optional(),
  resource_id: z.string().uuid().optional(),
  actor_id: z.string().uuid().optional(),
  request_id: z.string().min(1).max(200).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
}).refine(
  (value) => !value.since || !value.until || new Date(value.since) <= new Date(value.until),
  { path: ['until'], message: 'until must be greater than or equal to since.' },
).refine(
  (value) => !value.resource_id || Boolean(value.resource_type),
  { path: ['resource_type'], message: 'resource_type is required with resource_id.' },
);

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

function serializeAuditLog(entry) {
  return {
    id: entry.id,
    actor_type: entry.actorType,
    actor_id: entry.actorId,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId,
    request_id: entry.requestId,
    ip_address: entry.ipAddress,
    user_agent: entry.userAgent,
    before_data: entry.beforeData,
    after_data: entry.afterData,
    metadata: entry.metadata,
    created_at: entry.createdAt,
  };
}

function encodeCursor(entry) {
  return Buffer.from(JSON.stringify({
    created_at: entry.createdAt.toISOString(),
    id: entry.id,
  })).toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const parsed = z.object({
      created_at: z.string().datetime({ offset: true }),
      id: z.string().uuid(),
    }).safeParse(decoded);
    if (!parsed.success) return null;
    return { createdAt: new Date(parsed.data.created_at), id: parsed.data.id };
  } catch {
    return null;
  }
}

const auditLogRoutes = new Hono();
auditLogRoutes.use('*', requireUserAuth, requireRoles('admin'));

auditLogRoutes.get('/', async (c) => {
  const queryResult = listQuerySchema.safeParse({
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
    action: c.req.query('action'),
    resource_type: c.req.query('resource_type'),
    resource_id: c.req.query('resource_id'),
    actor_id: c.req.query('actor_id'),
    request_id: c.req.query('request_id'),
    since: c.req.query('since'),
    until: c.req.query('until'),
  });
  if (!queryResult.success) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Audit log query is invalid.', queryResult.error.issues);
  }

  const query = queryResult.data;
  const cursor = decodeCursor(query.cursor);
  if (query.cursor && !cursor) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Audit log cursor is invalid.');
  }
  const conditions = [];
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.resource_type) conditions.push(eq(auditLogs.resourceType, query.resource_type));
  if (query.resource_id) conditions.push(eq(auditLogs.resourceId, query.resource_id));
  if (query.actor_id) conditions.push(eq(auditLogs.actorId, query.actor_id));
  if (query.request_id) conditions.push(eq(auditLogs.requestId, query.request_id));
  if (query.since) conditions.push(gte(auditLogs.createdAt, new Date(query.since)));
  if (query.until) conditions.push(lte(auditLogs.createdAt, new Date(query.until)));
  if (cursor) {
    conditions.push(or(
      lt(auditLogs.createdAt, cursor.createdAt),
      and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)),
    ));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(query.limit + 1);
  const hasMore = rows.length > query.limit;
  const entries = hasMore ? rows.slice(0, query.limit) : rows;

  return c.json({
    data: entries.map(serializeAuditLog),
    meta: {
      limit: query.limit,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(entries[entries.length - 1]) : null,
    },
    error: null,
  });
});

auditLogRoutes.get('/:id', async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Audit log ID must be a UUID.');
  const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.id, idResult.data)).limit(1);
  if (!entry) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Audit log was not found.');
  return c.json({ data: serializeAuditLog(entry), meta: {}, error: null });
});

export default auditLogRoutes;
