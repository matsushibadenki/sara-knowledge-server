// /apps/api/src/db/schema/index.js
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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
});

export const refreshTokens = authSchema.table('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  replacedById: uuid('replaced_by_id'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
});

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
});

export const records = datasetSchema.table('records', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordType: text('record_type').notNull(),
  title: text('title'),
  status: text('status').notNull().default('draft'),
  currentVersionId: uuid('current_version_id'),
  languageCode: text('language_code'),
  qualityScore: doublePrecision('quality_score'),
  confidence: doublePrecision('confidence'),
  sourceId: uuid('source_id').references(() => sources.id),
  ownerId: uuid('owner_id').references(() => users.id),
  externalSystem: text('external_system'),
  externalId: text('external_id'),
  metadata: jsonb('metadata').notNull().default({}),
  ...auditColumns,
});

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
});
