// /apps/api/src/app.js
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getReadiness } from './services/readiness.js';
import authRoutes from './routes/auth.js';
import recordsRoutes from './routes/records.js';

const app = new Hono();
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use('*', cors({
  origin: (origin) => allowedOrigins.has(origin) ? origin : '',
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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
  },
}));

app.route('/auth', authRoutes);
app.route('/api/v1/auth', authRoutes);
app.route('/records', recordsRoutes);
app.route('/api/v1/records', recordsRoutes);

export default app;
