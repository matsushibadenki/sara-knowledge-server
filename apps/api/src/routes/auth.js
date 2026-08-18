// /apps/api/src/routes/auth.js
import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { apiKeys, refreshTokens, users } from '../db/schema/index.js';
import { verifyPassword } from '../auth/passwords.js';
import { requireRoles, requireUserAuth } from '../auth/middleware.js';
import {
  clearLoginAttempts,
  consumeLoginAttempt,
  LoginRateLimitError,
} from '../auth/login-rate-limit.js';
import { signAccessToken } from '../auth/tokens.js';
import { createOpaqueSecret, durationToMilliseconds, hashSecret } from '../auth/secrets.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(20),
});

export const apiKeyScopes = [
  'records:read',
  'records:write',
  'records:approve',
  'datasets:read',
  'datasets:write',
  'memory:read',
  'memory:write',
  'imports:create',
  'exports:create',
  'assets:write',
  'webhooks:manage',
];

const apiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(apiKeyScopes)).max(apiKeyScopes.length)
    .transform((scopes) => [...new Set(scopes)])
    .default([]),
  expires_at: z.string().datetime().nullable().optional(),
}).refine(
  (value) => !value.expires_at || new Date(value.expires_at) > new Date(),
  { path: ['expires_at'], message: 'Expiration must be in the future.' },
);

const uuidSchema = z.string().uuid();

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    role: user.role,
    locale: user.locale,
    status: user.status,
  };
}

const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = loginSchema.safeParse(body);

  if (!result.success) {
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Email and password are required.',
        details: result.error.issues,
      },
    }, 400);
  }

  let rateLimit;
  try {
    rateLimit = await consumeLoginAttempt(result.data.email);
  } catch (error) {
    if (!(error instanceof LoginRateLimitError)) throw error;
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Login protection is temporarily unavailable.',
        details: [],
      },
    }, 503);
  }

  if (rateLimit.limited) {
    c.header('Retry-After', String(rateLimit.retryAfterSeconds));
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Try again later.',
        details: { retry_after_seconds: rateLimit.retryAfterSeconds },
      },
    }, 429);
  }

  const [user] = await db.select()
    .from(users)
    .where(and(eq(users.email, result.data.email.toLowerCase()), isNull(users.deletedAt)))
    .limit(1);

  if (!user || user.status !== 'active' || !user.passwordHash) {
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
        details: [],
      },
    }, 401);
  }

  const passwordMatches = await verifyPassword(result.data.password, user.passwordHash);

  if (!passwordMatches) {
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
        details: [],
      },
    }, 401);
  }

  try {
    await clearLoginAttempts(result.data.email);
  } catch (error) {
    if (!(error instanceof LoginRateLimitError)) throw error;
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Login protection is temporarily unavailable.',
        details: [],
      },
    }, 503);
  }

  await db.update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const accessToken = await signAccessToken(user);
  const refreshToken = createOpaqueSecret(48);
  const refreshTokenHash = await hashSecret(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + durationToMilliseconds(process.env.JWT_REFRESH_EXPIRES_IN, 30 * 86_400_000));

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: refreshTokenHash,
    expiresAt: refreshExpiresAt,
  });

  return c.json({
    data: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      refresh_token: refreshToken,
      refresh_expires_at: refreshExpiresAt.toISOString(),
      user: serializeUser(user),
    },
    meta: {},
    error: null,
  });
});

authRoutes.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = refreshSchema.safeParse(body);

  if (!result.success) {
    return c.json({
      data: null,
      meta: {},
      error: { code: 'VALIDATION_ERROR', message: 'Refresh token is required.', details: result.error.issues },
    }, 400);
  }

  const tokenHash = await hashSecret(result.data.refresh_token);
  const nextRefreshToken = createOpaqueSecret(48);
  const nextRefreshTokenHash = await hashSecret(nextRefreshToken);
  const nextRefreshTokenId = crypto.randomUUID();
  const refreshExpiresAt = new Date(Date.now() + durationToMilliseconds(process.env.JWT_REFRESH_EXPIRES_IN, 30 * 86_400_000));

  const rotation = await db.transaction(async (tx) => {
    const [storedToken] = await tx.select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)
      .for('update');

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt <= new Date()) return null;

    const [user] = await tx.select()
      .from(users)
      .where(and(eq(users.id, storedToken.userId), eq(users.status, 'active'), isNull(users.deletedAt)))
      .limit(1);
    if (!user) return null;

    const now = new Date();
    await tx.update(refreshTokens)
      .set({ revokedAt: now, lastUsedAt: now, replacedById: nextRefreshTokenId })
      .where(eq(refreshTokens.id, storedToken.id));
    await tx.insert(refreshTokens).values({
      id: nextRefreshTokenId,
      userId: user.id,
      tokenHash: nextRefreshTokenHash,
      expiresAt: refreshExpiresAt,
    });

    return { user };
  });

  if (!rotation) {
    return c.json({
      data: null,
      meta: {},
      error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired.', details: [] },
    }, 401);
  }

  return c.json({
    data: {
      access_token: await signAccessToken(rotation.user),
      token_type: 'Bearer',
      expires_in: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      refresh_token: nextRefreshToken,
      refresh_expires_at: refreshExpiresAt.toISOString(),
      user: serializeUser(rotation.user),
    },
    meta: {},
    error: null,
  });
});

authRoutes.post('/logout', async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = refreshSchema.safeParse(body);
  if (!result.success) {
    return c.json({
      data: null,
      meta: {},
      error: { code: 'VALIDATION_ERROR', message: 'Refresh token is required.', details: result.error.issues },
    }, 400);
  }

  await db.update(refreshTokens)
    .set({ revokedAt: new Date(), lastUsedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, await hashSecret(result.data.refresh_token)), isNull(refreshTokens.revokedAt)));

  return c.json({ data: { logged_out: true }, meta: {}, error: null });
});

authRoutes.get('/me', requireUserAuth, async (c) => {
  return c.json({ data: serializeUser(c.get('authUser')), meta: {}, error: null });
});

authRoutes.get('/api-keys', requireUserAuth, requireRoles('admin'), async (c) => {
  const auth = c.get('auth');
  const keys = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    key_prefix: apiKeys.keyPrefix,
    scopes: apiKeys.scopes,
    last_used_at: apiKeys.lastUsedAt,
    expires_at: apiKeys.expiresAt,
    revoked_at: apiKeys.revokedAt,
    created_at: apiKeys.createdAt,
  }).from(apiKeys).where(eq(apiKeys.userId, auth.sub));

  return c.json({ data: keys, meta: {}, error: null });
});

authRoutes.post('/api-keys', requireUserAuth, requireRoles('admin'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = apiKeySchema.safeParse(body);
  if (!result.success) {
    return c.json({
      data: null,
      meta: {},
      error: { code: 'VALIDATION_ERROR', message: 'API key input is invalid.', details: result.error.issues },
    }, 400);
  }

  const auth = c.get('auth');
  const key = `sara_${createOpaqueSecret(9)}_${createOpaqueSecret(32)}`;
  const keyHash = await hashSecret(key);
  const [created] = await db.insert(apiKeys).values({
    userId: auth.sub,
    name: result.data.name,
    keyPrefix: key.slice(0, 17),
    keyHash,
    scopes: result.data.scopes,
    expiresAt: result.data.expires_at ? new Date(result.data.expires_at) : null,
  }).returning();

  return c.json({
    data: {
      id: created.id,
      name: created.name,
      key,
      key_prefix: created.keyPrefix,
      scopes: created.scopes,
      expires_at: created.expiresAt,
      created_at: created.createdAt,
    },
    meta: { warning: 'The API key is shown only once.' },
    error: null,
  }, 201);
});

authRoutes.delete('/api-keys/:id', requireUserAuth, requireRoles('admin'), async (c) => {
  const idResult = uuidSchema.safeParse(c.req.param('id'));
  if (!idResult.success) {
    return c.json({ data: null, meta: {}, error: { code: 'VALIDATION_ERROR', message: 'API key ID must be a UUID.', details: [] } }, 400);
  }
  const auth = c.get('auth');
  const [revoked] = await db.update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, idResult.data), eq(apiKeys.userId, auth.sub), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });

  if (!revoked) {
    return c.json({ data: null, meta: {}, error: { code: 'RESOURCE_NOT_FOUND', message: 'API key was not found.', details: [] } }, 404);
  }

  return c.json({ data: { id: revoked.id, revoked: true }, meta: {}, error: null });
});

export default authRoutes;
