// /apps/api/src/db/schema/index.js
import {
  boolean,
  check,
  doublePrecision,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

export const authSchema = pgSchema('auth');
export const datasetSchema = pgSchema('dataset');
export const memorySchema = pgSchema('memory');
export const trainingSchema = pgSchema('training');
export const systemSchema = pgSchema('system');

export const users = authSchema.table('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  status: text('status').notNull().default('active'),
  role: text('role').notNull().default('viewer'),
  locale: text('locale').default('ja'),
  preferences: jsonb('preferences').notNull().default({}),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...auditColumns,
}, (table) => ({
  statusCheck: check(
    'users_status_check',
    sql`${table.status} IN ('active', 'disabled', 'invited')`,
  ),
  roleCheck: check(
    'users_role_check',
    sql`${table.role} IN ('admin', 'editor', 'reviewer', 'viewer', 'service')`,
  ),
}));

export const refreshTokens = authSchema.table('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  replacedById: uuid('replaced_by_id'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIndex: index('refresh_tokens_user_id_idx').on(table.userId),
  activeExpiryIndex: index('refresh_tokens_active_expiry_idx').on(table.expiresAt)
    .where(sql`${table.revokedAt} IS NULL`),
}));

export const apiKeys = authSchema.table('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes').array().notNull().default([]),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIndex: index('api_keys_user_id_idx').on(table.userId),
  activeExpiryIndex: index('api_keys_active_expiry_idx').on(table.expiresAt)
    .where(sql`${table.revokedAt} IS NULL`),
}));

export const apiRequestNonces = authSchema.table('api_request_nonces', {
  id: uuid('id').defaultRandom().primaryKey(),
  apiKeyId: uuid('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
  nonce: text('nonce').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  apiKeyNonceUnique: uniqueIndex('api_request_nonces_key_nonce_unique').on(table.apiKeyId, table.nonce),
  expiryIndex: index('api_request_nonces_expiry_idx').on(table.expiresAt),
  apiKeyIdempotencyIndex: index('api_request_nonces_key_idempotency_idx')
    .on(table.apiKeyId, table.idempotencyKey, table.createdAt),
}));

export const sources = datasetSchema.table('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceType: text('source_type').notNull(),
  title: text('title'),
  url: text('url'),
  author: text('author'),
  publisher: text('publisher'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }),
  licenseType: text('license_type'),
  licenseText: text('license_text'),
  copyrightStatus: text('copyright_status'),
  contentHash: text('content_hash'),
  metadata: jsonb('metadata').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  ...auditColumns,
}, (table) => ({
  activeUpdatedIndex: index('sources_active_updated_idx').on(table.updatedAt)
    .where(sql`${table.deletedAt} IS NULL`),
  sourceTypeIndex: index('sources_source_type_idx').on(table.sourceType),
  urlIndex: index('sources_url_idx').on(table.url),
  contentHashIndex: index('sources_content_hash_idx').on(table.contentHash),
  createdByIndex: index('sources_created_by_idx').on(table.createdBy),
  sourceTypeCheck: check(
    'sources_source_type_check',
    sql`${table.sourceType} IN ('manual', 'website', 'document', 'book', 'dataset', 'conversation', 'sensor', 'generated', 'imported', 'wordpress')`,
  ),
}));

export const records = datasetSchema.table('records', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordType: text('record_type').notNull(),
  title: text('title'),
  status: text('status').notNull().default('draft'),
  currentVersionId: uuid('current_version_id').references(() => recordVersions.id),
  languageCode: text('language_code'),
  qualityScore: doublePrecision('quality_score'),
  confidence: doublePrecision('confidence'),
  sourceId: uuid('source_id').references(() => sources.id),
  ownerId: uuid('owner_id').references(() => users.id),
  externalSystem: text('external_system'),
  externalId: text('external_id'),
  metadata: jsonb('metadata').notNull().default({}),
  ...auditColumns,
}, (table) => ({
  activeUpdatedIndex: index('records_active_updated_idx').on(table.updatedAt)
    .where(sql`${table.deletedAt} IS NULL`),
  statusIndex: index('records_status_idx').on(table.status),
  recordTypeIndex: index('records_record_type_idx').on(table.recordType),
  sourceIdIndex: index('records_source_id_idx').on(table.sourceId),
  ownerIdIndex: index('records_owner_id_idx').on(table.ownerId),
  currentVersionIdIndex: index('records_current_version_id_idx').on(table.currentVersionId),
}));

export const recordVersions = datasetSchema.table('record_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordId: uuid('record_id').notNull().references(() => records.id),
  versionNumber: integer('version_number').notNull(),
  schemaVersion: text('schema_version').notNull().default('1.0'),
  content: jsonb('content').notNull(),
  plainText: text('plain_text'),
  changeSummary: text('change_summary'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  isCurrent: boolean('is_current').notNull().default(false),
}, (table) => ({
  recordVersionUnique: uniqueIndex('record_versions_record_version_unique')
    .on(table.recordId, table.versionNumber),
  oneCurrentVersionPerRecord: uniqueIndex('record_versions_one_current_unique')
    .on(table.recordId)
    .where(sql`${table.isCurrent} = true AND ${table.deletedAt} IS NULL`),
  recordIdIndex: index('record_versions_record_id_idx').on(table.recordId),
  createdByIndex: index('record_versions_created_by_idx').on(table.createdBy),
}));

export const tags = datasetSchema.table('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  description: text('description'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  normalizedNameUnique: uniqueIndex('tags_normalized_name_unique').on(table.normalizedName),
  createdByIndex: index('tags_created_by_idx').on(table.createdBy),
}));

export const recordTags = datasetSchema.table('record_tags', {
  recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  assignedBy: uuid('assigned_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  primaryKey: primaryKey({ columns: [table.recordId, table.tagId] }),
  tagIdIndex: index('record_tags_tag_id_idx').on(table.tagId),
  assignedByIndex: index('record_tags_assigned_by_idx').on(table.assignedBy),
}));

export const annotations = datasetSchema.table('annotations', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  recordVersionId: uuid('record_version_id').notNull().references(() => recordVersions.id),
  annotationType: text('annotation_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('active'),
  createdBy: uuid('created_by').references(() => users.id),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => ({
  recordTimelineIndex: index('annotations_record_timeline_idx').on(table.recordId, table.createdAt),
  versionIdIndex: index('annotations_record_version_id_idx').on(table.recordVersionId),
  createdByIndex: index('annotations_created_by_idx').on(table.createdBy),
  resolvedByIndex: index('annotations_resolved_by_idx').on(table.resolvedBy),
  unresolvedIndex: index('annotations_unresolved_idx').on(table.recordId, table.createdAt)
    .where(sql`${table.status} = 'active'`),
  typeCheck: check('annotations_type_check', sql`${table.annotationType} IN ('comment', 'correction', 'label', 'entity', 'relation')`),
  statusCheck: check('annotations_status_check', sql`${table.status} IN ('active', 'resolved')`),
}));

export const evaluations = datasetSchema.table('evaluations', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  recordVersionId: uuid('record_version_id').notNull().references(() => recordVersions.id),
  metric: text('metric').notNull(),
  score: doublePrecision('score'),
  verdict: text('verdict').notNull(),
  notes: text('notes'),
  metadata: jsonb('metadata').notNull().default({}),
  evaluatedBy: uuid('evaluated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  recordTimelineIndex: index('evaluations_record_timeline_idx').on(table.recordId, table.createdAt),
  versionIdIndex: index('evaluations_record_version_id_idx').on(table.recordVersionId),
  evaluatedByIndex: index('evaluations_evaluated_by_idx').on(table.evaluatedBy),
  metricTimelineIndex: index('evaluations_metric_timeline_idx').on(table.metric, table.createdAt),
  scoreCheck: check('evaluations_score_check', sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 1)`),
  verdictCheck: check('evaluations_verdict_check', sql`${table.verdict} IN ('pass', 'fail', 'needs_review')`),
}));

export const recordReviews = datasetSchema.table('record_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordId: uuid('record_id').notNull().references(() => records.id, { onDelete: 'cascade' }),
  recordVersionId: uuid('record_version_id').notNull().references(() => recordVersions.id),
  status: text('status').notNull().default('pending'),
  submittedBy: uuid('submitted_by').references(() => users.id),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  submissionNote: text('submission_note'),
  decisionNote: text('decision_note'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
}, (table) => ({
  pendingRecordUnique: uniqueIndex('record_reviews_one_pending_per_record_unique')
    .on(table.recordId).where(sql`${table.status} = 'pending'`),
  queueIndex: index('record_reviews_pending_queue_idx').on(table.submittedAt, table.id)
    .where(sql`${table.status} = 'pending'`),
  versionIdIndex: index('record_reviews_record_version_id_idx').on(table.recordVersionId),
  submittedByIndex: index('record_reviews_submitted_by_idx').on(table.submittedBy),
  reviewedByIndex: index('record_reviews_reviewed_by_idx').on(table.reviewedBy),
  statusCheck: check('record_reviews_status_check', sql`${table.status} IN ('pending', 'approved', 'rejected', 'changes_requested')`),
}));

export const importJobs = datasetSchema.table('import_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  format: text('format').notNull(),
  mode: text('mode').notNull().default('sync'),
  status: text('status').notNull().default('running'),
  idempotencyKey: text('idempotency_key').notNull(),
  fileName: text('file_name'),
  contentHash: text('content_hash').notNull(),
  byteSize: integer('byte_size').notNull(),
  rawContent: text('raw_content'),
  objectKey: text('object_key'),
  options: jsonb('options').notNull().default({}),
  totalCount: integer('total_count').notNull().default(0),
  succeededCount: integer('succeeded_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  processedCount: integer('processed_count').notNull().default(0),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  workerId: text('worker_id'),
  errorMessage: text('error_message'),
  sourceId: uuid('source_id').references(() => sources.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  creatorIdempotencyUnique: uniqueIndex('import_jobs_creator_idempotency_unique')
    .on(table.createdBy, table.idempotencyKey),
  creatorTimelineIndex: index('import_jobs_creator_timeline_idx').on(table.createdBy, table.createdAt),
  sourceIdIndex: index('import_jobs_source_id_idx').on(table.sourceId),
  runningIndex: index('import_jobs_running_idx').on(table.createdAt)
    .where(sql`${table.status} IN ('queued', 'running', 'processing')`),
  modeCheck: check('import_jobs_mode_check', sql`${table.mode} IN ('sync', 'async')`),
  formatCheck: check('import_jobs_format_check', sql`${table.format} IN ('json', 'jsonl', 'csv')`),
  statusCheck: check('import_jobs_status_check', sql`${table.status} IN ('queued', 'running', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled')`),
  countsCheck: check('import_jobs_counts_check', sql`${table.totalCount} >= 0 AND ${table.succeededCount} >= 0 AND ${table.failedCount} >= 0`),
  completedCountsCheck: check(
    'import_jobs_completed_counts_check',
    sql`${table.status} IN ('queued', 'running', 'processing', 'cancelled') OR ${table.totalCount} = ${table.succeededCount} + ${table.failedCount}`,
  ),
}));

export const importItems = datasetSchema.table('import_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  importJobId: uuid('import_job_id').notNull().references(() => importJobs.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  status: text('status').notNull(),
  recordId: uuid('record_id').references(() => records.id),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  jobRowUnique: uniqueIndex('import_items_job_row_unique').on(table.importJobId, table.rowNumber),
  recordIdIndex: index('import_items_record_id_idx').on(table.recordId),
  statusCheck: check('import_items_status_check', sql`${table.status} IN ('succeeded', 'failed')`),
  rowNumberCheck: check('import_items_row_number_check', sql`${table.rowNumber} > 0`),
}));

export const exportJobs = datasetSchema.table('export_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  format: text('format').notNull(),
  mode: text('mode').notNull().default('sync'),
  status: text('status').notNull().default('completed'),
  idempotencyKey: text('idempotency_key'),
  filters: jsonb('filters').notNull().default({}),
  recordCount: integer('record_count').notNull().default(0),
  byteSize: integer('byte_size').notNull().default(0),
  contentHash: text('content_hash'),
  objectKey: text('object_key'),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  workerId: text('worker_id'),
  errorMessage: text('error_message'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  creatorTimelineIndex: index('export_jobs_creator_timeline_idx').on(table.createdBy, table.createdAt),
  creatorIdempotencyUnique: uniqueIndex('export_jobs_creator_idempotency_unique')
    .on(table.createdBy, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`),
  queuedIndex: index('export_jobs_queued_idx').on(table.createdAt)
    .where(sql`${table.status} IN ('queued', 'processing')`),
  modeCheck: check('export_jobs_mode_check', sql`${table.mode} IN ('sync', 'async')`),
  formatCheck: check('export_jobs_format_check', sql`${table.format} IN ('json', 'jsonl', 'csv')`),
  statusCheck: check('export_jobs_status_check', sql`${table.status} IN ('queued', 'processing', 'completed', 'failed', 'cancelled')`),
  countsCheck: check('export_jobs_counts_check', sql`${table.recordCount} >= 0 AND ${table.byteSize} >= 0`),
}));

export const datasetDefinitions = datasetSchema.table('dataset_definitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  filters: jsonb('filters').notNull().default({}),
  manifestFormat: text('manifest_format').notNull().default('json'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (table) => ({
  creatorNameUnique: uniqueIndex('dataset_definitions_creator_name_unique').on(table.createdBy, table.name),
  creatorTimelineIndex: index('dataset_definitions_creator_timeline_idx').on(table.createdBy, table.updatedAt),
  activeIndex: index('dataset_definitions_active_idx').on(table.updatedAt).where(sql`${table.deletedAt} IS NULL`),
  manifestFormatCheck: check('dataset_definitions_manifest_format_check', sql`${table.manifestFormat} IN ('json', 'jsonl')`),
}));

export const datasetSnapshots = datasetSchema.table('dataset_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  definitionId: uuid('definition_id').notNull().references(() => datasetDefinitions.id),
  status: text('status').notNull().default('building'),
  definitionRevision: timestamp('definition_revision', { withTimezone: true }).notNull(),
  filters: jsonb('filters').notNull(),
  manifestFormat: text('manifest_format').notNull(),
  recordCount: integer('record_count').notNull().default(0),
  manifestObjectKey: text('manifest_object_key'),
  manifestHash: text('manifest_hash'),
  errorMessage: text('error_message'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  definitionTimelineIndex: index('dataset_snapshots_definition_timeline_idx').on(table.definitionId, table.createdAt),
  createdByIndex: index('dataset_snapshots_created_by_idx').on(table.createdBy),
  buildingIndex: index('dataset_snapshots_building_idx').on(table.createdAt).where(sql`${table.status} = 'building'`),
  statusCheck: check('dataset_snapshots_status_check', sql`${table.status} IN ('building', 'completed', 'failed')`),
  formatCheck: check('dataset_snapshots_format_check', sql`${table.manifestFormat} IN ('json', 'jsonl')`),
  countCheck: check('dataset_snapshots_record_count_check', sql`${table.recordCount} >= 0`),
}));

export const datasetSnapshotRecords = datasetSchema.table('dataset_snapshot_records', {
  snapshotId: uuid('snapshot_id').notNull().references(() => datasetSnapshots.id, { onDelete: 'cascade' }),
  recordId: uuid('record_id').notNull().references(() => records.id),
  recordVersionId: uuid('record_version_id').notNull().references(() => recordVersions.id),
  ordinal: integer('ordinal').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  primaryKey: primaryKey({ columns: [table.snapshotId, table.recordId] }),
  snapshotOrdinalUnique: uniqueIndex('dataset_snapshot_records_snapshot_ordinal_unique').on(table.snapshotId, table.ordinal),
  recordIdIndex: index('dataset_snapshot_records_record_id_idx').on(table.recordId),
  versionIdIndex: index('dataset_snapshot_records_version_id_idx').on(table.recordVersionId),
  ordinalCheck: check('dataset_snapshot_records_ordinal_check', sql`${table.ordinal} > 0`),
}));

export const trainingModels = trainingSchema.table('models', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  provider: text('provider'),
  modelFamily: text('model_family'),
  modelVersion: text('model_version'),
  baseModel: text('base_model'),
  configuration: jsonb('configuration').notNull().default({}),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (table) => ({
  creatorNameUnique: uniqueIndex('training_models_creator_name_unique').on(table.createdBy, table.name),
  creatorTimelineIndex: index('training_models_creator_timeline_idx').on(table.createdBy, table.updatedAt),
  activeIndex: index('training_models_active_idx').on(table.updatedAt).where(sql`${table.deletedAt} IS NULL`),
}));

export const trainingRuns = trainingSchema.table('runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  runUid: text('run_uid').notNull(),
  modelId: uuid('model_id').notNull().references(() => trainingModels.id),
  modelSnapshot: jsonb('model_snapshot').notNull(),
  datasetSnapshotId: uuid('dataset_snapshot_id').notNull().references(() => datasetSnapshots.id),
  status: text('status').notNull().default('queued'),
  taskType: text('task_type').notNull(),
  transformer: jsonb('transformer').notNull(),
  parameters: jsonb('parameters').notNull().default({}),
  environment: jsonb('environment').notNull().default({}),
  codeRevision: text('code_revision'),
  seed: integer('seed'),
  outputObjectKey: text('output_object_key'),
  errorMessage: text('error_message'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => ({
  creatorUidUnique: uniqueIndex('training_runs_creator_uid_unique').on(table.createdBy, table.runUid),
  creatorTimelineIndex: index('training_runs_creator_timeline_idx').on(table.createdBy, table.createdAt),
  modelTimelineIndex: index('training_runs_model_timeline_idx').on(table.modelId, table.createdAt),
  snapshotTimelineIndex: index('training_runs_snapshot_timeline_idx').on(table.datasetSnapshotId, table.createdAt),
  activeQueueIndex: index('training_runs_active_queue_idx').on(table.createdAt)
    .where(sql`${table.status} IN ('queued', 'running')`),
  statusCheck: check('training_runs_status_check', sql`${table.status} IN ('queued', 'running', 'completed', 'failed', 'cancelled')`),
  seedCheck: check('training_runs_seed_check', sql`${table.seed} IS NULL OR ${table.seed} >= 0`),
  lifecycleCheck: check(
    'training_runs_lifecycle_check',
    sql`(${table.status} = 'queued' AND ${table.startedAt} IS NULL AND ${table.finishedAt} IS NULL)
      OR (${table.status} = 'running' AND ${table.startedAt} IS NOT NULL AND ${table.finishedAt} IS NULL)
      OR (${table.status} IN ('completed', 'failed') AND ${table.startedAt} IS NOT NULL AND ${table.finishedAt} IS NOT NULL)
      OR (${table.status} = 'cancelled' AND ${table.finishedAt} IS NOT NULL)`,
  ),
}));

export const trainingMetrics = trainingSchema.table('metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id').notNull().references(() => trainingRuns.id, { onDelete: 'cascade' }),
  step: integer('step').notNull().default(0),
  epoch: doublePrecision('epoch'),
  metricName: text('metric_name').notNull(),
  metricValue: doublePrecision('metric_value').notNull(),
  split: text('split').notNull().default('custom'),
  metadata: jsonb('metadata').notNull().default({}),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runMetricStepUnique: uniqueIndex('training_metrics_run_metric_split_step_unique')
    .on(table.runId, table.metricName, table.split, table.step),
  runTimelineIndex: index('training_metrics_run_timeline_idx').on(table.runId, table.recordedAt),
  metricTimelineIndex: index('training_metrics_name_timeline_idx').on(table.metricName, table.recordedAt),
  stepCheck: check('training_metrics_step_check', sql`${table.step} >= 0`),
  epochCheck: check('training_metrics_epoch_check', sql`${table.epoch} IS NULL OR ${table.epoch} >= 0`),
  valueCheck: check('training_metrics_value_check', sql`${table.metricValue} = ${table.metricValue}`),
  splitCheck: check('training_metrics_split_check', sql`${table.split} IN ('train', 'validation', 'test', 'holdout', 'custom')`),
}));

export const memoryExperiences = memorySchema.table('experiences', {
  id: uuid('id').defaultRandom().primaryKey(),
  experienceUid: text('experience_uid').notNull(),
  sourceId: uuid('source_id').references(() => sources.id),
  title: text('title'),
  stateBefore: jsonb('state_before'),
  eventSummary: jsonb('event_summary').notNull().default({}),
  stateAfter: jsonb('state_after'),
  reward: doublePrecision('reward').notNull().default(0),
  predictionError: doublePrecision('prediction_error').notNull().default(0),
  qualityScore: doublePrecision('quality_score').notNull().default(0.5),
  curriculumLevel: text('curriculum_level').notNull().default('raw'),
  splitName: text('split_name').notNull().default('unsplit'),
  metadata: jsonb('metadata').notNull().default({}),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (table) => ({
  creatorUidUnique: uniqueIndex('memory_experiences_creator_uid_unique').on(table.createdBy, table.experienceUid),
  activeCreatorTimelineIndex: index('memory_experiences_active_creator_timeline_idx')
    .on(table.createdBy, table.createdAt).where(sql`${table.deletedAt} IS NULL`),
  sourceIdIndex: index('memory_experiences_source_id_idx').on(table.sourceId),
  qualityCheck: check('memory_experiences_quality_check', sql`${table.qualityScore} BETWEEN 0 AND 1`),
  splitCheck: check('memory_experiences_split_check', sql`${table.splitName} IN ('unsplit', 'train', 'validation', 'test', 'holdout', 'custom')`),
}));

export const memoryEventIngestionBatches = memorySchema.table('event_ingestion_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  batchUid: text('batch_uid').notNull(),
  contentHash: text('content_hash').notNull(),
  eventCount: integer('event_count').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  creatorUidUnique: uniqueIndex('memory_event_batches_creator_uid_unique').on(table.createdBy, table.batchUid),
  creatorTimelineIndex: index('memory_event_batches_creator_timeline_idx').on(table.createdBy, table.createdAt),
  eventCountCheck: check('memory_event_batches_event_count_check', sql`${table.eventCount} BETWEEN 1 AND 500`),
}));

export const memoryEvents = memorySchema.table('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventUid: text('event_uid').notNull(),
  sourceId: uuid('source_id').references(() => sources.id),
  experienceId: uuid('experience_id').references(() => memoryExperiences.id),
  ingestionBatchId: uuid('ingestion_batch_id').references(() => memoryEventIngestionBatches.id),
  batchPosition: integer('batch_position'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  sequenceTime: doublePrecision('sequence_time'),
  duration: doublePrecision('duration'),
  modality: text('modality').notNull(),
  channel: text('channel'),
  eventType: text('event_type').notNull(),
  symbol: text('symbol'),
  payload: jsonb('payload').notNull().default({}),
  stateBefore: jsonb('state_before'),
  stateAfter: jsonb('state_after'),
  reward: doublePrecision('reward').notNull().default(0),
  predictionError: doublePrecision('prediction_error').notNull().default(0),
  confidence: doublePrecision('confidence').notNull().default(1),
  qualityScore: doublePrecision('quality_score').notNull().default(0.5),
  proposalSource: text('proposal_source').notNull(),
  extractorName: text('extractor_name'),
  extractorVersion: text('extractor_version'),
  verificationState: text('verification_state').notNull().default('unverified'),
  sourceHash: text('source_hash'),
  novelty: doublePrecision('novelty').notNull().default(0),
  priorityScore: doublePrecision('priority_score').notNull().default(0),
  metadata: jsonb('metadata').notNull().default({}),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (table) => ({
  creatorUidUnique: uniqueIndex('memory_events_creator_uid_unique').on(table.createdBy, table.eventUid),
  activeCreatorTimelineIndex: index('memory_events_active_creator_timeline_idx')
    .on(table.createdBy, table.occurredAt, table.createdAt).where(sql`${table.deletedAt} IS NULL`),
  experienceTimelineIndex: index('memory_events_experience_timeline_idx').on(table.experienceId, table.sequenceTime),
  ingestionBatchIndex: index('memory_events_ingestion_batch_idx').on(table.ingestionBatchId, table.createdAt),
  ingestionBatchPositionUnique: uniqueIndex('memory_events_ingestion_batch_position_unique')
    .on(table.ingestionBatchId, table.batchPosition).where(sql`${table.ingestionBatchId} IS NOT NULL`),
  sourceIdIndex: index('memory_events_source_id_idx').on(table.sourceId),
  modalityTypeIndex: index('memory_events_modality_type_idx').on(table.modality, table.eventType, table.createdAt),
  durationCheck: check('memory_events_duration_check', sql`${table.duration} IS NULL OR ${table.duration} >= 0`),
  confidenceCheck: check('memory_events_confidence_check', sql`${table.confidence} BETWEEN 0 AND 1`),
  qualityCheck: check('memory_events_quality_check', sql`${table.qualityScore} BETWEEN 0 AND 1`),
  noveltyCheck: check('memory_events_novelty_check', sql`${table.novelty} BETWEEN 0 AND 1`),
  verificationCheck: check('memory_events_verification_check', sql`${table.verificationState} IN ('unverified', 'candidate', 'verified', 'rejected')`),
  batchPositionCheck: check('memory_events_batch_position_check', sql`(${table.ingestionBatchId} IS NULL AND ${table.batchPosition} IS NULL) OR (${table.ingestionBatchId} IS NOT NULL AND ${table.batchPosition} > 0)`),
}));

export const memoryEntities = memorySchema.table('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityUid: text('entity_uid').notNull(),
  entityType: text('entity_type').notNull(),
  canonicalName: text('canonical_name'),
  description: text('description'),
  properties: jsonb('properties').notNull().default({}),
  confidence: doublePrecision('confidence').notNull().default(0.5),
  verificationState: text('verification_state').notNull().default('unverified'),
  proposalSource: text('proposal_source').notNull(),
  sourceId: uuid('source_id').references(() => sources.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (table) => ({
  creatorUidUnique: uniqueIndex('memory_entities_creator_uid_unique').on(table.createdBy, table.entityUid),
  activeCreatorTimelineIndex: index('memory_entities_active_creator_timeline_idx')
    .on(table.createdBy, table.updatedAt).where(sql`${table.deletedAt} IS NULL`),
  typeNameIndex: index('memory_entities_type_name_idx').on(table.entityType, table.canonicalName),
  sourceIdIndex: index('memory_entities_source_id_idx').on(table.sourceId),
  confidenceCheck: check('memory_entities_confidence_check', sql`${table.confidence} BETWEEN 0 AND 1`),
  verificationCheck: check('memory_entities_verification_check', sql`${table.verificationState} IN ('unverified', 'candidate', 'verified', 'rejected')`),
}));

export const memoryEntityAliases = memorySchema.table('entity_aliases', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityId: uuid('entity_id').notNull().references(() => memoryEntities.id),
  alias: text('alias').notNull(),
  normalizedAlias: text('normalized_alias').notNull(),
  languageCode: text('language_code').notNull().default('und'),
  aliasType: text('alias_type').notNull().default('name'),
  confidence: doublePrecision('confidence').notNull().default(0.5),
  proposalSource: text('proposal_source').notNull(),
  verificationState: text('verification_state').notNull().default('unverified'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (table) => ({
  activeEntityAliasUnique: uniqueIndex('memory_entity_aliases_active_unique')
    .on(table.entityId, table.languageCode, table.normalizedAlias).where(sql`${table.deletedAt} IS NULL`),
  entityTimelineIndex: index('memory_entity_aliases_entity_timeline_idx').on(table.entityId, table.createdAt),
  activeLookupIndex: index('memory_entity_aliases_active_lookup_idx')
    .on(table.normalizedAlias, table.languageCode).where(sql`${table.deletedAt} IS NULL`),
  createdByIndex: index('memory_entity_aliases_created_by_idx').on(table.createdBy),
  confidenceCheck: check('memory_entity_aliases_confidence_check', sql`${table.confidence} BETWEEN 0 AND 1`),
  verificationCheck: check('memory_entity_aliases_verification_check', sql`${table.verificationState} IN ('unverified', 'candidate', 'verified', 'rejected')`),
}));

export const memoryConcepts = memorySchema.table('concepts', {
  id: uuid('id').defaultRandom().primaryKey(),
  conceptUid: text('concept_uid').notNull(),
  label: text('label'),
  conceptType: text('concept_type').notNull(),
  description: text('description'),
  evidenceCount: integer('evidence_count').notNull().default(0),
  contradictionCount: integer('contradiction_count').notNull().default(0),
  verificationState: text('verification_state').notNull().default('unverified'),
  proposalSource: text('proposal_source').notNull(),
  utilityScore: doublePrecision('utility_score').notNull().default(0),
  eventPattern: jsonb('event_pattern'),
  payload: jsonb('payload').notNull().default({}),
  sourceId: uuid('source_id').references(() => sources.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (table) => ({
  creatorUidUnique: uniqueIndex('memory_concepts_creator_uid_unique').on(table.createdBy, table.conceptUid),
  activeCreatorTimelineIndex: index('memory_concepts_active_creator_timeline_idx')
    .on(table.createdBy, table.updatedAt).where(sql`${table.deletedAt} IS NULL`),
  typeLabelIndex: index('memory_concepts_type_label_idx').on(table.conceptType, table.label),
  sourceIdIndex: index('memory_concepts_source_id_idx').on(table.sourceId),
  countsCheck: check('memory_concepts_counts_check', sql`${table.evidenceCount} >= 0 AND ${table.contradictionCount} >= 0`),
  verificationCheck: check('memory_concepts_verification_check', sql`${table.verificationState} IN ('unverified', 'candidate', 'verified', 'rejected')`),
}));

export const memoryRelations = memorySchema.table('relations', {
  id: uuid('id').defaultRandom().primaryKey(),
  relationUid: text('relation_uid').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  relationType: text('relation_type').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  strength: doublePrecision('strength').notNull().default(0.5),
  confidence: doublePrecision('confidence').notNull().default(0.5),
  evidenceCount: integer('evidence_count').notNull().default(0),
  counterexampleCount: integer('counterexample_count').notNull().default(0),
  minDelayMs: doublePrecision('min_delay_ms'),
  maxDelayMs: doublePrecision('max_delay_ms'),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  verificationState: text('verification_state').notNull().default('unverified'),
  proposalSource: text('proposal_source').notNull(),
  context: jsonb('context').notNull().default({}),
  payload: jsonb('payload').notNull().default({}),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (table) => ({
  creatorUidUnique: uniqueIndex('memory_relations_creator_uid_unique').on(table.createdBy, table.relationUid),
  activeCreatorTimelineIndex: index('memory_relations_active_creator_timeline_idx')
    .on(table.createdBy, table.createdAt).where(sql`${table.deletedAt} IS NULL`),
  activeSourceIndex: index('memory_relations_active_source_idx')
    .on(table.sourceType, table.sourceId, table.createdAt).where(sql`${table.deletedAt} IS NULL`),
  activeTargetIndex: index('memory_relations_active_target_idx')
    .on(table.targetType, table.targetId, table.createdAt).where(sql`${table.deletedAt} IS NULL`),
  relationTypeIndex: index('memory_relations_type_idx').on(table.relationType, table.createdAt),
  strengthCheck: check('memory_relations_strength_check', sql`${table.strength} BETWEEN 0 AND 1`),
  confidenceCheck: check('memory_relations_confidence_check', sql`${table.confidence} BETWEEN 0 AND 1`),
  countsCheck: check('memory_relations_counts_check', sql`${table.evidenceCount} >= 0 AND ${table.counterexampleCount} >= 0`),
  nodeTypeCheck: check('memory_relations_node_type_check', sql`${table.sourceType} IN ('event', 'experience', 'entity', 'concept', 'record', 'dataset_snapshot', 'model') AND ${table.targetType} IN ('event', 'experience', 'entity', 'concept', 'record', 'dataset_snapshot', 'model')`),
  delayCheck: check('memory_relations_delay_check', sql`(${table.minDelayMs} IS NULL OR ${table.minDelayMs} >= 0) AND (${table.maxDelayMs} IS NULL OR ${table.maxDelayMs} >= 0) AND (${table.minDelayMs} IS NULL OR ${table.maxDelayMs} IS NULL OR ${table.minDelayMs} <= ${table.maxDelayMs})`),
  validityCheck: check('memory_relations_validity_check', sql`${table.validFrom} IS NULL OR ${table.validUntil} IS NULL OR ${table.validFrom} <= ${table.validUntil}`),
  verificationCheck: check('memory_relations_verification_check', sql`${table.verificationState} IN ('unverified', 'candidate', 'verified', 'rejected')`),
}));

export const memoryRelationEvidence = memorySchema.table('relation_evidence', {
  id: uuid('id').defaultRandom().primaryKey(),
  evidenceUid: text('evidence_uid').notNull(),
  relationId: uuid('relation_id').notNull().references(() => memoryRelations.id, { onDelete: 'cascade' }),
  evidenceType: text('evidence_type').notNull(),
  referenceType: text('reference_type').notNull(),
  referenceId: uuid('reference_id'),
  supports: boolean('supports').notNull(),
  weight: doublePrecision('weight').notNull().default(1),
  details: jsonb('details').notNull().default({}),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  relationUidUnique: uniqueIndex('memory_relation_evidence_relation_uid_unique').on(table.relationId, table.evidenceUid),
  relationTimelineIndex: index('memory_relation_evidence_relation_timeline_idx').on(table.relationId, table.createdAt),
  referenceIndex: index('memory_relation_evidence_reference_idx').on(table.referenceType, table.referenceId),
  createdByIndex: index('memory_relation_evidence_created_by_idx').on(table.createdBy),
  weightCheck: check('memory_relation_evidence_weight_check', sql`${table.weight} > 0`),
  referenceTypeCheck: check('memory_relation_evidence_reference_type_check', sql`${table.referenceType} IN ('source', 'record', 'event', 'experience', 'entity', 'concept', 'dataset_snapshot', 'model', 'external')`),
  referencePresenceCheck: check('memory_relation_evidence_reference_presence_check', sql`(${table.referenceType} = 'external' AND ${table.referenceId} IS NULL) OR (${table.referenceType} <> 'external' AND ${table.referenceId} IS NOT NULL)`),
}));

export const memoryVerificationDecisions = memorySchema.table('verification_decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  notes: text('notes'),
  metadata: jsonb('metadata').notNull().default({}),
  decidedBy: uuid('decided_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  targetTimelineIndex: index('memory_verification_target_timeline_idx').on(table.targetType, table.targetId, table.createdAt),
  decidedByIndex: index('memory_verification_decided_by_idx').on(table.decidedBy),
  targetTypeCheck: check('memory_verification_target_type_check', sql`${table.targetType} IN ('event', 'entity', 'entity_alias', 'concept', 'relation')`),
  stateCheck: check('memory_verification_state_check', sql`${table.fromState} IN ('unverified', 'candidate', 'verified', 'rejected') AND ${table.toState} IN ('candidate', 'verified', 'rejected') AND ${table.fromState} <> ${table.toState}`),
}));

export const auditLogs = systemSchema.table('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id'),
  requestId: text('request_id'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  beforeData: jsonb('before_data'),
  afterData: jsonb('after_data'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  createdAtIndex: index('audit_logs_created_at_idx').on(table.createdAt),
  actionTimelineIndex: index('audit_logs_action_timeline_idx').on(table.action, table.createdAt),
  resourceTimelineIndex: index('audit_logs_resource_timeline_idx')
    .on(table.resourceType, table.resourceId, table.createdAt),
  actorTimelineIndex: index('audit_logs_actor_timeline_idx')
    .on(table.actorId, table.createdAt),
  requestIdIndex: index('audit_logs_request_id_idx').on(table.requestId),
  actorTypeCheck: check(
    'audit_logs_actor_type_check',
    sql`${table.actorType} IN ('user', 'api_key', 'system')`,
  ),
  actionCheck: check(
    'audit_logs_action_check',
    sql`${table.action} IN ('create', 'update', 'delete', 'restore', 'submit_review', 'approve', 'reject', 'request_changes')`,
  ),
  resourceTypeCheck: check(
    'audit_logs_resource_type_check',
    sql`${table.resourceType} IN ('source', 'record')`,
  ),
}));
