import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { assetBindings, assetDeletionJobs, assets } from '../db/schema/index.js';
import { hashBytes, presignObject, readObjectBytes, statObject, storeObject } from '../services/background-jobs.js';
import { ASSET_URL_SECONDS, scheduleAssetDeletion, serializeDeletionJob } from '../services/asset-retention.js';
import { findAccessibleResource } from '../services/resource-access.js';

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const bindingSchema = z.object({
  target_type: z.enum(['source', 'record', 'event']),
  target_id: uuidSchema,
  role: z.string().trim().min(1).max(100).default('attachment'),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();
const uploadSchema = z.object({
  original_filename: z.string().trim().min(1).max(500),
  mime_type: z.string().trim().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i).max(200),
  size_bytes: z.number().int().positive(),
  sha256: sha256Schema,
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  duration_ms: z.number().int().min(0).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  bindings: z.array(bindingSchema).min(1).max(20),
}).strict();
const completeSchema = z.object({}).strict();

function errorResponse(c, status, code, message, details = []) {
  return c.json({ data: null, meta: {}, error: { code, message, details } }, status);
}

function serializeBinding(item) {
  return { id: item.id, target_type: item.targetType, target_id: item.targetId, role: item.role, metadata: item.metadata, created_at: item.createdAt };
}

function serializeAsset(item, bindings = []) {
  return {
    id: item.id, original_filename: item.originalFilename, mime_type: item.mimeType,
    size_bytes: item.sizeBytes, sha256: item.sha256, status: item.status,
    width: item.width, height: item.height, duration_ms: item.durationMs,
    metadata: item.metadata, bindings: bindings.map(serializeBinding),
    created_at: item.createdAt, updated_at: item.updatedAt, deleted_at: item.deletedAt,
  };
}

async function validateBinding(binding) {
  return Boolean(await findAccessibleResource(db, binding.target_type, binding.target_id));
}

async function activeAssetWithBindings(id) {
  const [asset] = await db.select().from(assets).where(and(
    eq(assets.id, id), isNull(assets.deletedAt),
  )).limit(1);
  if (!asset) return null;
  const bindings = await db.select().from(assetBindings).where(eq(assetBindings.assetId, asset.id)).orderBy(assetBindings.createdAt);
  return { asset, bindings };
}

const assetRoutes = new Hono();
assetRoutes.use('*', requireAuth);

assetRoutes.post('/upload-url', requireScopes('assets:write'), requireRoles('admin', 'editor'), async (c) => {
  const input = uploadSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Asset upload request is invalid.', input.error.issues);
  const maxBytes = Number(process.env.MAX_UPLOAD_SIZE_MB || 100) * 1024 * 1024;
  if (input.data.size_bytes > maxBytes) return errorResponse(c, 413, 'ASSET_TOO_LARGE', `Assets are limited to ${maxBytes} bytes.`);
  const uniqueBindings = [...new Map(input.data.bindings.map((binding) => [`${binding.target_type}:${binding.target_id}:${binding.role}`, binding])).values()];
  if (uniqueBindings.length !== input.data.bindings.length) return errorResponse(c, 400, 'DUPLICATE_BINDING', 'Asset bindings must be unique.');
  const ownerId = c.get('auth').sub;
  for (const binding of uniqueBindings) {
    if (!await validateBinding(binding)) return errorResponse(c, 404, 'BINDING_TARGET_NOT_FOUND', `Active ${binding.target_type} target was not found in the workspace.`);
  }
  const duplicateCandidates = await db.select({ id: assets.id }).from(assets).where(and(
    eq(assets.sha256, input.data.sha256), eq(assets.status, 'ready'), isNull(assets.deletedAt),
  )).limit(20);
  const id = crypto.randomUUID();
  const objectKey = `assets/${c.get('workspace').workspaceId}/${id}/original.final`;
  const stagingObjectKey = `assets/${c.get('workspace').workspaceId}/${id}/original.upload`;
  const bucketName = process.env.MINIO_BUCKET || 'sara-assets';
  const { asset, bindings } = await db.transaction(async (tx) => {
    const [created] = await tx.insert(assets).values({
      id, bucketName, objectKey, stagingObjectKey, originalFilename: input.data.original_filename,
      mimeType: input.data.mime_type.toLowerCase(), sizeBytes: input.data.size_bytes,
      sha256: input.data.sha256, width: input.data.width ?? null, height: input.data.height ?? null,
      durationMs: input.data.duration_ms ?? null, metadata: input.data.metadata, createdBy: ownerId,
    }).returning();
    const createdBindings = await tx.insert(assetBindings).values(uniqueBindings.map((binding) => ({
      assetId: id, targetType: binding.target_type, targetId: binding.target_id,
      role: binding.role, metadata: binding.metadata, createdBy: ownerId,
    }))).returning();
    return { asset: created, bindings: createdBindings };
  });
  const uploadUrl = presignObject(stagingObjectKey, 'PUT', ASSET_URL_SECONDS, { type: asset.mimeType });
  return c.json({
    data: { ...serializeAsset(asset, bindings), upload_url: uploadUrl, expires_in: ASSET_URL_SECONDS },
    meta: { duplicate_asset_ids: duplicateCandidates.map((candidate) => candidate.id) }, error: null,
  }, 201);
});

assetRoutes.post('/:id/complete', requireScopes('assets:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const body = completeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!id.success || !body.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Asset completion request is invalid.');
  const owned = await activeAssetWithBindings(id.data);
  if (!owned) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Asset was not found.');
  if (owned.asset.status === 'ready') return c.json({ data: serializeAsset(owned.asset, owned.bindings), meta: { replayed: true }, error: null });
  if (!owned.asset.stagingObjectKey) return errorResponse(c, 409, 'ASSET_STATE_CONFLICT', 'Asset staging key is missing.');
  let stat;
  try { stat = await statObject(owned.asset.stagingObjectKey); } catch { return errorResponse(c, 409, 'ASSET_NOT_UPLOADED', 'The uploaded object was not found.'); }
  if (Number(stat.size) !== owned.asset.sizeBytes) return errorResponse(c, 422, 'ASSET_SIZE_MISMATCH', 'Uploaded object size does not match the reservation.');
  let bytes;
  try { bytes = await readObjectBytes(owned.asset.stagingObjectKey); } catch { return errorResponse(c, 409, 'ASSET_NOT_UPLOADED', 'The uploaded object was not found.'); }
  if (bytes.byteLength !== owned.asset.sizeBytes) return errorResponse(c, 422, 'ASSET_SIZE_MISMATCH', 'Uploaded object size does not match the reservation.');
  if (await hashBytes(bytes) !== owned.asset.sha256) return errorResponse(c, 422, 'ASSET_HASH_MISMATCH', 'Uploaded object SHA-256 does not match the reservation.');
  let finalized;
  try {
    finalized = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(assets).where(eq(assets.id, id.data)).for('update');
      if (!current || current.deletedAt) return null;
      if (current.status === 'ready') return { asset: current, replayed: true };
      // The Asset lock serializes final object writes, deletion and binding detachment.
      await storeObject(current.objectKey, bytes, current.mimeType);
      const [ready] = await tx.update(assets).set({ status: 'ready', updatedAt: new Date() })
        .where(eq(assets.id, current.id)).returning();
      await scheduleAssetDeletion(tx, ready, 'staging');
      return { asset: ready, replayed: false };
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', service: 'api', message: 'Asset finalization failed', asset_id: owned.asset.id, error: error.message }));
    return errorResponse(c, 503, 'ASSET_FINALIZATION_FAILED', 'Asset could not be finalized; retry completion.');
  }
  if (!finalized) return errorResponse(c, 409, 'ASSET_STATE_CONFLICT', 'Asset state changed concurrently.');
  return c.json({ data: serializeAsset(finalized.asset, owned.bindings), meta: { replayed: finalized.replayed }, error: null });
});

assetRoutes.get('/', requireScopes('assets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const items = await db.select().from(assets).where(isNull(assets.deletedAt))
    .orderBy(desc(assets.createdAt)).limit(100);
  return c.json({ data: items.map((item) => serializeAsset(item)), meta: { limit: 100 }, error: null });
});

assetRoutes.get('/:id', requireScopes('assets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Asset ID must be a UUID.');
  const owned = await activeAssetWithBindings(id.data);
  return owned ? c.json({ data: serializeAsset(owned.asset, owned.bindings), meta: {}, error: null }) : errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Asset was not found.');
});

assetRoutes.get('/:id/download-url', requireScopes('assets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Asset ID must be a UUID.');
  const owned = await activeAssetWithBindings(id.data);
  if (!owned || owned.asset.status !== 'ready') return errorResponse(c, 404, 'READY_ASSET_NOT_FOUND', 'Ready Asset was not found.');
  const url = presignObject(owned.asset.objectKey, 'GET', ASSET_URL_SECONDS, {
    type: owned.asset.mimeType,
    contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(owned.asset.originalFilename)}`,
  });
  return c.json({ data: { download_url: url, expires_in: ASSET_URL_SECONDS }, meta: {}, error: null });
});

assetRoutes.delete('/:id/bindings/:bindingId', requireScopes('assets:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const bindingId = uuidSchema.safeParse(c.req.param('bindingId'));
  if (!id.success || !bindingId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Asset and binding IDs must be UUIDs.');
  const result = await db.transaction(async (tx) => {
    const [asset] = await tx.select().from(assets).where(eq(assets.id, id.data)).for('update');
    if (!asset) return null;
    const [binding] = await tx.delete(assetBindings).where(and(eq(assetBindings.id, bindingId.data), eq(assetBindings.assetId, id.data))).returning();
    return binding;
  });
  return result ? c.json({ data: serializeBinding(result), meta: {}, error: null }) : errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Asset binding was not found.');
});

assetRoutes.get('/:id/deletion-jobs', requireScopes('assets:read'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Asset ID must be a UUID.');
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, id.data));
  if (!asset) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Asset was not found.');
  const jobs = await db.select().from(assetDeletionJobs).where(eq(assetDeletionJobs.assetId, id.data)).orderBy(assetDeletionJobs.createdAt);
  return c.json({ data: jobs.map(serializeDeletionJob), meta: {}, error: null });
});

assetRoutes.post('/:id/deletion-jobs/:jobId/retry', requireScopes('assets:write'), requireRoles('admin'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const jobId = uuidSchema.safeParse(c.req.param('jobId'));
  if (!id.success || !jobId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Asset and job IDs must be UUIDs.');
  const [job] = await db.update(assetDeletionJobs).set({
    status: 'queued', attemptCount: 0, nextAttemptAt: new Date(), completedAt: null, errorMessage: null,
  }).where(and(eq(assetDeletionJobs.id, jobId.data), eq(assetDeletionJobs.assetId, id.data), eq(assetDeletionJobs.status, 'failed'))).returning();
  return job ? c.json({ data: serializeDeletionJob(job), meta: {}, error: null }) : errorResponse(c, 409, 'JOB_NOT_RETRYABLE', 'Only a failed Asset deletion job can be retried.');
});

assetRoutes.delete('/:id', requireScopes('assets:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Asset ID must be a UUID.');
  const result = await db.transaction(async (tx) => {
    const [asset] = await tx.select().from(assets).where(eq(assets.id, id.data)).for('update');
    if (!asset) return { missing: true };
    if (asset.deletedAt) return { asset, replayed: true };
    // Even soft-deleted targets keep their references for later restoration.
    const bindings = await tx.select({ id: assetBindings.id }).from(assetBindings).where(eq(assetBindings.assetId, asset.id)).limit(1);
    if (bindings.length) return { retained: true };
    const now = new Date();
    const [deleted] = await tx.update(assets).set({ deletedAt: now, updatedAt: now }).where(eq(assets.id, asset.id)).returning();
    await scheduleAssetDeletion(tx, deleted, 'deleted_asset', now);
    return { asset: deleted, replayed: false };
  });
  if (result.missing) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Asset was not found.');
  if (result.retained) return errorResponse(c, 409, 'ASSET_IN_USE', 'Detach all Asset bindings before deletion; references are retained even for deleted targets.');
  return c.json({ data: serializeAsset(result.asset), meta: { replayed: result.replayed, deletion_queued: true }, error: null });
});

export default assetRoutes;
