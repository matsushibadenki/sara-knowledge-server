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
