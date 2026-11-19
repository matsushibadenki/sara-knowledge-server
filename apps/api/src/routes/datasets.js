import { Hono } from 'hono';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';
import { db } from '../db/client.js';
import {
  datasetDefinitions,
  datasetSnapshotRecords,
  datasetSnapshotAssets,
  datasetSnapshots,
  records,
  recordVersions,
} from '../db/schema/index.js';
import { readBoundedObject, readObject, storeObject } from '../services/background-jobs.js';
import { createBundleFiles, SnapshotBundleError } from '../services/snapshot-bundle.js';
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

async function activeDefinition(id) {
  const [item] = await db.select().from(datasetDefinitions)
    .where(and(eq(datasetDefinitions.id, id), isNull(datasetDefinitions.deletedAt))).limit(1);
  return item;
}

function formatManifest(snapshot, definition, rows, dependencies) {
  const metadata = {
    schema: 'sara.dataset-manifest/1.2',
    selection_policy: 'dataset-selection/1',
    asset_bindings_at_creation: dependencies, snapshot_id: snapshot.id,
    definition_id: definition.id, definition_revision: definition.updatedAt.toISOString(),
    created_at: snapshot.createdAt.toISOString(), filters: definition.filters,
    record_count: rows.length,
  };
  const entries = rows.map(({ record, version }, index) => ({
    ordinal: index + 1, record_id: record.id, record_version_id: version.id,
    version_number: version.versionNumber, record_type: version.contextSnapshot?.record_type ?? null,
    status: record.status, language_code: version.contextSnapshot?.language_code ?? null,
    quality_score: version.contextSnapshot?.quality_score ?? null, confidence: version.contextSnapshot?.confidence ?? null,
    source_id: version.sourceId, source_revision: version.sourceRevision,
    source_pin_state: version.sourcePinState, context_snapshot: version.contextSnapshot,
    schema_version: version.schemaVersion,
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
    .where(isNull(datasetDefinitions.deletedAt))
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
  const item = await activeDefinition(id.data);
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
    }).where(and(eq(datasetDefinitions.id, id.data), isNull(datasetDefinitions.deletedAt))).returning();
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
  const definition = await activeDefinition(id.data);
  if (!definition) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
  const items = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.definitionId, definition.id)).orderBy(desc(datasetSnapshots.createdAt));
  return c.json({ data: items.map(serializeSnapshot), meta: {}, error: null });
});

datasetRoutes.post('/:id/snapshots', requireScopes('datasets:write'), requireRoles('admin', 'editor'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  if (!id.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset ID must be a UUID.');
  const definition = await activeDefinition(id.data);
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
      const dependencies = await tx.execute(sql`
        WITH targets AS (
          SELECT 'record' AS type, m.record_id AS id
          FROM dataset.dataset_snapshot_records m WHERE m.snapshot_id = ${snapshotId}
          UNION
          SELECT 'source', v.source_id
          FROM dataset.dataset_snapshot_records m
          JOIN dataset.record_versions v ON v.id = m.record_version_id
          WHERE m.snapshot_id = ${snapshotId} AND v.source_revision IS NOT NULL
        )
        SELECT b.target_type, b.target_id, b.role, a.id AS asset_id,
               a.sha256, a.size_bytes::text AS size_bytes, a.mime_type
        FROM targets t
        JOIN dataset.asset_bindings b ON b.target_type = t.type AND b.target_id = t.id
        JOIN dataset.assets a ON a.id = b.asset_id
        WHERE a.status = 'ready' AND a.deleted_at IS NULL
        ORDER BY b.target_type, b.target_id, b.id
        LIMIT ${MAX_SNAPSHOT_RECORDS + 1} FOR SHARE OF a`);
      if (dependencies.length > MAX_SNAPSHOT_RECORDS) {
        throw Object.assign(new Error('Too many Asset bindings for a synchronous snapshot.'), { code: 'SNAPSHOT_TOO_LARGE' });
      }
      const assetIds = [...new Set(dependencies.map((item) => item.asset_id))];
      if (assetIds.length) {
        await tx.insert(datasetSnapshotAssets).values(assetIds.map((assetId) => ({ snapshotId, assetId })));
      }
      return { snapshot: created, rows: selectedRows, dependencies };
    }, { isolationLevel: 'repeatable read' });
  } catch (error) {
    if (['40001', '40P01'].includes(error?.code ?? error?.cause?.code)) {
      return errorResponse(c, 409, 'SNAPSHOT_CONFLICT', 'Snapshot inputs changed concurrently. Retry creation.');
    }
    if (error?.code === 'SNAPSHOT_TOO_LARGE') return errorResponse(c, 413, 'SNAPSHOT_TOO_LARGE', error.message);
    throw error;
  }
  const { snapshot, rows, dependencies } = frozen;
  const objectKey = `datasets/${c.get('auth').sub}/${definition.id}/${snapshot.id}/manifest.${snapshot.manifestFormat}`;
  try {
    const manifest = formatManifest(snapshot, definition, rows, dependencies);
    await storeObject(objectKey, manifest, snapshot.manifestFormat === 'jsonl' ? 'application/x-ndjson' : 'application/json');
    const [completed] = await db.update(datasetSnapshots).set({
      status: 'completed', manifestObjectKey: objectKey, manifestHash: await sha256(manifest), completedAt: new Date(),
    }).where(eq(datasetSnapshots.id, snapshot.id)).returning();
    return c.json({ data: serializeSnapshot(completed), meta: {}, error: null }, 201);
  } catch (error) {
    const outcome = await db.transaction(async (tx) => {
      const [failed] = await tx.update(datasetSnapshots)
        .set({ status: 'failed', errorMessage: String(error.message || error).slice(0, 2000), completedAt: new Date() })
        .where(and(eq(datasetSnapshots.id, snapshot.id), eq(datasetSnapshots.status, 'building'))).returning();
      if (failed) {
        await tx.delete(datasetSnapshotAssets).where(eq(datasetSnapshotAssets.snapshotId, snapshot.id));
        return failed;
      }
      const [existing] = await tx.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, snapshot.id));
      return existing;
    });
    if (!outcome) throw error;
    return c.json({ data: serializeSnapshot(outcome), meta: {}, error: null }, outcome.status === 'completed' ? 201 : 502);
  }
});

datasetRoutes.get('/:id/snapshots/:snapshotId', requireScopes('datasets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id')); const snapshotId = uuidSchema.safeParse(c.req.param('snapshotId'));
  if (!id.success || !snapshotId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset and snapshot IDs must be UUIDs.');
  const definition = await activeDefinition(id.data);
  if (!definition) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
  const [snapshot] = await db.select().from(datasetSnapshots)
    .where(and(eq(datasetSnapshots.id, snapshotId.data), eq(datasetSnapshots.definitionId, definition.id))).limit(1);
  if (!snapshot) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset snapshot was not found.');
  const members = await db.select().from(datasetSnapshotRecords).where(eq(datasetSnapshotRecords.snapshotId, snapshot.id)).orderBy(asc(datasetSnapshotRecords.ordinal));
  return c.json({ data: { ...serializeSnapshot(snapshot), records: members.map((item) => ({ ordinal: item.ordinal, record_id: item.recordId, record_version_id: item.recordVersionId })) }, meta: {}, error: null });
});

datasetRoutes.get('/:id/snapshots/:snapshotId/impact', requireScopes('datasets:read', 'sources:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const snapshotId = uuidSchema.safeParse(c.req.param('snapshotId'));
  const query = listSchema.extend({
    after_ordinal: z.coerce.number().int().min(0).max(MAX_SNAPSHOT_RECORDS).default(0),
  }).safeParse(c.req.query());
  if (!id.success || !snapshotId.success || !query.success) {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Invalid Snapshot impact query.');
  }
  const [snapshot] = await db.select({ id: datasetSnapshots.id }).from(datasetSnapshots)
    .innerJoin(datasetDefinitions, eq(datasetDefinitions.id, datasetSnapshots.definitionId))
    .where(and(eq(datasetSnapshots.id, snapshotId.data), eq(datasetDefinitions.id, id.data), isNull(datasetDefinitions.deletedAt))).limit(1);
  if (!snapshot) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset snapshot was not found.');
  const { limit, after_ordinal: after } = query.data;
  const rows = await db.execute(sql`
    SELECT m.ordinal, m.record_id, m.record_version_id, v.source_id,
           v.source_revision, s.revision AS current_source_revision,
           CASE WHEN v.source_pin_state = 'legacy_unknown' THEN 'legacy_unknown'
                WHEN s.deleted_at IS NOT NULL THEN 'source_withdrawn'
                ELSE 'source_revised' END AS reason
    FROM dataset.dataset_snapshot_records m
    JOIN dataset.record_versions v ON v.id = m.record_version_id
    LEFT JOIN dataset.sources s ON s.id = v.source_id
    WHERE m.snapshot_id = ${snapshot.id} AND m.ordinal > ${after}
      AND (v.source_pin_state = 'legacy_unknown' OR s.deleted_at IS NOT NULL OR s.revision <> v.source_revision)
    ORDER BY m.ordinal LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  return c.json({ data: page, meta: { next_after_ordinal: rows.length > limit ? page.at(-1).ordinal : null }, error: null });
});

datasetRoutes.get('/:id/snapshots/:snapshotId/manifest', requireScopes('datasets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id')); const snapshotId = uuidSchema.safeParse(c.req.param('snapshotId'));
  if (!id.success || !snapshotId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Dataset and snapshot IDs must be UUIDs.');
  const definition = await activeDefinition(id.data);
  if (!definition) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Dataset definition was not found.');
  const [snapshot] = await db.select().from(datasetSnapshots).where(and(eq(datasetSnapshots.id, snapshotId.data), eq(datasetSnapshots.definitionId, definition.id))).limit(1);
  if (!snapshot || snapshot.status !== 'completed' || !snapshot.manifestObjectKey) return errorResponse(c, 409, 'MANIFEST_NOT_READY', 'Dataset manifest is not ready.');
  const content = await readObject(snapshot.manifestObjectKey);
  c.header('Content-Type', snapshot.manifestFormat === 'jsonl' ? 'application/x-ndjson; charset=utf-8' : 'application/json; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="dataset-${definition.id}-${snapshot.id}.${snapshot.manifestFormat}"`);
  c.header('X-Content-SHA256', snapshot.manifestHash);
  return c.body(content);
});

datasetRoutes.get('/:id/snapshots/:snapshotId/bundle', requireScopes('datasets:read', 'records:read', 'sources:read', 'assets:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'));
  const snapshotId = uuidSchema.safeParse(c.req.param('snapshotId'));
  if (!id.success || !snapshotId.success) return errorResponse(c, 400, 'VALIDATION_ERROR', 'Invalid Snapshot ID.');
  const [match] = await db.select({ snapshot: datasetSnapshots }).from(datasetSnapshots)
    .innerJoin(datasetDefinitions, eq(datasetDefinitions.id, datasetSnapshots.definitionId))
    .where(and(eq(datasetSnapshots.id, snapshotId.data), eq(datasetDefinitions.id, id.data), isNull(datasetDefinitions.deletedAt)))
    .limit(1);
  if (!match) return errorResponse(c, 404, 'RESOURCE_NOT_FOUND', 'Snapshot was not found.');
  const { snapshot } = match;
  if (snapshot.status !== 'completed' || !snapshot.manifestObjectKey || !snapshot.manifestHash) {
    return errorResponse(c, 409, 'MANIFEST_NOT_READY', 'Snapshot manifest is not ready.');
  }

  const bundle = createBundleFiles();
  try {
    const manifestBytes = await readBoundedObject(snapshot.manifestObjectKey, bundle.remaining);
    const manifestPath = `manifest.${snapshot.manifestFormat}`;
    await bundle.add(manifestPath, manifestBytes, snapshot.manifestHash);
    const manifestText = manifestBytes.toString('utf8');
    const manifest = snapshot.manifestFormat === 'jsonl'
      ? JSON.parse(manifestText.slice(0, manifestText.indexOf('\n'))) : JSON.parse(manifestText);
    if (manifest.schema !== 'sara.dataset-manifest/1.2') {
      return errorResponse(c, 409, 'BUNDLE_PROVENANCE_UNAVAILABLE', 'Snapshot lacks frozen Asset provenance.');
    }

    const versions = await db.execute(sql`
      SELECT m.ordinal, v.id, v.record_id, v.version_number, v.schema_version,
             v.content, v.plain_text, v.context_snapshot, v.source_id, v.source_revision, v.source_pin_state
      FROM dataset.dataset_snapshot_records m
      JOIN dataset.record_versions v ON v.id = m.record_version_id AND v.record_id = m.record_id
      WHERE m.snapshot_id = ${snapshot.id}
      ORDER BY m.ordinal`);
    if (versions.length !== snapshot.recordCount) {
      throw new SnapshotBundleError('BUNDLE_INTEGRITY_ERROR', 'Snapshot membership is incomplete.');
    }
    const entries = snapshot.manifestFormat === 'jsonl'
      ? manifestText.trimEnd().split('\n').slice(1).map((line) => JSON.parse(line))
      : manifest.records;
    if (entries.length !== versions.length || versions.some((v, i) =>
      entries[i].record_version_id !== v.id || entries[i].ordinal !== v.ordinal ||
      entries[i].source_id !== v.source_id || entries[i].source_revision !== v.source_revision)) {
      throw new SnapshotBundleError('BUNDLE_INTEGRITY_ERROR', 'Snapshot membership differs from the manifest.');
    }
    if (versions.some((v) => v.source_pin_state === 'legacy_unknown' || !v.context_snapshot)) {
      return errorResponse(c, 409, 'BUNDLE_PROVENANCE_UNAVAILABLE', 'A Snapshot member lacks frozen provenance.');
    }
    await bundle.add('records.json', Buffer.from(JSON.stringify(versions)));

    const sources = await db.execute(sql`
      SELECT DISTINCT s.source_id, s.revision, s.origin, s.recorded_at, s.snapshot
      FROM dataset.dataset_snapshot_records m
      JOIN dataset.record_versions v ON v.id = m.record_version_id
      JOIN dataset.source_revisions s ON s.source_id = v.source_id AND s.revision = v.source_revision
      WHERE m.snapshot_id = ${snapshot.id}
      ORDER BY s.source_id, s.revision`);
    const sourcePins = new Set(versions.filter((v) => v.source_id).map((v) => `${v.source_id}:${v.source_revision}`));
    if (sources.length !== sourcePins.size) {
      throw new SnapshotBundleError('BUNDLE_INTEGRITY_ERROR', 'A frozen Source version is missing.');
    }
    await bundle.add('sources.json', Buffer.from(JSON.stringify(sources)));

    const expectedAssets = new Map(manifest.asset_bindings_at_creation.map((a) => [a.asset_id, a]));
    const pinnedAssets = await db.execute(sql`
      SELECT a.id, a.sha256, a.size_bytes::text AS size_bytes, a.bucket_name, a.object_key
      FROM dataset.dataset_snapshot_assets p JOIN dataset.assets a ON a.id = p.asset_id
      WHERE p.snapshot_id = ${snapshot.id} AND a.status = 'ready' AND a.deleted_at IS NULL
      ORDER BY a.id`);
    if (pinnedAssets.length !== expectedAssets.size) {
      return errorResponse(c, 409, 'BUNDLE_PROVENANCE_UNAVAILABLE', 'Snapshot Asset retention references are incomplete.');
    }
    for (const asset of pinnedAssets) {
      const expected = expectedAssets.get(asset.id);
      if (!expected || expected.sha256 !== asset.sha256 || expected.size_bytes !== asset.size_bytes) {
        throw new SnapshotBundleError('BUNDLE_INTEGRITY_ERROR', 'Asset metadata differs from the manifest.');
      }
      const size = Number(expected.size_bytes);
      if (!Number.isSafeInteger(size) || size > bundle.remaining) throw new RangeError('Snapshot Assets exceed the bundle budget.');
      const bytes = await readBoundedObject(asset.object_key, size, asset.bucket_name);
      if (bytes.length !== size) throw new SnapshotBundleError('BUNDLE_INTEGRITY_ERROR', 'Asset byte count differs from the manifest.');
      await bundle.add(`assets/${asset.id}`, bytes, expected.sha256);
    }
    const payload = JSON.stringify({ schema: 'sara.snapshot-bundle/1', snapshot_id: snapshot.id, files: bundle.files });
    c.header('Content-Disposition', `attachment; filename="snapshot-${snapshot.id}.bundle.json"`);
    c.header('Content-Type', 'application/json');
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-SHA256', await sha256(payload));
    return c.body(payload);
  } catch (error) {
    if (error instanceof RangeError || error.code === 'BUNDLE_TOO_LARGE') {
      return errorResponse(c, 413, 'BUNDLE_TOO_LARGE', 'Snapshot bundle exceeds the synchronous export limit.');
    }
    if (error instanceof SnapshotBundleError) return errorResponse(c, 409, error.code, error.message);
    if (error.code === 'NoSuchKey' || error.code === 'NoSuchBucket') {
      return errorResponse(c, 409, 'BUNDLE_OBJECT_MISSING', 'A Snapshot object is missing.');
    }
    throw error;
  }
});

export default datasetRoutes;
