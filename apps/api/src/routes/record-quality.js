import { Hono } from 'hono';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  annotations,
  evaluations,
  recordReviews,
  records,
  recordTags,
  recordVersions,
  tags,
} from '../db/schema/index.js';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';
import { appendAuditLog, changedFields, recordAuditSnapshot } from '../services/audit.js';

const uuidSchema = z.string().uuid();
const tagInputSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
});
const annotationInputSchema = z.object({
  annotation_type: z.enum(['comment', 'correction', 'label', 'entity', 'relation']),
  payload: z.record(z.string(), z.unknown()),
});
const evaluationInputSchema = z.object({
  metric: z.string().trim().min(1).max(120),
  score: z.number().min(0).max(1).nullable().optional(),
  verdict: z.enum(['pass', 'fail', 'needs_review']),
  notes: z.string().max(4000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const submitReviewSchema = z.object({ note: z.string().max(4000).nullable().optional() });
const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  note: z.string().max(4000).nullable().optional(),
});
const queueQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

function normalizeTag(name) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('und');
}

async function lockActiveRecord(executor, id) {
  const [record] = await executor.select().from(records)
    .where(and(eq(records.id, id), isNull(records.deletedAt)))
    .limit(1).for('update');
  return record;
}

function serializeTag(tag) {
  return { id: tag.id, name: tag.name, normalized_name: tag.normalizedName };
}

function serializeAnnotation(item) {
  return {
    id: item.id,
    record_id: item.recordId,
    record_version_id: item.recordVersionId,
    annotation_type: item.annotationType,
    payload: item.payload,
    status: item.status,
    created_by: item.createdBy,
    resolved_by: item.resolvedBy,
    created_at: item.createdAt,
    resolved_at: item.resolvedAt,
  };
}

function serializeEvaluation(item) {
  return {
    id: item.id,
    record_id: item.recordId,
    record_version_id: item.recordVersionId,
    metric: item.metric,
    score: item.score,
    verdict: item.verdict,
    notes: item.notes,
    metadata: item.metadata,
    evaluated_by: item.evaluatedBy,
    created_at: item.createdAt,
  };
}

function serializeReview(item) {
  return {
    id: item.id,
    record_id: item.recordId,
    record_version_id: item.recordVersionId,
    status: item.status,
    submitted_by: item.submittedBy,
    reviewed_by: item.reviewedBy,
    submission_note: item.submissionNote,
    decision_note: item.decisionNote,
    submitted_at: item.submittedAt,
    reviewed_at: item.reviewedAt,
  };
}

const recordQualityRoutes = new Hono();
recordQualityRoutes.use('*', requireAuth);

recordQualityRoutes.get('/:id/tags', requireScopes('records:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const [record] = await db.select({ id: records.id }).from(records)
    .where(and(eq(records.id, id.data), isNull(records.deletedAt))).limit(1);
  if (!record) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');
  const items = await db.select({ tag: tags }).from(recordTags)
    .innerJoin(tags, eq(recordTags.tagId, tags.id))
    .where(eq(recordTags.recordId, id.data)).orderBy(asc(tags.normalizedName));
  return c.json({ data: items.map(({ tag }) => serializeTag(tag)), meta: {}, error: null });
});

recordQualityRoutes.post('/:id/tags', requireScopes('records:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = tagInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Tag input is invalid.', input.error?.issues || []);
  const auth = c.get('auth');
  const uniqueTags = [...new Map(input.data.tags.map((name) => [normalizeTag(name), name])).entries()];
  const result = await db.transaction(async (tx) => {
    const record = await lockActiveRecord(tx, id.data);
    if (!record) return null;
    const assigned = [];
    for (const [normalizedName, name] of uniqueTags) {
      await tx.insert(tags).values({ name, normalizedName, createdBy: auth.sub }).onConflictDoNothing();
      const [tag] = await tx.select().from(tags).where(eq(tags.normalizedName, normalizedName)).limit(1);
      await tx.insert(recordTags).values({ recordId: record.id, tagId: tag.id, assignedBy: auth.sub }).onConflictDoNothing();
      assigned.push(tag);
    }
    return assigned;
  });
  if (!result) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');
  return c.json({ data: result.map(serializeTag), meta: {}, error: null }, 201);
});

recordQualityRoutes.delete('/:id/tags/:tagId', requireScopes('records:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const tagId = uuidSchema.safeParse(c.req.param('tagId'));
  if (!id.success || !tagId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record and tag IDs must be UUIDs.');
  const deleted = await db.delete(recordTags)
    .where(and(eq(recordTags.recordId, id.data), eq(recordTags.tagId, tagId.data))).returning();
  if (!deleted.length) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Tag assignment was not found.');
  return c.json({ data: { removed: true }, meta: {}, error: null });
});

recordQualityRoutes.get('/:id/annotations', requireScopes('records:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const items = await db.select().from(annotations).where(eq(annotations.recordId, id.data)).orderBy(desc(annotations.createdAt));
  return c.json({ data: items.map(serializeAnnotation), meta: {}, error: null });
});

recordQualityRoutes.post('/:id/annotations', requireScopes('records:write'), requireRoles('admin', 'editor', 'reviewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = annotationInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Annotation input is invalid.', input.error?.issues || []);
  const auth = c.get('auth');
  const created = await db.transaction(async (tx) => {
    const record = await lockActiveRecord(tx, id.data);
    if (!record) return null;
    const [item] = await tx.insert(annotations).values({
      recordId: record.id,
      recordVersionId: record.currentVersionId,
      annotationType: input.data.annotation_type,
      payload: input.data.payload,
      createdBy: auth.sub,
    }).returning();
    return item;
  });
  if (!created) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');
  return c.json({ data: serializeAnnotation(created), meta: {}, error: null }, 201);
});

recordQualityRoutes.post('/:id/annotations/:annotationId/resolve', requireScopes('records:write'), requireRoles('admin', 'editor', 'reviewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const annotationId = uuidSchema.safeParse(c.req.param('annotationId'));
  if (!id.success || !annotationId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record and annotation IDs must be UUIDs.');
  const [item] = await db.update(annotations).set({ status: 'resolved', resolvedBy: c.get('auth').sub, resolvedAt: new Date() })
    .where(and(eq(annotations.id, annotationId.data), eq(annotations.recordId, id.data), eq(annotations.status, 'active'))).returning();
  if (!item) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Active annotation was not found.');
  return c.json({ data: serializeAnnotation(item), meta: {}, error: null });
});

recordQualityRoutes.get('/:id/evaluations', requireScopes('records:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const items = await db.select().from(evaluations).where(eq(evaluations.recordId, id.data)).orderBy(desc(evaluations.createdAt));
  return c.json({ data: items.map(serializeEvaluation), meta: {}, error: null });
});

recordQualityRoutes.post('/:id/evaluations', requireScopes('records:write'), requireRoles('admin', 'editor', 'reviewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = evaluationInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Evaluation input is invalid.', input.error?.issues || []);
  const created = await db.transaction(async (tx) => {
    const record = await lockActiveRecord(tx, id.data);
    if (!record) return null;
    const [item] = await tx.insert(evaluations).values({
      recordId: record.id,
      recordVersionId: record.currentVersionId,
      metric: input.data.metric,
      score: input.data.score ?? null,
      verdict: input.data.verdict,
      notes: input.data.notes ?? null,
      metadata: input.data.metadata || {},
      evaluatedBy: c.get('auth').sub,
    }).returning();
    return item;
  });
  if (!created) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');
  return c.json({ data: serializeEvaluation(created), meta: {}, error: null }, 201);
});

recordQualityRoutes.post('/:id/submit-review', requireScopes('records:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = submitReviewSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Review submission is invalid.', input.error?.issues || []);
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const record = await lockActiveRecord(tx, id.data);
    if (!record) return { error: 'not_found' };
    const [pending] = await tx.select().from(recordReviews)
      .where(and(eq(recordReviews.recordId, record.id), eq(recordReviews.status, 'pending'))).limit(1);
    if (pending) return { error: 'already_pending' };
    const [version] = await tx.select().from(recordVersions).where(eq(recordVersions.id, record.currentVersionId)).limit(1);
    const [review] = await tx.insert(recordReviews).values({
      recordId: record.id,
      recordVersionId: record.currentVersionId,
      submittedBy: c.get('auth').sub,
      submissionNote: input.data.note ?? null,
      submittedAt: now,
    }).returning();
    const [updatedRecord] = await tx.update(records).set({ status: 'pending_review', updatedAt: now })
      .where(eq(records.id, record.id)).returning();
    const beforeData = recordAuditSnapshot(record, version);
    const afterData = recordAuditSnapshot(updatedRecord, version);
    await appendAuditLog(tx, c, {
      action: 'submit_review', resourceType: 'record', resourceId: record.id,
      beforeData, afterData,
      metadata: { review_id: review.id, changed_fields: changedFields(beforeData, afterData) }, createdAt: now,
    });
    return { review };
  });
  if (outcome.error === 'not_found') return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');
  if (outcome.error === 'already_pending') return errorResponse(c, 409, 'REVIEW_ALREADY_PENDING', 'A review is already pending for this record.');
  return c.json({ data: serializeReview(outcome.review), meta: {}, error: null }, 201);
});

recordQualityRoutes.get('/:id/reviews', requireScopes('records:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Record ID must be a UUID.');
  const items = await db.select().from(recordReviews).where(eq(recordReviews.recordId, id.data)).orderBy(desc(recordReviews.submittedAt));
  return c.json({ data: items.map(serializeReview), meta: {}, error: null });
});

recordQualityRoutes.post('/:id/reviews/:reviewId/decision', requireScopes('records:approve'), requireRoles('admin', 'reviewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const reviewId = uuidSchema.safeParse(c.req.param('reviewId'));
  const input = decisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !reviewId.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Review decision is invalid.', input.error?.issues || []);
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const record = await lockActiveRecord(tx, id.data);
    if (!record) return { error: 'not_found' };
    const [review] = await tx.select().from(recordReviews)
      .where(and(eq(recordReviews.id, reviewId.data), eq(recordReviews.recordId, record.id))).limit(1).for('update');
    if (!review || review.status !== 'pending') return { error: 'not_pending' };
    if (review.recordVersionId !== record.currentVersionId) return { error: 'stale_version' };
    const [version] = await tx.select().from(recordVersions).where(eq(recordVersions.id, record.currentVersionId)).limit(1);
    const [decided] = await tx.update(recordReviews).set({
      status: input.data.decision,
      reviewedBy: c.get('auth').sub,
      decisionNote: input.data.note ?? null,
      reviewedAt: now,
    }).where(eq(recordReviews.id, review.id)).returning();
    const recordStatus = input.data.decision === 'approved'
      ? 'approved'
      : input.data.decision === 'rejected' ? 'rejected' : 'draft';
    const [updatedRecord] = await tx.update(records).set({ status: recordStatus, updatedAt: now })
      .where(eq(records.id, record.id)).returning();
    const beforeData = recordAuditSnapshot(record, version);
    const afterData = recordAuditSnapshot(updatedRecord, version);
    const action = input.data.decision === 'approved'
      ? 'approve' : input.data.decision === 'rejected' ? 'reject' : 'request_changes';
    await appendAuditLog(tx, c, {
      action, resourceType: 'record', resourceId: record.id,
      beforeData, afterData,
      metadata: { review_id: review.id, changed_fields: changedFields(beforeData, afterData) }, createdAt: now,
    });
    return { review: decided };
  });
  if (outcome.error === 'not_found') return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Record was not found.');
  if (outcome.error === 'not_pending') return errorResponse(c, 409, 'REVIEW_NOT_PENDING', 'The review is not pending.');
  if (outcome.error === 'stale_version') return errorResponse(c, 409, 'REVIEW_VERSION_STALE', 'The record changed after review submission.');
  return c.json({ data: serializeReview(outcome.review), meta: {}, error: null });
});

export const reviewQueueRoutes = new Hono();
reviewQueueRoutes.use('*', requireAuth, requireScopes('records:approve'), requireRoles('admin', 'reviewer'));
reviewQueueRoutes.get('/', async (c) => {
  const query = queueQuerySchema.safeParse({ limit: c.req.query('limit') });
  if (!query.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Review queue query is invalid.', query.error.issues);
  const items = await db.select({ review: recordReviews, record: records })
    .from(recordReviews).innerJoin(records, eq(recordReviews.recordId, records.id))
    .where(and(eq(recordReviews.status, 'pending'), isNull(records.deletedAt)))
    .orderBy(asc(recordReviews.submittedAt), asc(recordReviews.id)).limit(query.data.limit);
  return c.json({
    data: items.map(({ review, record }) => ({
      ...serializeReview(review),
      record: { id: record.id, title: record.title, record_type: record.recordType, status: record.status },
    })),
    meta: { limit: query.data.limit }, error: null,
  });
});

export default recordQualityRoutes;
