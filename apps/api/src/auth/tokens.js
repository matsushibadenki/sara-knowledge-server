// /apps/api/src/auth/tokens.js
import { jwtVerify, SignJWT } from 'jose';

const issuer = 'sara-knowledge-server';
const audience = 'sara-knowledge-api';
const developmentSecret = 'development-only-change-me';

function getSecret() {
  const secret = process.env.JWT_SECRET || developmentSecret;
  return new TextEncoder().encode(secret);
}

export function validateAuthConfig() {
  if (process.env.APP_ENV !== 'production') return;

  const secret = process.env.JWT_SECRET;
  if (!secret || secret === developmentSecret || secret === 'change_me' || secret.length < 32) {
    throw new Error('JWT_SECRET must be a unique value of at least 32 characters in production.');
  }
}

function getAccessExpiration() {
  return process.env.JWT_ACCESS_EXPIRES_IN || '15m';
}

export async function signAccessToken(user) {
  return new SignJWT({
    email: user.email,
    role: user.role,
    locale: user.locale || 'ja',
    token_type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(getAccessExpiration())
    .sign(getSecret());
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer,
    audience,
  });

  if (payload.token_type !== 'access' || typeof payload.sub !== 'string') {
    throw new Error('Invalid access token');
  }

  return payload;
}
