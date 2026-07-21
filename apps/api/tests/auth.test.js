// /apps/api/tests/auth.test.js
import { describe, expect, test } from 'bun:test';
import { signAccessToken, verifyAccessToken } from '../src/auth/tokens.js';
import app from '../src/app.js';

describe('access tokens', () => {
  test('signs and verifies an access token', async () => {
    process.env.JWT_SECRET = 'test-secret-with-enough-entropy';
    const token = await signAccessToken({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@example.com',
      role: 'admin',
      locale: 'ja',
    });
    const payload = await verifyAccessToken(token);

    expect(payload.sub).toBe('00000000-0000-0000-0000-000000000001');
    expect(payload.role).toBe('admin');
    expect(payload.token_type).toBe('access');
  });

  test('rejects an unauthenticated me request', async () => {
    const response = await app.request('/auth/me');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });
});
