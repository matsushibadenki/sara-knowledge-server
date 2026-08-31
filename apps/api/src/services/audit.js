import { auditLogs } from '../db/schema/index.js';

function iso(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function metadataKeys(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  return Object.keys(metadata).sort();
}

export function sourceAuditSnapshot(source) {
  if (!source) return null;
  return {
    id: source.id,
    source_type: source.sourceType,
    title: source.title,
    url: source.url,
    author: source.author,
    publisher: source.publisher,
    published_at: iso(source.publishedAt),
    retrieved_at: iso(source.retrievedAt),
    license_type: source.licenseType,
    copyright_status: source.copyrightStatus,
    content_hash: source.contentHash,
    metadata_keys: metadataKeys(source.metadata),
    created_by: source.createdBy,
    created_at: iso(source.createdAt),
    updated_at: iso(source.updatedAt),
    deleted_at: iso(source.deletedAt),
  };
}

export function recordAuditSnapshot(record, version = null) {
  if (!record) return null;
  return {
    id: record.id,
    record_type: record.recordType,
    title: record.title,
    status: record.status,
    current_version_id: record.currentVersionId,
    current_version_number: version?.versionNumber ?? null,
    schema_version: version?.schemaVersion ?? null,
    language_code: record.languageCode,
    quality_score: record.qualityScore,
    confidence: record.confidence,
    source_id: record.sourceId,
    owner_id: record.ownerId,
    external_system: record.externalSystem,
    external_id: record.externalId,
    metadata_keys: metadataKeys(record.metadata),
    created_at: iso(record.createdAt),
    updated_at: iso(record.updatedAt),
    deleted_at: iso(record.deletedAt),
  };
}

function actorFromContext(c) {
  const auth = c.get('auth');
  if (auth?.token_type === 'api_key') {
    return {
      actorType: 'api_key',
      actorId: auth.api_key_id,
      actorUserId: auth.sub,
    };
  }
  return {
    actorType: auth ? 'user' : 'system',
    actorId: auth?.sub ?? null,
    actorUserId: auth?.sub ?? null,
  };
}

export async function appendAuditLog(executor, c, {
  action,
  resourceType,
  resourceId,
  beforeData = null,
  afterData = null,
  metadata = {},
  createdAt = new Date(),
}) {
  const actor = actorFromContext(c);
  const [entry] = await executor.insert(auditLogs).values({
    actorType: actor.actorType,
    actorId: actor.actorId,
    action,
    resourceType,
    resourceId,
    requestId: c.get('requestId') || null,
    userAgent: c.req.header('User-Agent')?.slice(0, 1000) || null,
    beforeData,
    afterData,
    metadata: {
      ...metadata,
      actor_user_id: actor.actorUserId,
      method: c.req.method,
      path: c.req.path,
    },
    createdAt,
  }).returning();
  return entry;
}

export function changedFields(beforeData, afterData) {
  const keys = new Set([
    ...Object.keys(beforeData || {}),
    ...Object.keys(afterData || {}),
  ]);
  return [...keys]
    .filter((key) => JSON.stringify(beforeData?.[key]) !== JSON.stringify(afterData?.[key]))
    .sort();
}
