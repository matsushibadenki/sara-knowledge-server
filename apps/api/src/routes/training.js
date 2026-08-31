import { Hono } from 'hono';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';
import { db } from '../db/client.js';
import {
  datasetSnapshots,
  trainingMetrics,
  trainingModels,
  trainingRuns,
} from '../db/schema/index.js';

const jsonObject = z.record(z.string(), z.unknown());
const uuidSchema = z.string().uuid();
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const modelSchema = z.object({
  name: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).nullable().optional(),
  model_family: z.string().trim().max(200).nullable().optional(),
  model_version: z.string().trim().max(200).nullable().optional(),
  base_model: z.string().trim().max(500).nullable().optional(),
  configuration: jsonObject.default({}),
});
const modelPatchSchema = modelSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
const transformerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().min(1).max(200),
  configuration: jsonObject.optional(),
}).passthrough();
const runSchema = z.object({
  run_uid: z.string().trim().min(1).max(200),
  model_id: uuidSchema,
  dataset_snapshot_id: uuidSchema,
  task_type: z.string().trim().min(1).max(100),
  transformer: transformerSchema,
  parameters: jsonObject.default({}),
  environment: jsonObject.default({}),
  code_revision: z.string().trim().max(200).nullable().optional(),
  seed: z.number().int().min(0).max(2147483647).nullable().optional(),
});
const transitionSchema = z.object({
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  output_object_key: z.string().trim().min(1).max(2000).nullable().optional(),
  error_message: z.string().max(4000).nullable().optional(),
});
const metricSchema = z.object({
  metric_name: z.string().trim().min(1).max(200),
  metric_value: z.number().finite(),
  step: z.number().int().min(0).max(2147483647).default(0),
  epoch: z.number().finite().min(0).nullable().optional(),
  split: z.enum(['train', 'validation', 'test', 'holdout', 'custom']).default('custom'),
  metadata: jsonObject.default({}),
  recorded_at: z.coerce.date().optional(),
});

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

function serializeModel(item) {
  return {
    id: item.id, name: item.name, provider: item.provider, model_family: item.modelFamily,
    model_version: item.modelVersion, base_model: item.baseModel, configuration: item.configuration,
    created_by: item.createdBy, created_at: item.createdAt, updated_at: item.updatedAt,
  };
}

function serializeRun(item) {
  return {
    id: item.id, run_uid: item.runUid, model_id: item.modelId,
    model_snapshot: item.modelSnapshot, dataset_snapshot_id: item.datasetSnapshotId,
    status: item.status, task_type: item.taskType,
    transformer: item.transformer, parameters: item.parameters, environment: item.environment,
    code_revision: item.codeRevision, seed: item.seed, output_object_key: item.outputObjectKey,
    error_message: item.errorMessage, created_by: item.createdBy, created_at: item.createdAt,
    started_at: item.startedAt, finished_at: item.finishedAt,
  };
}

function serializeMetric(item) {
  return {
    id: item.id, run_id: item.runId, step: item.step, epoch: item.epoch,
    metric_name: item.metricName, metric_value: item.metricValue, split: item.split,
    metadata: item.metadata, recorded_at: item.recordedAt,
  };
}

async function ownedModel(id, ownerId) {
  const [item] = await db.select().from(trainingModels)
    .where(and(eq(trainingModels.id, id), eq(trainingModels.createdBy, ownerId), isNull(trainingModels.deletedAt))).limit(1);
  return item;
}

async function ownedRun(id, ownerId) {
  const [item] = await db.select().from(trainingRuns)
    .where(and(eq(trainingRuns.id, id), eq(trainingRuns.createdBy, ownerId))).limit(1);
  return item;
}

const trainingRoutes = new Hono();
trainingRoutes.use('*', requireAuth);

trainingRoutes.get('/models', requireScopes('training:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const query = listSchema.safeParse({ limit: c.req.query('limit') });
  if (!query.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Model query is invalid.', query.error.issues);
  const items = await db.select().from(trainingModels)
    .where(and(eq(trainingModels.createdBy, c.get('auth').sub), isNull(trainingModels.deletedAt)))
    .orderBy(desc(trainingModels.updatedAt), desc(trainingModels.id)).limit(query.data.limit);
  return c.json({ data: items.map(serializeModel), meta: { limit: query.data.limit }, error: null });
});

trainingRoutes.post('/models', requireScopes('training:write'), requireRoles('admin', 'editor'), async (c) => {
  const input = modelSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Model is invalid.', input.error.issues);
  try {
    const [created] = await db.insert(trainingModels).values({
      name: input.data.name, provider: input.data.provider ?? null,
      modelFamily: input.data.model_family ?? null, modelVersion: input.data.model_version ?? null,
      baseModel: input.data.base_model ?? null, configuration: input.data.configuration,
      createdBy: c.get('auth').sub,
    }).returning();
    return c.json({ data: serializeModel(created), meta: {}, error: null }, 201);
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'MODEL_NAME_CONFLICT', 'A model with this name already exists.');
    throw error;
  }
});

trainingRoutes.get('/models/:id', requireScopes('training:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Model ID must be a UUID.');
  const item = await ownedModel(id.data, c.get('auth').sub);
  if (!item) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Model was not found.');
  return c.json({ data: serializeModel(item), meta: {}, error: null });
});

trainingRoutes.patch('/models/:id', requireScopes('training:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = modelPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Model update is invalid.', input.error?.issues || []);
  try {
    const [updated] = await db.update(trainingModels).set({
      ...(input.data.name === undefined ? {} : { name: input.data.name }),
      ...(input.data.provider === undefined ? {} : { provider: input.data.provider }),
      ...(input.data.model_family === undefined ? {} : { modelFamily: input.data.model_family }),
      ...(input.data.model_version === undefined ? {} : { modelVersion: input.data.model_version }),
      ...(input.data.base_model === undefined ? {} : { baseModel: input.data.base_model }),
      ...(input.data.configuration === undefined ? {} : { configuration: input.data.configuration }),
      updatedAt: new Date(),
    }).where(and(eq(trainingModels.id, id.data), eq(trainingModels.createdBy, c.get('auth').sub), isNull(trainingModels.deletedAt))).returning();
    if (!updated) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Model was not found.');
    return c.json({ data: serializeModel(updated), meta: {}, error: null });
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'MODEL_NAME_CONFLICT', 'A model with this name already exists.');
    throw error;
  }
});

trainingRoutes.get('/runs', requireScopes('training:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const query = listSchema.safeParse({ limit: c.req.query('limit') });
  if (!query.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Run query is invalid.', query.error.issues);
  const items = await db.select().from(trainingRuns).where(eq(trainingRuns.createdBy, c.get('auth').sub))
    .orderBy(desc(trainingRuns.createdAt), desc(trainingRuns.id)).limit(query.data.limit);
  return c.json({ data: items.map(serializeRun), meta: { limit: query.data.limit }, error: null });
});

trainingRoutes.post('/runs', requireScopes('training:write'), requireRoles('admin', 'editor'), async (c) => {
  const input = runSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Training run is invalid.', input.error.issues);
  const ownerId = c.get('auth').sub;
  const [model, snapshot] = await Promise.all([
    ownedModel(input.data.model_id, ownerId),
    db.select().from(datasetSnapshots).where(and(
      eq(datasetSnapshots.id, input.data.dataset_snapshot_id),
      eq(datasetSnapshots.createdBy, ownerId),
      eq(datasetSnapshots.status, 'completed'),
    )).limit(1).then(([item]) => item),
  ]);
  if (!model) return errorResponse(c, 404, 'MODEL_NOT_FOUND', 'Model was not found.');
  if (!snapshot) return errorResponse(c, 409, 'SNAPSHOT_NOT_READY', 'A completed owned dataset snapshot is required.');
  try {
    const [created] = await db.insert(trainingRuns).values({
      runUid: input.data.run_uid, modelId: model.id,
      modelSnapshot: {
        name: model.name, provider: model.provider, model_family: model.modelFamily,
        model_version: model.modelVersion, base_model: model.baseModel,
        configuration: model.configuration, revision: model.updatedAt.toISOString(),
      },
      datasetSnapshotId: snapshot.id,
      taskType: input.data.task_type, transformer: input.data.transformer,
      parameters: input.data.parameters, environment: input.data.environment,
      codeRevision: input.data.code_revision ?? null, seed: input.data.seed ?? null,
      createdBy: ownerId,
    }).returning();
    return c.json({ data: serializeRun(created), meta: {}, error: null }, 201);
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'RUN_UID_CONFLICT', 'A training run with this run_uid already exists.');
    throw error;
  }
});

trainingRoutes.get('/runs/:id', requireScopes('training:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Run ID must be a UUID.');
  const run = await ownedRun(id.data, c.get('auth').sub);
  if (!run) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Training run was not found.');
  const metrics = await db.select().from(trainingMetrics).where(eq(trainingMetrics.runId, run.id))
    .orderBy(asc(trainingMetrics.recordedAt), asc(trainingMetrics.id)).limit(1000);
  return c.json({ data: { ...serializeRun(run), metrics: metrics.map(serializeMetric) }, meta: {}, error: null });
});

trainingRoutes.post('/runs/:id/status', requireScopes('training:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = transitionSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Run transition is invalid.', input.error?.issues || []);
  const run = await ownedRun(id.data, c.get('auth').sub);
  if (!run) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Training run was not found.');
  const allowed = { queued: ['running', 'cancelled'], running: ['completed', 'failed', 'cancelled'] };
  if (!allowed[run.status]?.includes(input.data.status)) {
    return errorResponse(c, 409, 'INVALID_RUN_TRANSITION', `Cannot transition a run from ${run.status} to ${input.data.status}.`);
  }
  const now = new Date();
  const [updated] = await db.update(trainingRuns).set({
    status: input.data.status,
    startedAt: input.data.status === 'running' ? now : run.startedAt,
    finishedAt: input.data.status === 'running' ? null : now,
    outputObjectKey: input.data.output_object_key ?? run.outputObjectKey,
    errorMessage: input.data.error_message ?? run.errorMessage,
  }).where(and(eq(trainingRuns.id, run.id), eq(trainingRuns.status, run.status))).returning();
  if (!updated) return errorResponse(c, 409, 'RUN_STATE_CONFLICT', 'The training run changed concurrently.');
  return c.json({ data: serializeRun(updated), meta: {}, error: null });
});

trainingRoutes.get('/runs/:id/metrics', requireScopes('training:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Run ID must be a UUID.');
  const run = await ownedRun(id.data, c.get('auth').sub);
  if (!run) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Training run was not found.');
  const items = await db.select().from(trainingMetrics).where(eq(trainingMetrics.runId, run.id))
    .orderBy(asc(trainingMetrics.recordedAt), asc(trainingMetrics.id)).limit(1000);
  return c.json({ data: items.map(serializeMetric), meta: { limit: 1000 }, error: null });
});

trainingRoutes.post('/runs/:id/metrics', requireScopes('training:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const input = metricSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Metric is invalid.', input.error?.issues || []);
  const run = await ownedRun(id.data, c.get('auth').sub);
  if (!run) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Training run was not found.');
  if (!['running', 'completed'].includes(run.status)) return errorResponse(c, 409, 'RUN_NOT_MEASURABLE', 'Metrics require a running or completed run.');
  try {
    const [created] = await db.insert(trainingMetrics).values({
      runId: run.id, step: input.data.step, epoch: input.data.epoch ?? null,
      metricName: input.data.metric_name, metricValue: input.data.metric_value,
      split: input.data.split, metadata: input.data.metadata,
      recordedAt: input.data.recorded_at ?? new Date(),
    }).returning();
    return c.json({ data: serializeMetric(created), meta: {}, error: null }, 201);
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'METRIC_CONFLICT', 'This metric name, split, and step already exists for the run.');
    throw error;
  }
});

export default trainingRoutes;
