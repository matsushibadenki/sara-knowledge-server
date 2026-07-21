// /apps/api/src/auth/middleware.js
import { createMiddleware } from 'hono/factory';
import { verifyAccessToken } from './tokens.js';

export const requireAuth = createMiddleware(async (c, next) => {
  const authorization = c.req.header('Authorization');
  const [scheme, token] = authorization?.split(' ') || [];

  if (scheme !== 'Bearer' || !token) {
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Bearer access token is required.',
        details: [],
      },
    }, 401);
  }

  try {
    const payload = await verifyAccessToken(token);
    c.set('auth', payload);
    await next();
  } catch {
    return c.json({
      data: null,
      meta: {},
      error: {
        code: 'INVALID_TOKEN',
        message: 'The access token is invalid or expired.',
        details: [],
      },
    }, 401);
  }
});
