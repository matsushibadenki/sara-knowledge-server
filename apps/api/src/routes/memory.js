import { Hono } from 'hono';
import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  memoryEventAsyncSchema,
  memoryEventBulkSchema,
  memoryEventSchema,
  memoryEventValues,
} from '@sara-knowledge/domain-contracts/memory-events';
import { requireAuth, requireRoles, requireScopes, requireUserAuth } from '../auth/middleware.js';
import { requireSignedApiKeyRequest } from '../auth/hmac.js';
import { db } from '../db/client.js';
import {
  memoryConcepts,
  memoryEntities,
  memoryEntityAliases,
  memoryEventIngestionBatches,
  memoryEventIngestionJobs,
  memoryEvents,
  memoryExperiences,
  memoryRelationEvidence,
  memoryRelations,
  memoryVerificationDecisions,
  sources,
} from '../db/schema/index.js';
import { enqueueBackgroundJob, storeObject } from '../services/background-jobs.js';
import { findAccessibleResource } from '../services/resource-access.js';

const uuidSchema = z.string().uuid();
const jsonObject = z.record(z.string(), z.unknown());
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const verificationState = z.enum(['unverified', 'candidate', 'verified', 'rejected']);
const initialVerificationState = z.enum(['unverified', 'candidate']);
const probability = z.number().finite().min(0).max(1);
const nullableDate = z.coerce.date().nullable().optional();

const experienceSchema = z.object({
  experience_uid: z.string().trim().min(1).max(200),
  source_id: uuidSchema.nullable().optional(),
  title: z.string().max(1000).nullable().optional(),
  state_before: jsonObject.nullable().optional(),
  event_summary: jsonObject.default({}),
  state_after: jsonObject.nullable().optional(),
  reward: z.number().finite().default(0),
  prediction_error: z.number().finite().default(0),
  quality_score: probability.default(0.5),
  curriculum_level: z.string().trim().min(1).max(100).default('raw'),
  split_name: z.enum(['unsplit', 'train', 'validation', 'test', 'holdout', 'custom']).default('unsplit'),
  metadata: jsonObject.default({}),
});
const entitySchema = z.object({
  entity_uid: z.string().trim().min(1).max(200),
  entity_type: z.string().trim().min(1).max(200),
  canonical_name: z.string().max(1000).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  properties: jsonObject.default({}),
  confidence: probability.default(0.5),
  verification_state: initialVerificationState.default('unverified'),
  proposal_source: z.string().trim().min(1).max(200),
  source_id: uuidSchema.nullable().optional(),
});
const conceptSchema = z.object({
  concept_uid: z.string().trim().min(1).max(200),
  label: z.string().max(1000).nullable().optional(),
  concept_type: z.string().trim().min(1).max(200),
  description: z.string().max(10000).nullable().optional(),
  evidence_count: z.number().int().min(0).max(2147483647).default(0),
  contradiction_count: z.number().int().min(0).max(2147483647).default(0),
  verification_state: initialVerificationState.default('unverified'),
  proposal_source: z.string().trim().min(1).max(200),
  utility_score: z.number().finite().default(0),
  event_pattern: jsonObject.nullable().optional(),
  payload: jsonObject.default({}),
  source_id: uuidSchema.nullable().optional(),
});
const nodeType = z.enum(['event', 'experience', 'entity', 'concept', 'record', 'dataset_snapshot', 'model']);
const relationSchema = z.object({
  relation_uid: z.string().trim().min(1).max(200),
  source_type: nodeType,
  source_id: uuidSchema,
  relation_type: z.string().trim().min(1).max(200),
  target_type: nodeType,
  target_id: uuidSchema,
  strength: probability.default(0.5),
  confidence: probability.default(0.5),
  evidence_count: z.number().int().min(0).max(2147483647).default(0),
  counterexample_count: z.number().int().min(0).max(2147483647).default(0),
  min_delay_ms: z.number().finite().min(0).nullable().optional(),
  max_delay_ms: z.number().finite().min(0).nullable().optional(),
  valid_from: nullableDate,
  valid_until: nullableDate,
  expires_at: nullableDate,
  verification_state: initialVerificationState.default('unverified'),
  proposal_source: z.string().trim().min(1).max(200),
  context: jsonObject.default({}),
  payload: jsonObject.default({}),
});
const aliasSchema = z.object({
  alias: z.string().trim().min(1).max(1000),
  language_code: z.string().trim().min(1).max(20).default('und'),
  alias_type: z.string().trim().min(1).max(100).default('name'),
  confidence: probability.default(0.5),
  proposal_source: z.string().trim().min(1).max(200),
  verification_state: initialVerificationState.default('unverified'),
});
const evidenceSchema = z.object({
  expected_revision: z.number().int().positive(),
  evidence_uid: z.string().trim().min(1).max(200),
  evidence_type: z.string().trim().min(1).max(200),
  reference_type: z.enum(['source', 'record', 'event', 'experience', 'entity', 'concept', 'dataset_snapshot', 'model', 'external']),
  reference_id: uuidSchema.nullable().optional(),
  supports: z.boolean(),
  weight: z.number().finite().positive().max(1000000).default(1),
  details: jsonObject.default({}),
}).superRefine((value, ctx) => {
  if (value.reference_type === 'external' && value.reference_id != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reference_id'], message: 'External evidence must not use reference_id.' });
  if (value.reference_type !== 'external' && !value.reference_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reference_id'], message: 'Internal evidence requires reference_id.' });
});
const verificationSchema = z.object({
  expected_revision: z.number().int().positive(),
  expected_state: verificationState,
  state: z.enum(['candidate', 'verified', 'rejected']),
  notes: z.string().max(10000).nullable().optional(),
  metadata: jsonObject.default({}),
}).refine((value) => value.expected_state !== value.state, { path: ['state'], message: 'Verification state must change.' });
const traverseSchema = z.object({
  start_nodes: z.array(z.object({ type: nodeType, id: uuidSchema }).strict()).min(1).max(10),
  relation_types: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  verification_states: z.array(verificationState).min(1).max(4).default(['candidate', 'verified']),
  direction: z.enum(['outgoing', 'incoming', 'both']).default('both'),
  max_depth: z.number().int().min(1).max(5).default(2),
  max_nodes: z.number().int().min(1).max(200).default(100),
  max_edges: z.number().int().min(1).max(2000).default(500),
  min_confidence: probability.default(0),
}).strict();

function patchSchema(schema) {
  return schema.strict().partial().extend({
    expected_revision: z.number().int().positive(),
  }).refine((value) => Object.keys(value).some((key) => key !== 'expected_revision'), 'At least one mutable field is required.');
}

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

const common = (item) => ({
  id: item.id, revision: item.revision, created_by: item.createdBy, created_at: item.createdAt,
  updated_at: item.updatedAt, deleted_at: item.deletedAt,
});
const serializers = {
  experience: (item) => ({ ...common(item), experience_uid: item.experienceUid, source_id: item.sourceId, title: item.title, state_before: item.stateBefore, event_summary: item.eventSummary, state_after: item.stateAfter, reward: item.reward, prediction_error: item.predictionError, quality_score: item.qualityScore, curriculum_level: item.curriculumLevel, split_name: item.splitName, metadata: item.metadata }),
  event: (item) => ({ ...common(item), event_uid: item.eventUid, source_id: item.sourceId, experience_id: item.experienceId, ingestion_batch_id: item.ingestionBatchId, batch_position: item.batchPosition, occurred_at: item.occurredAt, sequence_time: item.sequenceTime, duration: item.duration, modality: item.modality, channel: item.channel, event_type: item.eventType, symbol: item.symbol, payload: item.payload, state_before: item.stateBefore, state_after: item.stateAfter, reward: item.reward, prediction_error: item.predictionError, confidence: item.confidence, quality_score: item.qualityScore, proposal_source: item.proposalSource, extractor_name: item.extractorName, extractor_version: item.extractorVersion, verification_state: item.verificationState, source_hash: item.sourceHash, novelty: item.novelty, priority_score: item.priorityScore, metadata: item.metadata }),
  entity: (item) => ({ ...common(item), entity_uid: item.entityUid, entity_type: item.entityType, canonical_name: item.canonicalName, description: item.description, properties: item.properties, confidence: item.confidence, verification_state: item.verificationState, proposal_source: item.proposalSource, source_id: item.sourceId }),
  concept: (item) => ({ ...common(item), concept_uid: item.conceptUid, label: item.label, concept_type: item.conceptType, description: item.description, evidence_count: item.evidenceCount, contradiction_count: item.contradictionCount, verification_state: item.verificationState, proposal_source: item.proposalSource, utility_score: item.utilityScore, event_pattern: item.eventPattern, payload: item.payload, source_id: item.sourceId }),
  relation: (item) => ({ ...common(item), relation_uid: item.relationUid, source_type: item.sourceType, source_id: item.sourceId, relation_type: item.relationType, target_type: item.targetType, target_id: item.targetId, strength: item.strength, confidence: item.confidence, evidence_count: item.evidenceCount, counterexample_count: item.counterexampleCount, min_delay_ms: item.minDelayMs, max_delay_ms: item.maxDelayMs, valid_from: item.validFrom, valid_until: item.validUntil, expires_at: item.expiresAt, verification_state: item.verificationState, proposal_source: item.proposalSource, context: item.context, payload: item.payload }),
};
const serializeAlias = (item) => ({ ...common(item), entity_id: item.entityId, alias: item.alias, normalized_alias: item.normalizedAlias, language_code: item.languageCode, alias_type: item.aliasType, confidence: item.confidence, proposal_source: item.proposalSource, verification_state: item.verificationState });
const serializeEvidence = (item) => ({ id: item.id, evidence_uid: item.evidenceUid, relation_id: item.relationId, evidence_type: item.evidenceType, reference_type: item.referenceType, reference_id: item.referenceId, supports: item.supports, weight: item.weight, details: item.details, created_by: item.createdBy, created_at: item.createdAt });
const serializeDecision = (item) => ({ id: item.id, target_type: item.targetType, target_id: item.targetId, target_revision: item.targetRevision, target_snapshot: item.targetSnapshot, from_state: item.fromState, to_state: item.toState, notes: item.notes, metadata: item.metadata, decided_by: item.decidedBy, created_at: item.createdAt });
const serializeEventJob = (item) => ({
  id: item.id, batch_uid: item.batchUid, content_hash: item.contentHash, status: item.status,
  event_count: item.eventCount, processed_count: item.processedCount,
  cancel_requested: item.cancelRequested, ingestion_batch_id: item.ingestionBatchId,
  error_message: item.errorMessage, created_at: item.createdAt,
  started_at: item.startedAt, completed_at: item.completedAt,
});

const mappings = {
  experience: (v) => ({ experienceUid: v.experience_uid, sourceId: v.source_id ?? null, title: v.title ?? null, stateBefore: v.state_before ?? null, eventSummary: v.event_summary, stateAfter: v.state_after ?? null, reward: v.reward, predictionError: v.prediction_error, qualityScore: v.quality_score, curriculumLevel: v.curriculum_level, splitName: v.split_name, metadata: v.metadata }),
  event: memoryEventValues,
  entity: (v) => ({ entityUid: v.entity_uid, entityType: v.entity_type, canonicalName: v.canonical_name ?? null, description: v.description ?? null, properties: v.properties, confidence: v.confidence, verificationState: v.verification_state, proposalSource: v.proposal_source, sourceId: v.source_id ?? null }),
  concept: (v) => ({ conceptUid: v.concept_uid, label: v.label ?? null, conceptType: v.concept_type, description: v.description ?? null, evidenceCount: v.evidence_count, contradictionCount: v.contradiction_count, verificationState: v.verification_state, proposalSource: v.proposal_source, utilityScore: v.utility_score, eventPattern: v.event_pattern ?? null, payload: v.payload, sourceId: v.source_id ?? null }),
  relation: (v) => ({ relationUid: v.relation_uid, sourceType: v.source_type, sourceId: v.source_id, relationType: v.relation_type, targetType: v.target_type, targetId: v.target_id, strength: v.strength, confidence: v.confidence, evidenceCount: v.evidence_count, counterexampleCount: v.counterexample_count, minDelayMs: v.min_delay_ms ?? null, maxDelayMs: v.max_delay_ms ?? null, validFrom: v.valid_from ?? null, validUntil: v.valid_until ?? null, expiresAt: v.expires_at ?? null, verificationState: v.verification_state, proposalSource: v.proposal_source, context: v.context, payload: v.payload }),
};

async function activeResource(table, id) {
  const [item] = await db.select().from(table).where(and(eq(table.id, id), isNull(table.deletedAt))).limit(1);
  return item;
}

async function validateSource(sourceId, ownerId) {
  if (!sourceId) return true;
  return Boolean(await findAccessibleResource(db, 'source', sourceId, ownerId));
}

async function validateNode(type, id, ownerId) {
  return Boolean(await findAccessibleResource(db, type, id, ownerId));
}

async function nodeIsInUse(type, id) {
  const [relation] = await db.select({ id: memoryRelations.id }).from(memoryRelations).where(and(
    isNull(memoryRelations.deletedAt),
    or(
      and(eq(memoryRelations.sourceType, type), eq(memoryRelations.sourceId, id)),
      and(eq(memoryRelations.targetType, type), eq(memoryRelations.targetId, id)),
    ),
  )).limit(1);
  if (relation) return true;
  if (type === 'experience') {
    const [event] = await db.select({ id: memoryEvents.id }).from(memoryEvents)
      .where(and(eq(memoryEvents.experienceId, id), isNull(memoryEvents.deletedAt))).limit(1);
    return Boolean(event);
  }
  if (type === 'entity') {
    const [alias] = await db.select({ id: memoryEntityAliases.id }).from(memoryEntityAliases)
      .where(and(eq(memoryEntityAliases.entityId, id), isNull(memoryEntityAliases.deletedAt))).limit(1);
    return Boolean(alias);
  }
  return false;
}

const memoryRoutes = new Hono();
memoryRoutes.use('*', requireAuth);

function registerCrud({ path, singular, table, schema, updateSchema, mapper, validate }) {
  const serialize = serializers[singular];
  memoryRoutes.get(`/${path}`, requireScopes('memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
    const query = listSchema.safeParse({ limit: c.req.query('limit') });
    if (!query.success) return errorResponse(c, 400, 'VALIDATION_ERROR', `${singular} query is invalid.`, query.error.issues);
    const items = await db.select().from(table).where(isNull(table.deletedAt))
      .orderBy(desc(table.createdAt), desc(table.id)).limit(query.data.limit);
    return c.json({ data: items.map(serialize), meta: { limit: query.data.limit }, error: null });
  });

  memoryRoutes.post(`/${path}`, requireScopes('memory:write'), requireRoles('admin', 'editor'), async (c) => {
    const input = schema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', `${singular} is invalid.`, input.error.issues);
    const ownerId = c.get('auth').sub;
    const validationError = validate ? await validate(input.data, null, ownerId) : null;
    if (validationError) return errorResponse(c, validationError.status, validationError.code, validationError.message);
    try {
      const [created] = await db.insert(table).values({ ...mapper(input.data), createdBy: ownerId }).returning();
      return c.json({ data: serialize(created), meta: {}, error: null }, 201);
    } catch (error) {
      if (error?.code === '23505') return errorResponse(c, 409, 'UID_CONFLICT', `This ${singular}_uid already exists.`);
      throw error;
    }
  });

  memoryRoutes.get(`/${path}/:id`, requireScopes('memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
    const id = uuidSchema.safeParse(c.req.param('id'));
    if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', `${singular} ID must be a UUID.`);
    const item = await activeResource(table, id.data);
    if (!item) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', `${singular} was not found.`);
    return c.json({ data: serialize(item), meta: {}, error: null });
  });

  memoryRoutes.patch(`/${path}/:id`, requireScopes('memory:write'), requireRoles('admin', 'editor'), async (c) => {
    const id = uuidSchema.safeParse(c.req.param('id'));
    const input = (updateSchema || patchSchema(schema)).safeParse(await c.req.json().catch(() => null));
    if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', `${singular} update is invalid.`, input.error?.issues || []);
    const ownerId = c.get('auth').sub;
    const current = await activeResource(table, id.data);
    if (!current) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', `${singular} was not found.`);
    if (current.revision !== input.data.expected_revision) {
      return errorResponse(c, 409, 'REVISION_CONFLICT', 'The memory object changed concurrently.', [{
        expected_revision: input.data.expected_revision, current_revision: current.revision,
      }]);
    }
    const validationError = validate ? await validate(input.data, current, ownerId) : null;
    if (validationError) return errorResponse(c, validationError.status, validationError.code, validationError.message);
    try {
      const verificationUpdate = table.verificationState && ['verified', 'rejected'].includes(current.verificationState)
        ? { verificationState: 'candidate' }
        : {};
      const [updated] = await db.update(table).set({
        ...mapper({ ...serialize(current), ...input.data }), ...verificationUpdate,
        revision: sql`${table.revision} + 1`, updatedAt: new Date(),
      }).where(and(
        eq(table.id, current.id), eq(table.revision, input.data.expected_revision), isNull(table.deletedAt),
      )).returning();
      if (!updated) {
        const latest = await activeResource(table, current.id);
        return errorResponse(c, 409, 'REVISION_CONFLICT', 'The memory object changed concurrently.', [{
          expected_revision: input.data.expected_revision, current_revision: latest?.revision ?? null,
        }]);
      }
      return c.json({ data: serialize(updated), meta: {}, error: null });
    } catch (error) {
      if (error?.code === '23505') return errorResponse(c, 409, 'UID_CONFLICT', `This ${singular}_uid already exists.`);
      throw error;
    }
  });

  memoryRoutes.delete(`/${path}/:id`, requireScopes('memory:write'), requireRoles('admin', 'editor'), async (c) => {
    const id = uuidSchema.safeParse(c.req.param('id'));
    if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', `${singular} ID must be a UUID.`);
    if (singular !== 'relation' && await nodeIsInUse(singular, id.data)) {
      return errorResponse(c, 409, 'MEMORY_NODE_IN_USE', 'Remove or retire active references before deleting this memory node.');
    }
    const [deleted] = await db.update(table).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(table.id, id.data), isNull(table.deletedAt))).returning();
    if (!deleted) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', `${singular} was not found.`);
    return c.json({ data: serialize(deleted), meta: {}, error: null });
  });
}

const sourceValidator = (field) => async (input, current, ownerId) => {
  const sourceId = input[field] === undefined ? current?.sourceId : input[field];
  return await validateSource(sourceId, ownerId) ? null : { status: 404, code: 'SOURCE_NOT_FOUND', message: 'An active shared Source is required.' };
};

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

async function contentHash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function validateBulkEventReferences(events, ownerId) {
  const sourceIds = [...new Set(events.map((event) => event.source_id).filter(Boolean))];
  if (sourceIds.length > 0) {
    const found = await db.select({ id: sources.id }).from(sources).where(and(
      inArray(sources.id, sourceIds), isNull(sources.deletedAt),
    ));
    if (found.length !== sourceIds.length) return { code: 'SOURCE_NOT_FOUND', message: 'One or more active shared Sources were not found.' };
  }
  const experienceIds = [...new Set(events.map((event) => event.experience_id).filter(Boolean))];
  if (experienceIds.length > 0) {
    const found = await db.select({ id: memoryExperiences.id }).from(memoryExperiences).where(and(
      inArray(memoryExperiences.id, experienceIds), isNull(memoryExperiences.deletedAt),
    ));
    if (found.length !== experienceIds.length) return { code: 'EXPERIENCE_NOT_FOUND', message: 'One or more active workspace Experiences were not found.' };
  }
  return null;
}

memoryRoutes.post('/events/bulk', requireScopes('memory:write'), requireRoles('admin', 'editor'), requireSignedApiKeyRequest, async (c) => {
  const input = memoryEventBulkSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Event batch is invalid.', input.error.issues);
  const eventUids = input.data.events.map((event) => event.event_uid);
  if (new Set(eventUids).size !== eventUids.length) return errorResponse(c, 400, 'DUPLICATE_EVENT_UID', 'event_uid values must be unique within a batch.');
  const ownerId = c.get('auth').sub;
  const referenceError = await validateBulkEventReferences(input.data.events, ownerId);
  if (referenceError) return errorResponse(c, 404, referenceError.code, referenceError.message);
  const hash = await contentHash(input.data.events);
  try {
    const result = await db.transaction(async (tx) => {
      const [batch] = await tx.insert(memoryEventIngestionBatches).values({
        batchUid: input.data.batch_uid, contentHash: hash,
        eventCount: input.data.events.length, createdBy: ownerId,
      }).returning();
      const events = await tx.insert(memoryEvents).values(input.data.events.map((event, index) => ({
        ...mappings.event(event), ingestionBatchId: batch.id, batchPosition: index + 1, createdBy: ownerId,
      }))).returning();
      return { batch, events };
    });
    return c.json({ data: { batch_id: result.batch.id, batch_uid: result.batch.batchUid, content_hash: result.batch.contentHash, event_count: result.batch.eventCount, replayed: false, events: result.events.map(serializers.event) }, meta: {}, error: null }, 201);
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const [existing] = await db.select().from(memoryEventIngestionBatches).where(and(
      eq(memoryEventIngestionBatches.createdBy, ownerId), eq(memoryEventIngestionBatches.batchUid, input.data.batch_uid),
    )).limit(1);
    if (!existing) return errorResponse(c, 409, 'EVENT_UID_CONFLICT', 'One or more event_uid values already exist.');
    if (existing.contentHash !== hash) return errorResponse(c, 409, 'BATCH_UID_CONFLICT', 'batch_uid was already used with different event content.');
    const events = await db.select().from(memoryEvents).where(eq(memoryEvents.ingestionBatchId, existing.id))
      .orderBy(memoryEvents.batchPosition);
    return c.json({ data: { batch_id: existing.id, batch_uid: existing.batchUid, content_hash: existing.contentHash, event_count: existing.eventCount, replayed: true, events: events.map(serializers.event) }, meta: {}, error: null });
  }
});

memoryRoutes.post('/events/async', requireScopes('memory:write'), requireRoles('admin', 'editor'), requireSignedApiKeyRequest, async (c) => {
  const input = memoryEventAsyncSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Async Event batch is invalid.', input.error.issues);
  const eventUids = input.data.events.map((event) => event.event_uid);
  if (new Set(eventUids).size !== eventUids.length) return errorResponse(c, 400, 'DUPLICATE_EVENT_UID', 'event_uid values must be unique within a batch.');
  const ownerId = c.get('auth').sub;
  const referenceError = await validateBulkEventReferences(input.data.events, ownerId);
  if (referenceError) return errorResponse(c, 404, referenceError.code, referenceError.message);
  const hash = await contentHash(input.data.events);
  const [existing] = await db.select().from(memoryEventIngestionJobs).where(and(
    eq(memoryEventIngestionJobs.createdBy, ownerId), eq(memoryEventIngestionJobs.batchUid, input.data.batch_uid),
  )).limit(1);
  if (existing) {
    if (existing.contentHash !== hash) return errorResponse(c, 409, 'BATCH_UID_CONFLICT', 'batch_uid was already used with different event content.');
    return c.json({ data: serializeEventJob(existing), meta: { replayed: true }, error: null });
  }
  const [completedBatch] = await db.select().from(memoryEventIngestionBatches).where(and(
    eq(memoryEventIngestionBatches.createdBy, ownerId), eq(memoryEventIngestionBatches.batchUid, input.data.batch_uid),
  )).limit(1);
  if (completedBatch) return errorResponse(c, 409, 'BATCH_UID_CONFLICT', 'batch_uid already belongs to an ingested batch.');
  const content = JSON.stringify({ batch_uid: input.data.batch_uid, events: input.data.events });
  const byteSize = new TextEncoder().encode(content).byteLength;
  const maxBytes = Number(process.env.MAX_UPLOAD_SIZE_MB || 100) * 1024 * 1024;
  if (byteSize > maxBytes) return errorResponse(c, 413, 'EVENT_BATCH_TOO_LARGE', `Async Event batches are limited to ${maxBytes} bytes.`);
  const jobId = crypto.randomUUID();
  const objectKey = `memory/event-jobs/${ownerId}/${jobId}/events.json`;
  await storeObject(objectKey, content, 'application/json');
  try {
    const [job] = await db.insert(memoryEventIngestionJobs).values({
      id: jobId, batchUid: input.data.batch_uid, contentHash: hash, objectKey,
      eventCount: input.data.events.length, createdBy: ownerId,
    }).returning();
    await enqueueBackgroundJob('memory-events', job.id);
    return c.json({ data: serializeEventJob(job), meta: { replayed: false }, error: null }, 202);
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const [concurrent] = await db.select().from(memoryEventIngestionJobs).where(and(
      eq(memoryEventIngestionJobs.createdBy, ownerId), eq(memoryEventIngestionJobs.batchUid, input.data.batch_uid),
    )).limit(1);
    if (!concurrent || concurrent.contentHash !== hash) return errorResponse(c, 409, 'BATCH_UID_CONFLICT', 'batch_uid was already used with different event content.');
    return c.json({ data: serializeEventJob(concurrent), meta: { replayed: true }, error: null });
  }
});

memoryRoutes.get('/event-jobs/:id', requireScopes('memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Event job ID must be a UUID.');
  const [job] = await db.select().from(memoryEventIngestionJobs).where(and(
    eq(memoryEventIngestionJobs.id, id.data),
  )).limit(1);
  return job ? c.json({ data: serializeEventJob(job), meta: {}, error: null }) : errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Event job was not found.');
});

memoryRoutes.post('/event-jobs/:id/cancel', requireUserAuth, requireScopes('memory:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Event job ID must be a UUID.');
  const [job] = await db.update(memoryEventIngestionJobs).set({ cancelRequested: true }).where(and(
    eq(memoryEventIngestionJobs.id, id.data),
    inArray(memoryEventIngestionJobs.status, ['queued', 'processing']),
  )).returning();
  if (job) return c.json({ data: serializeEventJob(job), meta: {}, error: null });
  const [existing] = await db.select({ id: memoryEventIngestionJobs.id }).from(memoryEventIngestionJobs).where(and(
    eq(memoryEventIngestionJobs.id, id.data),
  )).limit(1);
  return existing ? errorResponse(c, 409, 'JOB_NOT_CANCELLABLE', 'Only queued or processing Event jobs can be cancelled.') : errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Event job was not found.');
});

registerCrud({ path: 'experiences', singular: 'experience', table: memoryExperiences, schema: experienceSchema, mapper: mappings.experience, validate: sourceValidator('source_id') });
registerCrud({
  path: 'events', singular: 'event', table: memoryEvents, schema: memoryEventSchema,
  updateSchema: patchSchema(memoryEventSchema.omit({ verification_state: true })), mapper: mappings.event,
  validate: async (input, current, ownerId) => {
    const sourceError = await sourceValidator('source_id')(input, current, ownerId);
    if (sourceError) return sourceError;
    const experienceId = input.experience_id === undefined ? current?.experienceId : input.experience_id;
    if (experienceId && !await validateNode('experience', experienceId, ownerId)) return { status: 404, code: 'EXPERIENCE_NOT_FOUND', message: 'An active workspace Experience is required.' };
    return null;
  },
});
registerCrud({ path: 'entities', singular: 'entity', table: memoryEntities, schema: entitySchema, updateSchema: patchSchema(entitySchema.omit({ verification_state: true })), mapper: mappings.entity, validate: sourceValidator('source_id') });
registerCrud({ path: 'concepts', singular: 'concept', table: memoryConcepts, schema: conceptSchema, updateSchema: patchSchema(conceptSchema.omit({ verification_state: true })), mapper: mappings.concept, validate: sourceValidator('source_id') });
registerCrud({
  path: 'relations', singular: 'relation', table: memoryRelations, schema: relationSchema,
  updateSchema: patchSchema(relationSchema.omit({ verification_state: true, evidence_count: true, counterexample_count: true })), mapper: mappings.relation,
  validate: async (input, current, ownerId) => {
    const sourceType = input.source_type ?? current?.sourceType;
    const sourceId = input.source_id ?? current?.sourceId;
    const targetType = input.target_type ?? current?.targetType;
    const targetId = input.target_id ?? current?.targetId;
    const minDelay = input.min_delay_ms === undefined ? current?.minDelayMs : input.min_delay_ms;
    const maxDelay = input.max_delay_ms === undefined ? current?.maxDelayMs : input.max_delay_ms;
    const validFrom = input.valid_from === undefined ? current?.validFrom : input.valid_from;
    const validUntil = input.valid_until === undefined ? current?.validUntil : input.valid_until;
    if (minDelay != null && maxDelay != null && minDelay > maxDelay) return { status: 400, code: 'INVALID_DELAY_RANGE', message: 'max_delay_ms must be greater than or equal to min_delay_ms.' };
    if (validFrom && validUntil && validFrom > validUntil) return { status: 400, code: 'INVALID_VALIDITY_RANGE', message: 'valid_until must be after valid_from.' };
    if (!await validateNode(sourceType, sourceId, ownerId)) return { status: 404, code: 'SOURCE_NODE_NOT_FOUND', message: 'The active workspace source node was not found.' };
    if (!await validateNode(targetType, targetId, ownerId)) return { status: 404, code: 'TARGET_NODE_NOT_FOUND', message: 'The active workspace target node was not found.' };
    return null;
  },
});

function normalizeAlias(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function validateEvidenceReference(type, id, ownerId) {
  if (type === 'external') return id == null;
  if (!id) return false;
  if (type === 'source') return validateSource(id, ownerId);
  return validateNode(type, id, ownerId);
}

memoryRoutes.get('/entities/:id/aliases', requireScopes('memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Entity ID must be a UUID.');
  const entity = await activeResource(memoryEntities, id.data);
  if (!entity) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Entity was not found.');
  const items = await db.select().from(memoryEntityAliases).where(and(
    eq(memoryEntityAliases.entityId, entity.id), isNull(memoryEntityAliases.deletedAt),
  )).orderBy(desc(memoryEntityAliases.createdAt));
  return c.json({ data: items.map(serializeAlias), meta: {}, error: null });
});

memoryRoutes.post('/entities/:id/aliases', requireScopes('memory:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = aliasSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Entity alias is invalid.', input.error?.issues || []);
  const ownerId = c.get('auth').sub;
  const entity = await activeResource(memoryEntities, id.data);
  if (!entity) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Entity was not found.');
  try {
    const [created] = await db.insert(memoryEntityAliases).values({
      entityId: entity.id, alias: input.data.alias, normalizedAlias: normalizeAlias(input.data.alias),
      languageCode: input.data.language_code.toLowerCase(), aliasType: input.data.alias_type,
      confidence: input.data.confidence, proposalSource: input.data.proposal_source,
      verificationState: input.data.verification_state, createdBy: ownerId,
    }).returning();
    return c.json({ data: serializeAlias(created), meta: {}, error: null }, 201);
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'ALIAS_CONFLICT', 'This normalized alias already exists for the entity and language.');
    throw error;
  }
});

memoryRoutes.delete('/entities/:entityId/aliases/:aliasId', requireScopes('memory:write'), requireRoles('admin', 'editor'), async (c) => {
  const entityId = uuidSchema.safeParse(c.req.param('entityId')); const aliasId = uuidSchema.safeParse(c.req.param('aliasId'));
  if (!entityId.success || !aliasId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Entity and alias IDs must be UUIDs.');
  const [deleted] = await db.update(memoryEntityAliases).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
    eq(memoryEntityAliases.id, aliasId.data), eq(memoryEntityAliases.entityId, entityId.data),
    isNull(memoryEntityAliases.deletedAt),
  )).returning();
  if (!deleted) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Entity alias was not found.');
  return c.json({ data: serializeAlias(deleted), meta: {}, error: null });
});

memoryRoutes.get('/relations/:id/evidence', requireScopes('memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Relation ID must be a UUID.');
  const relation = await activeResource(memoryRelations, id.data);
  if (!relation) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Relation was not found.');
  const items = await db.select().from(memoryRelationEvidence).where(and(
    eq(memoryRelationEvidence.relationId, relation.id),
  )).orderBy(desc(memoryRelationEvidence.createdAt));
  return c.json({ data: items.map(serializeEvidence), meta: {}, error: null });
});

memoryRoutes.post('/relations/:id/evidence', requireScopes('memory:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = evidenceSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Relation evidence is invalid.', input.error?.issues || []);
  const ownerId = c.get('auth').sub;
  const relation = await activeResource(memoryRelations, id.data);
  if (!relation) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Relation was not found.');
  if (relation.revision !== input.data.expected_revision) {
    return errorResponse(c, 409, 'REVISION_CONFLICT', 'The Relation changed concurrently.', [{
      expected_revision: input.data.expected_revision, current_revision: relation.revision,
    }]);
  }
  if (!await validateEvidenceReference(input.data.reference_type, input.data.reference_id, ownerId)) {
    return errorResponse(c, 404, 'EVIDENCE_REFERENCE_NOT_FOUND', 'The evidence reference is invalid or unavailable.');
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [created] = await tx.insert(memoryRelationEvidence).values({
        evidenceUid: input.data.evidence_uid, relationId: relation.id,
        evidenceType: input.data.evidence_type, referenceType: input.data.reference_type,
        referenceId: input.data.reference_id ?? null, supports: input.data.supports,
        weight: input.data.weight, details: input.data.details, createdBy: ownerId,
      }).returning();
      const countColumn = input.data.supports ? memoryRelations.evidenceCount : memoryRelations.counterexampleCount;
      const [updatedRelation] = await tx.update(memoryRelations).set({
        [input.data.supports ? 'evidenceCount' : 'counterexampleCount']: sql`${countColumn} + 1`,
        verificationState: ['verified', 'rejected'].includes(relation.verificationState) ? 'candidate' : relation.verificationState,
        revision: sql`${memoryRelations.revision} + 1`, updatedAt: new Date(),
      }).where(and(
        eq(memoryRelations.id, relation.id), eq(memoryRelations.revision, input.data.expected_revision),
        isNull(memoryRelations.deletedAt),
      )).returning();
      if (!updatedRelation) throw Object.assign(new Error('Relation revision conflict.'), { code: 'REVISION_CONFLICT' });
      return { created, updatedRelation };
    });
    return c.json({ data: { evidence: serializeEvidence(result.created), relation: serializers.relation(result.updatedRelation) }, meta: {}, error: null }, 201);
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'EVIDENCE_UID_CONFLICT', 'This evidence_uid already exists for the relation.');
    if (error?.code === 'REVISION_CONFLICT') {
      const latest = await activeResource(memoryRelations, relation.id);
      return errorResponse(c, 409, 'REVISION_CONFLICT', 'The Relation changed concurrently.', [{
        expected_revision: input.data.expected_revision, current_revision: latest?.revision ?? null,
      }]);
    }
    throw error;
  }
});

const verificationTargets = {
  event: memoryEvents, entity: memoryEntities, entity_alias: memoryEntityAliases,
  concept: memoryConcepts, relation: memoryRelations,
};
const verificationTargetType = z.enum(Object.keys(verificationTargets));
const allowedVerificationTransitions = {
  unverified: ['candidate', 'verified', 'rejected'],
  candidate: ['verified', 'rejected'],
  verified: ['candidate'],
  rejected: ['candidate'],
};

memoryRoutes.get('/verification/:type/:id', requireScopes('memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const type = verificationTargetType.safeParse(c.req.param('type')); const id = uuidSchema.safeParse(c.req.param('id'));
  if (!type.success || !id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Verification target is invalid.');
  const target = await activeResource(verificationTargets[type.data], id.data);
  if (!target) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Verification target was not found.');
  const items = await db.select().from(memoryVerificationDecisions).where(and(
    eq(memoryVerificationDecisions.targetType, type.data), eq(memoryVerificationDecisions.targetId, target.id),
  )).orderBy(desc(memoryVerificationDecisions.createdAt));
  return c.json({ data: items.map(serializeDecision), meta: {}, error: null });
});

memoryRoutes.post('/verification/:type/:id', requireScopes('memory:verify'), requireRoles('admin', 'reviewer'), async (c) => {
  const type = verificationTargetType.safeParse(c.req.param('type')); const id = uuidSchema.safeParse(c.req.param('id'));
  const input = verificationSchema.safeParse(await c.req.json().catch(() => null));
  if (!type.success || !id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Verification decision is invalid.', input.error?.issues || []);
  if (!allowedVerificationTransitions[input.data.expected_state]?.includes(input.data.state)) {
    return errorResponse(c, 409, 'INVALID_VERIFICATION_TRANSITION', `Cannot transition from ${input.data.expected_state} to ${input.data.state}.`);
  }
  const ownerId = c.get('auth').sub;
  const table = verificationTargets[type.data];
  const target = await activeResource(table, id.data);
  if (!target) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Verification target was not found.');
  if (target.revision !== input.data.expected_revision) {
    return errorResponse(c, 409, 'REVISION_CONFLICT', 'The verification target changed concurrently.', [{
      expected_revision: input.data.expected_revision, current_revision: target.revision,
    }]);
  }
  if (target.verificationState !== input.data.expected_state) return errorResponse(c, 409, 'VERIFICATION_STATE_CONFLICT', 'The verification state changed concurrently.');
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(table).set({
      verificationState: input.data.state, revision: sql`${table.revision} + 1`, updatedAt: new Date(),
    }).where(and(
      eq(table.id, target.id), eq(table.revision, input.data.expected_revision),
      eq(table.verificationState, input.data.expected_state), isNull(table.deletedAt),
    )).returning();
    if (!updated) return null;
    const snapshot = type.data === 'entity_alias' ? serializeAlias(updated) : serializers[type.data](updated);
    const [decision] = await tx.insert(memoryVerificationDecisions).values({
      targetType: type.data, targetId: target.id, fromState: input.data.expected_state,
      toState: input.data.state, targetRevision: updated.revision, targetSnapshot: snapshot,
      notes: input.data.notes ?? null,
      metadata: input.data.metadata, decidedBy: ownerId,
    }).returning();
    return { updated, decision };
  });
  if (!result) {
    const latest = await activeResource(table, target.id);
    if (latest?.revision !== input.data.expected_revision) {
      return errorResponse(c, 409, 'REVISION_CONFLICT', 'The verification target changed concurrently.', [{
        expected_revision: input.data.expected_revision, current_revision: latest?.revision ?? null,
      }]);
    }
    return errorResponse(c, 409, 'VERIFICATION_STATE_CONFLICT', 'The verification state changed concurrently.');
  }
  return c.json({ data: { target_id: result.updated.id, revision: result.updated.revision, verification_state: result.updated.verificationState, decision: serializeDecision(result.decision) }, meta: {}, error: null });
});

memoryRoutes.post('/traverse', requireScopes('memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const input = traverseSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Traversal request is invalid.', input.error.issues);
  const ownerId = c.get('auth').sub;
  const uniqueStarts = [...new Map(input.data.start_nodes.map((node) => [`${node.type}:${node.id}`, node])).values()];
  if (uniqueStarts.length > input.data.max_nodes) return errorResponse(c, 400, 'TRAVERSAL_LIMIT_INVALID', 'max_nodes must be at least the number of unique start nodes.');
  for (const node of uniqueStarts) {
    if (!await validateNode(node.type, node.id, ownerId)) return errorResponse(c, 404, 'START_NODE_NOT_FOUND', `Start node ${node.type}:${node.id} was not found.`);
  }

  const visited = new Map(uniqueStarts.map((node) => [`${node.type}:${node.id}`, { ...node, depth: 0 }]));
  const edges = new Map();
  let frontier = uniqueStarts;
  let depthReached = 0;
  const now = new Date();

  for (let depth = 0; depth < input.data.max_depth && frontier.length > 0; depth += 1) {
    if (visited.size >= input.data.max_nodes || edges.size >= input.data.max_edges) break;
    const frontierKeys = new Set(frontier.map((node) => `${node.type}:${node.id}`));
    const directionConditions = [];
    if (input.data.direction !== 'incoming') {
      directionConditions.push(...frontier.map((node) => and(eq(memoryRelations.sourceType, node.type), eq(memoryRelations.sourceId, node.id))));
    }
    if (input.data.direction !== 'outgoing') {
      directionConditions.push(...frontier.map((node) => and(eq(memoryRelations.targetType, node.type), eq(memoryRelations.targetId, node.id))));
    }
    const conditions = [
      isNull(memoryRelations.deletedAt),
      gte(memoryRelations.confidence, input.data.min_confidence),
      inArray(memoryRelations.verificationState, input.data.verification_states),
      or(isNull(memoryRelations.validFrom), lte(memoryRelations.validFrom, now)),
      or(isNull(memoryRelations.validUntil), gte(memoryRelations.validUntil, now)),
      or(isNull(memoryRelations.expiresAt), gt(memoryRelations.expiresAt, now)),
      or(...directionConditions),
    ];
    if (input.data.relation_types?.length) conditions.push(inArray(memoryRelations.relationType, input.data.relation_types));
    const candidates = await db.select().from(memoryRelations).where(and(...conditions))
      .orderBy(desc(memoryRelations.confidence), desc(memoryRelations.createdAt))
      .limit(Math.min(input.data.max_edges, Math.max(1, (input.data.max_nodes - visited.size) * 10)));
    const next = new Map();
    for (const relation of candidates) {
      if (edges.size >= input.data.max_edges) break;
      const sourceKey = `${relation.sourceType}:${relation.sourceId}`;
      const targetKey = `${relation.targetType}:${relation.targetId}`;
      let neighbor;
      if (input.data.direction !== 'incoming' && frontierKeys.has(sourceKey)) neighbor = { type: relation.targetType, id: relation.targetId };
      else if (input.data.direction !== 'outgoing' && frontierKeys.has(targetKey)) neighbor = { type: relation.sourceType, id: relation.sourceId };
      if (!neighbor) continue;
      edges.set(relation.id, relation);
      const key = `${neighbor.type}:${neighbor.id}`;
      if (!visited.has(key) && visited.size < input.data.max_nodes) {
        const discovered = { ...neighbor, depth: depth + 1 };
        visited.set(key, discovered);
        next.set(key, neighbor);
        depthReached = Math.max(depthReached, depth + 1);
      }
    }
    frontier = [...next.values()];
  }

  return c.json({
    data: { nodes: [...visited.values()], relations: [...edges.values()].map(serializers.relation) },
    meta: {
      direction: input.data.direction, max_depth: input.data.max_depth,
      depth_reached: depthReached, node_count: visited.size, edge_count: edges.size,
      node_limit_reached: visited.size >= input.data.max_nodes,
      edge_limit_reached: edges.size >= input.data.max_edges,
    },
    error: null,
  });
});

memoryRoutes.get('/nodes/:type/:id/neighbors', requireScopes('memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const type = nodeType.safeParse(c.req.param('type')); const id = uuidSchema.safeParse(c.req.param('id'));
  if (!type.success || !id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Node type and ID are invalid.');
  const ownerId = c.get('auth').sub;
  if (!await validateNode(type.data, id.data, ownerId)) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Node was not found.');
  const items = await db.select().from(memoryRelations).where(and(
    isNull(memoryRelations.deletedAt),
    or(
      and(eq(memoryRelations.sourceType, type.data), eq(memoryRelations.sourceId, id.data)),
      and(eq(memoryRelations.targetType, type.data), eq(memoryRelations.targetId, id.data)),
    ),
  )).orderBy(desc(memoryRelations.createdAt)).limit(100);
  return c.json({ data: items.map(serializers.relation), meta: { limit: 100 }, error: null });
});

export default memoryRoutes;
