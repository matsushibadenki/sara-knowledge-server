// /apps/api/src/routes/auth.js
import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { apiKeys, refreshTokens, users } from '../db/schema/index.js';
import { verifyPassword } from '../auth/passwords.js';
import { requireAuth } from '../auth/middleware.js';
import { signAccessToken } from '../auth/tokens.js';
import { createOpaqueSecret, durationToMilliseconds, hashSecret } from '../auth/secrets.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(20),
});

const apiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(100)).max(50).default([]),
  expires_at: z.string().datetime().nullable().optional(),
});

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
  const [storedToken] = await db.select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
    .limit(1);

  if (!storedToken || storedToken.expiresAt <= new Date()) {
    return c.json({
      data: null,
      meta: {},
      error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired.', details: [] },
    }, 401);
  }

  const [user] = await db.select()
    .from(users)
    .where(and(eq(users.id, storedToken.userId), eq(users.status, 'active'), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    return c.json({
      data: null,
      meta: {},
      error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired.', details: [] },
    }, 401);
  }

  const nextRefreshToken = createOpaqueSecret(48);
  const nextRefreshTokenHash = await hashSecret(nextRefreshToken);
  const nextRefreshTokenId = crypto.randomUUID();
  const refreshExpiresAt = new Date(Date.now() + durationToMilliseconds(process.env.JWT_REFRESH_EXPIRES_IN, 30 * 86_400_000));

  await db.transaction(async (tx) => {
    await tx.update(refreshTokens)
      .set({ revokedAt: new Date(), lastUsedAt: new Date(), replacedById: nextRefreshTokenId })
      .where(eq(refreshTokens.id, storedToken.id));
    await tx.insert(refreshTokens).values({
      id: nextRefreshTokenId,
      userId: user.id,
      tokenHash: nextRefreshTokenHash,
      expiresAt: refreshExpiresAt,
    });
  });

  return c.json({
    data: {
      access_token: await signAccessToken(user),
      token_type: 'Bearer',
      expires_in: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      refresh_token: nextRefreshToken,
      refresh_expires_at: refreshExpiresAt.toISOString(),
      user: serializeUser(user),
    },
    meta: {},
    error: null,
  });
});

authRoutes.post('/logout', async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = refreshSchema.safeParse(body);
  if (!result.success) return c.json({ data: null, meta: {}, error: null });

  await db.update(refreshTokens)
    .set({ revokedAt: new Date(), lastUsedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, await hashSecret(result.data.refresh_token)), isNull(refreshTokens.revokedAt)));

  return c.json({ data: { logged_out: true }, meta: {}, error: null });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const auth = c.get('auth');
  const [user] = await db.select()
    .from(users)
    .where(and(eq(users.id, auth.sub), isNull(users.deletedAt)))
    .limit(1);

  if (!user || user.status !== 'active') {
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'The authenticated user was not found.',
        details: [],
      },
    }, 404);
  }

  return c.json({ data: serializeUser(user), meta: {}, error: null });
});

authRoutes.get('/api-keys', requireAuth, async (c) => {
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

authRoutes.post('/api-keys', requireAuth, async (c) => {
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
  const secret = createOpaqueSecret(32);
  const key = `sara_${secret.slice(0, 12)}_${secret}`;
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

authRoutes.delete('/api-keys/:id', requireAuth, async (c) => {
  const auth = c.get('auth');
  const [revoked] = await db.update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, c.req.param('id')), eq(apiKeys.userId, auth.sub), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });

  if (!revoked) {
    return c.json({ data: null, meta: {}, error: { code: 'RESOURCE_NOT_FOUND', message: 'API key was not found.', details: [] } }, 404);
  }

  return c.json({ data: { id: revoked.id, revoked: true }, meta: {}, error: null });
});

export default authRoutes;
