// /apps/api/src/auth/tokens.js
import { jwtVerify, SignJWT } from 'jose';

const issuer = 'sara-knowledge-server';
const audience = 'sara-knowledge-api';

function getSecret() {
  const secret = process.env.JWT_SECRET || 'development-only-change-me';
  return new TextEncoder().encode(secret);
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
