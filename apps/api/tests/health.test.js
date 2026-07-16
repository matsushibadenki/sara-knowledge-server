// /apps/api/tests/health.test.js
import { describe, expect, test } from 'bun:test';
import app from '../src/app.js';

describe('health endpoints', () => {
  test('returns a live response', async () => {
    const response = await app.request('/health/live');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: 'alive' } });
  });
});
