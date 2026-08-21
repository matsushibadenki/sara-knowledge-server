// /apps/api/src/db/schema/index.js
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
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
}));
