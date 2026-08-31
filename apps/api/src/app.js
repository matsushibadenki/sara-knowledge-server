// /apps/api/src/app.js
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getReadiness } from './services/readiness.js';
import authRoutes from './routes/auth.js';
import recordsRoutes from './routes/records.js';
import sourcesRoutes from './routes/sources.js';
import auditLogRoutes from './routes/audit-logs.js';
import recordQualityRoutes, { reviewQueueRoutes } from './routes/record-quality.js';
import { exportRoutes, importRoutes } from './routes/import-export.js';
import datasetRoutes from './routes/datasets.js';
import trainingRoutes from './routes/training.js';
import memoryRoutes from './routes/memory.js';

const app = new Hono();
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  await next();
});

app.use('*', cors({
  origin: (origin) => allowedOrigins.has(origin) ? origin : '',
  allowHeaders: ['Authorization', 'Content-Type', 'X-SARA-Timestamp', 'X-SARA-Nonce', 'X-SARA-Idempotency-Key', 'X-SARA-Signature'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['X-Request-ID', 'X-Export-ID', 'X-Content-SHA256', 'Content-Disposition'],
  maxAge: 86400,
}));

app.onError((error, c) => {
  console.error(JSON.stringify({
    level: 'error',
    service: 'api',
    method: c.req.method,
    path: c.req.path,
    message: error instanceof Error ? error.message : 'Unexpected error',
  }));
  return c.json({
    data: null,
    meta: {},
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', details: [] },
  }, 500);
});

app.notFound((c) => c.json({
  data: null,
  meta: {},
  error: { code: 'RESOURCE_NOT_FOUND', message: 'Endpoint was not found.', details: [] },
}, 404));

app.get('/health', (c) => c.json({
  data: {
    service: 'sara-knowledge-api',
    status: 'ok',
  },
  meta: {},
  error: null,
}));

app.get('/health/live', (c) => c.json({
  data: { status: 'alive' },
  meta: {},
  error: null,
}));

app.get('/health/ready', async (c) => {
  const readiness = await getReadiness();

  return c.json({
    data: {
      status: readiness.ready ? 'ready' : 'not_ready',
      dependencies: readiness.dependencies,
    },
    meta: {},
    error: null,
  }, readiness.ready ? 200 : 503);
});

app.get('/openapi.json', (c) => c.json({
  openapi: '3.1.0',
  info: {
    title: 'SARA Knowledge API',
    version: '0.1.0',
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'JWT access token or a sara_ prefixed API key.',
      },
    },
  },
  paths: {
    '/health': { get: { summary: 'Service health' } },
    '/health/live': { get: { summary: 'Liveness probe' } },
    '/health/ready': { get: { summary: 'Readiness probe' } },
    '/auth/login': { post: { summary: 'Login with email and password' } },
    '/auth/me': { get: { summary: 'Get the authenticated user' } },
    '/auth/refresh': { post: { summary: 'Rotate a refresh token' } },
    '/auth/logout': { post: { summary: 'Revoke a refresh token' } },
    '/auth/api-keys': { get: { summary: 'List API keys' }, post: { summary: 'Create an API key' } },
    '/auth/api-keys/{id}': { delete: { summary: 'Revoke an API key' } },
    '/records': {
      get: { summary: 'List records', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:read', 'x-allowed-user-roles': ['admin', 'editor', 'reviewer', 'viewer'] },
      post: { summary: 'Create a record', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:write', 'x-allowed-user-roles': ['admin', 'editor'] },
    },
    '/records/{id}': {
      get: { summary: 'Get a record', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:read', 'x-allowed-user-roles': ['admin', 'editor', 'reviewer', 'viewer'] },
      patch: { summary: 'Create a new record version', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:write', 'x-allowed-user-roles': ['admin', 'editor'] },
      delete: { summary: 'Soft delete a record', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:write', 'x-allowed-user-roles': ['admin', 'editor'] },
    },
    '/records/{id}/versions': {
      get: { summary: 'List record versions', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:read', 'x-allowed-user-roles': ['admin', 'editor', 'reviewer', 'viewer'] },
    },
    '/records/{id}/restore': {
      post: { summary: 'Restore a soft-deleted record', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:write', 'x-allowed-user-roles': ['admin', 'editor'] },
    },
    '/records/{id}/tags': {
      get: { summary: 'List record tags', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:read' },
      post: { summary: 'Assign normalized tags', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:write' },
    },
    '/records/{id}/annotations': {
      get: { summary: 'List version-bound annotations', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:read' },
      post: { summary: 'Create a version-bound annotation', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:write' },
    },
    '/records/{id}/evaluations': {
      get: { summary: 'List version-bound evaluations', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:read' },
      post: { summary: 'Create an immutable evaluation', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:write' },
    },
    '/records/{id}/submit-review': {
      post: { summary: 'Submit the current record version for review', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:write' },
    },
    '/records/{id}/reviews/{reviewId}/decision': {
      post: { summary: 'Approve, reject, or request changes', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:approve', 'x-allowed-user-roles': ['admin', 'reviewer'] },
    },
    '/review-queue': {
      get: { summary: 'List pending record reviews', security: [{ bearerAuth: [] }], 'x-required-scope': 'records:approve', 'x-allowed-user-roles': ['admin', 'reviewer'] },
    },
    '/imports': {
      get: { summary: 'List import jobs owned by the caller', security: [{ bearerAuth: [] }], 'x-required-scope': 'imports:create' },
      post: { summary: 'Import JSON, JSONL, or CSV records', security: [{ bearerAuth: [] }], 'x-required-scope': 'imports:create' },
    },
    '/imports/{id}': {
      get: { summary: 'Get import row results', security: [{ bearerAuth: [] }], 'x-required-scope': 'imports:create' },
    },
    '/imports/async': {
      post: { summary: 'Store an import source in MinIO and enqueue it', security: [{ bearerAuth: [] }], 'x-required-scope': 'imports:create' },
    },
    '/imports/{id}/cancel': {
      post: { summary: 'Request cancellation of an async import', security: [{ bearerAuth: [] }], 'x-required-scope': 'imports:create' },
    },
    '/exports': {
      post: { summary: 'Export current Record versions as JSON, JSONL, or CSV', security: [{ bearerAuth: [] }], 'x-required-scope': 'exports:create' },
    },
    '/exports/{id}': {
      get: { summary: 'Get export metadata', security: [{ bearerAuth: [] }], 'x-required-scope': 'exports:create' },
    },
    '/exports/async': {
      post: { summary: 'Enqueue an export to MinIO', security: [{ bearerAuth: [] }], 'x-required-scope': 'exports:create' },
    },
    '/exports/{id}/download': {
      get: { summary: 'Download a completed async export', security: [{ bearerAuth: [] }], 'x-required-scope': 'exports:create' },
    },
    '/exports/{id}/cancel': {
      post: { summary: 'Request cancellation of an async export', security: [{ bearerAuth: [] }], 'x-required-scope': 'exports:create' },
    },
    '/datasets': {
      get: { summary: 'List reusable dataset definitions', security: [{ bearerAuth: [] }], 'x-required-scope': 'datasets:read' },
      post: { summary: 'Create a dataset definition', security: [{ bearerAuth: [] }], 'x-required-scope': 'datasets:write' },
    },
    '/datasets/{id}': {
      get: { summary: 'Get a dataset definition', security: [{ bearerAuth: [] }], 'x-required-scope': 'datasets:read' },
      patch: { summary: 'Update a dataset definition', security: [{ bearerAuth: [] }], 'x-required-scope': 'datasets:write' },
    },
    '/datasets/{id}/snapshots': {
      get: { summary: 'List immutable snapshots', security: [{ bearerAuth: [] }], 'x-required-scope': 'datasets:read' },
      post: { summary: 'Freeze current matching Record versions and create a manifest', security: [{ bearerAuth: [] }], 'x-required-scope': 'datasets:write' },
    },
    '/datasets/{id}/snapshots/{snapshotId}/manifest': {
      get: { summary: 'Download an immutable training manifest', security: [{ bearerAuth: [] }], 'x-required-scope': 'datasets:read' },
    },
    '/training/models': {
      get: { summary: 'List owned model definitions', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:read' },
      post: { summary: 'Register a model definition', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:write' },
    },
    '/training/models/{id}': {
      get: { summary: 'Get a model definition', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:read' },
      patch: { summary: 'Update a model definition', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:write' },
    },
    '/training/runs': {
      get: { summary: 'List owned training runs', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:read' },
      post: { summary: 'Create a reproducible run from a completed dataset snapshot', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:write' },
    },
    '/training/runs/{id}': {
      get: { summary: 'Get a training run with append-only metrics', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:read' },
    },
    '/training/runs/{id}/status': {
      post: { summary: 'Apply a guarded training run status transition', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:write' },
    },
    '/training/runs/{id}/metrics': {
      get: { summary: 'List append-only run metrics', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:read' },
      post: { summary: 'Append a run metric', security: [{ bearerAuth: [] }], 'x-required-scope': 'training:write' },
    },
    '/memory/experiences': {
      get: { summary: 'List owned experiences', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
      post: { summary: 'Create a provenance-bound experience', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:write' },
    },
    '/memory/events': {
      get: { summary: 'List owned events', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
      post: { summary: 'Create a temporal event', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:write' },
    },
    '/memory/events/bulk': {
      post: {
        summary: 'Atomically ingest an idempotent event batch',
        description: 'API keys additionally require X-SARA-Timestamp, X-SARA-Nonce, X-SARA-Idempotency-Key, and X-SARA-Signature. JWT requests do not.',
        security: [{ bearerAuth: [] }],
        'x-required-scope': 'memory:write',
        'x-api-key-hmac-required': true,
      },
    },
    '/memory/entities': {
      get: { summary: 'List owned entities', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
      post: { summary: 'Create an entity candidate', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:write' },
    },
    '/memory/entities/{id}/aliases': {
      get: { summary: 'List normalized entity aliases', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
      post: { summary: 'Create an entity alias candidate', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:write' },
    },
    '/memory/concepts': {
      get: { summary: 'List owned concepts', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
      post: { summary: 'Create a concept candidate', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:write' },
    },
    '/memory/relations': {
      get: { summary: 'List owned typed relations', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
      post: { summary: 'Create a relation after validating both nodes', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:write' },
    },
    '/memory/relations/{id}/evidence': {
      get: { summary: 'List append-only relation evidence', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
      post: { summary: 'Append evidence and atomically update relation counts', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:write' },
    },
    '/memory/verification/{type}/{id}': {
      get: { summary: 'List verification decision history', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
      post: { summary: 'Apply a guarded verification transition', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:verify', 'x-allowed-user-roles': ['admin', 'reviewer'] },
    },
    '/memory/nodes/{type}/{id}/neighbors': {
      get: { summary: 'List incoming and outgoing active relations', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
    },
    '/memory/traverse': {
      post: { summary: 'Traverse an owned memory graph within hard depth and size limits', security: [{ bearerAuth: [] }], 'x-required-scope': 'memory:read' },
    },
    '/sources': {
      get: { summary: 'List sources', security: [{ bearerAuth: [] }], 'x-required-scope': 'sources:read', 'x-allowed-user-roles': ['admin', 'editor', 'reviewer', 'viewer'] },
      post: { summary: 'Create a source', security: [{ bearerAuth: [] }], 'x-required-scope': 'sources:write', 'x-allowed-user-roles': ['admin', 'editor'] },
    },
    '/sources/{id}': {
      get: { summary: 'Get a source and its active record usage count', security: [{ bearerAuth: [] }], 'x-required-scope': 'sources:read', 'x-allowed-user-roles': ['admin', 'editor', 'reviewer', 'viewer'] },
      patch: { summary: 'Update a source', security: [{ bearerAuth: [] }], 'x-required-scope': 'sources:write', 'x-allowed-user-roles': ['admin', 'editor'] },
      delete: { summary: 'Soft delete a source while retaining record provenance', security: [{ bearerAuth: [] }], 'x-required-scope': 'sources:write', 'x-allowed-user-roles': ['admin', 'editor'] },
    },
    '/sources/{id}/restore': {
      post: { summary: 'Restore a soft-deleted source', security: [{ bearerAuth: [] }], 'x-required-scope': 'sources:write', 'x-allowed-user-roles': ['admin', 'editor'] },
    },
    '/audit-logs': {
      get: { summary: 'List Source and Record audit logs', security: [{ bearerAuth: [] }], 'x-api-key-access': false, 'x-allowed-user-roles': ['admin'] },
    },
    '/audit-logs/{id}': {
      get: { summary: 'Get an audit log entry', security: [{ bearerAuth: [] }], 'x-api-key-access': false, 'x-allowed-user-roles': ['admin'] },
    },
  },
}));

app.route('/auth', authRoutes);
app.route('/api/v1/auth', authRoutes);
app.route('/records', recordsRoutes);
app.route('/api/v1/records', recordsRoutes);
app.route('/records', recordQualityRoutes);
app.route('/api/v1/records', recordQualityRoutes);
app.route('/review-queue', reviewQueueRoutes);
app.route('/api/v1/review-queue', reviewQueueRoutes);
app.route('/imports', importRoutes);
app.route('/api/v1/imports', importRoutes);
app.route('/exports', exportRoutes);
app.route('/api/v1/exports', exportRoutes);
app.route('/datasets', datasetRoutes);
app.route('/api/v1/datasets', datasetRoutes);
app.route('/training', trainingRoutes);
app.route('/api/v1/training', trainingRoutes);
app.route('/memory', memoryRoutes);
app.route('/api/v1/memory', memoryRoutes);
app.route('/sources', sourcesRoutes);
app.route('/api/v1/sources', sourcesRoutes);
app.route('/audit-logs', auditLogRoutes);
app.route('/api/v1/audit-logs', auditLogRoutes);

export default app;
