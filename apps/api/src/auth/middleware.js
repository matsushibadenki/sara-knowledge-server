import { createMiddleware } from 'hono/factory';
import { and, eq, isNull } from 'drizzle-orm';
import { verifyAccessToken } from './tokens.js';
import { hashSecret } from './secrets.js';
import { db } from '../db/client.js';
import { apiKeys, users } from '../db/schema/index.js';

function authenticationError(c, code = 'INVALID_TOKEN') {
  const missing = code === 'AUTHENTICATION_REQUIRED';
  return c.json({
    data: null,
    meta: {},
    error: {
      code,
      message: missing
        ? 'Bearer access token or API key is required.'
        : 'The access token or API key is invalid or expired.',
      details: [],
    },
  }, 401);
}

async function findActiveUser(userId) {
  const [user] = await db.select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, 'active'), isNull(users.deletedAt)))
    .limit(1);
  return user;
}

async function authenticateApiKey(token) {
  const [apiKey] = await db.select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, await hashSecret(token)), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!apiKey || (apiKey.expiresAt && apiKey.expiresAt <= new Date())) return null;

  const user = await findActiveUser(apiKey.userId);
  if (!user) return null;

  await db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.id, apiKey.id), isNull(apiKeys.revokedAt)));

  return {
    user,
    auth: {
      sub: user.id,
      email: user.email,
      role: user.role,
      locale: user.locale || 'ja',
      token_type: 'api_key',
      api_key_id: apiKey.id,
      scopes: apiKey.scopes || [],
    },
  };
}

function createAuthMiddleware({ allowApiKeys }) {
  return createMiddleware(async (c, next) => {
    const authorization = c.req.header('Authorization');
    const [scheme, token, ...extra] = authorization?.trim().split(/\s+/) || [];

    if (scheme !== 'Bearer' || !token || extra.length > 0) {
      return authenticationError(c, 'AUTHENTICATION_REQUIRED');
    }

    if (token.startsWith('sara_')) {
      if (!allowApiKeys) return authenticationError(c);

      const result = await authenticateApiKey(token);
      if (!result) return authenticationError(c);
      c.set('auth', result.auth);
      c.set('authUser', result.user);
      return next();
    }

    let payload;
    try {
      payload = await verifyAccessToken(token);
    } catch {
      return authenticationError(c);
    }

    const user = await findActiveUser(payload.sub);
    if (!user) return authenticationError(c);

    c.set('auth', { ...payload, scopes: ['*'] });
    c.set('authUser', user);
    return next();
  });
}

export function hasRequiredScope(grantedScopes, requiredScope) {
  if (grantedScopes.includes('*') || grantedScopes.includes(requiredScope)) return true;
  const [resource] = requiredScope.split(':');
  return grantedScopes.includes(`${resource}:*`);
}

export function hasRequiredRole(role, allowedRoles) {
  return allowedRoles.includes(role);
}

export const requireAuth = createAuthMiddleware({ allowApiKeys: true });
export const requireUserAuth = createAuthMiddleware({ allowApiKeys: false });

export function requireScopes(...requiredScopes) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');
    const grantedScopes = auth?.scopes || [];
    const missingScopes = requiredScopes.filter(
      (scope) => !hasRequiredScope(grantedScopes, scope),
    );

    if (missingScopes.length > 0) {
      return c.json({
        data: null,
        meta: {},
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: 'The credential does not grant the required scope.',
          details: { required_scopes: requiredScopes },
        },
      }, 403);
    }

    return next();
  });
}

export function requireRoles(...allowedRoles) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');
    if (auth?.token_type === 'api_key') return next();

    const role = c.get('authUser')?.role;
    if (!hasRequiredRole(role, allowedRoles)) {
      return c.json({
        data: null,
        meta: {},
        error: {
          code: 'INSUFFICIENT_ROLE',
          message: 'The authenticated user role cannot perform this operation.',
          details: { allowed_roles: allowedRoles },
        },
      }, 403);
    }

    return next();
  });
}
