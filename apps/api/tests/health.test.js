// /apps/api/tests/health.test.js
import { describe, expect, test } from 'bun:test';
import app from '../src/app.js';

describe('health endpoints', () => {
  test('returns a live response', async () => {
    const response = await app.request('/health/live');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: 'alive' } });
  });

  test('returns a consistent JSON error for an unknown endpoint', async () => {
    const response = await app.request('/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });
  });

  test('allows configured CORS origins', async () => {
    const allowedOrigin = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000').split(',')[0];
    const response = await app.request('/health/live', {
      headers: { Origin: allowedOrigin },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
  });
});
