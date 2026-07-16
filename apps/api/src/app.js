// /apps/api/src/app.js
import { Hono } from 'hono';

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

app.get('/health/ready', (c) => c.json({
  data: {
    status: 'ready',
    dependencies: {
      postgres: 'pending',
      redis: 'pending',
      minio: 'pending',
    },
  },
  meta: {},
  error: null,
}));

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
  },
}));

app.route('/api/v1', new Hono());

export default app;
