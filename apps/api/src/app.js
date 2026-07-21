// /apps/api/src/app.js
import { Hono } from 'hono';
import { getReadiness } from './services/readiness.js';
import authRoutes from './routes/auth.js';
import recordsRoutes from './routes/records.js';

const app = new Hono();

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
  servers: [{ url: '/api/v1' }],
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
    '/records': { get: { summary: 'List records' }, post: { summary: 'Create a record' } },
    '/records/{id}': { get: { summary: 'Get a record' }, patch: { summary: 'Create a new record version' }, delete: { summary: 'Soft delete a record' } },
    '/records/{id}/versions': { get: { summary: 'List record versions' } },
    '/records/{id}/restore': { post: { summary: 'Restore a soft-deleted record' } },
  },
}));

app.route('/auth', authRoutes);
app.route('/api/v1/auth', authRoutes);
app.route('/records', recordsRoutes);
app.route('/api/v1/records', recordsRoutes);

export default app;
