// /apps/api/tests/auth.test.js
import { describe, expect, test } from 'bun:test';
import { signAccessToken, validateAuthConfig, verifyAccessToken } from '../src/auth/tokens.js';
import { hasRequiredRole, hasRequiredScope } from '../src/auth/middleware.js';
import app from '../src/app.js';

describe('access tokens', () => {
  test('signs and verifies an access token', async () => {
    const previousSecret = process.env.JWT_SECRET;
    try {
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
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  test('rejects an unauthenticated me request', async () => {
    const response = await app.request('/auth/me');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });

  test('requires user authentication before API key revocation', async () => {
    const response = await app.request('/auth/api-keys/not-a-uuid', { method: 'DELETE' });
    expect(response.status).toBe(401);
  });

  test('matches exact, resource wildcard, and global scopes', () => {
    expect(hasRequiredScope(['records:read'], 'records:read')).toBe(true);
    expect(hasRequiredScope(['records:*'], 'records:write')).toBe(true);
    expect(hasRequiredScope(['*'], 'records:write')).toBe(true);
    expect(hasRequiredScope(['records:read'], 'records:write')).toBe(false);
  });

  test('matches only explicitly allowed user roles', () => {
    expect(hasRequiredRole('editor', ['admin', 'editor'])).toBe(true);
    expect(hasRequiredRole('viewer', ['admin', 'editor'])).toBe(false);
    expect(hasRequiredRole(undefined, ['admin'])).toBe(false);
  });

  test('rejects a weak JWT secret in production', () => {
    const previousEnv = process.env.APP_ENV;
    const previousSecret = process.env.JWT_SECRET;
    try {
      process.env.APP_ENV = 'production';
      process.env.JWT_SECRET = 'change_me';
      expect(() => validateAuthConfig()).toThrow();
    } finally {
      if (previousEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previousEnv;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });
});
