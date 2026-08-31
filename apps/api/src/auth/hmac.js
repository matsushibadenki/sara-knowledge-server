import { createMiddleware } from 'hono/factory';
import { lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiRequestNonces } from '../db/schema/index.js';

const encoder = new TextEncoder();
const timestampToleranceSeconds = Math.max(30, Math.min(900, Number(process.env.HMAC_TIMESTAMP_TOLERANCE_SECONDS || 300)));
const nonceRetentionSeconds = Math.max(timestampToleranceSeconds * 2, 600);

function errorResponse(c, status, code, message) {
  return c.json({ data: null, meta: {}, error: { code, message, details: [] } }, status);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifySignature(secret, canonical, signature) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const supplied = signature.startsWith('sha256=') ? signature.slice(7) : '';
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return crypto.subtle.verify('HMAC', key, Uint8Array.from(supplied.match(/../g), (hex) => parseInt(hex, 16)), encoder.encode(canonical));
}

export const requireSignedApiKeyRequest = createMiddleware(async (c, next) => {
  const auth = c.get('auth');
  if (auth?.token_type !== 'api_key') return next();

  const timestamp = c.req.header('X-SARA-Timestamp');
  const nonce = c.req.header('X-SARA-Nonce');
  const idempotencyKey = c.req.header('X-SARA-Idempotency-Key');
  const signature = c.req.header('X-SARA-Signature');
  if (!timestamp || !nonce || !idempotencyKey || !signature) {
    return errorResponse(c, 401, 'HMAC_REQUIRED', 'Signed API key requests require timestamp, nonce, idempotency key, and signature headers.');
  }
  if (!/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9._:-]{16,128}$/.test(nonce) || idempotencyKey.length > 200) {
    return errorResponse(c, 400, 'HMAC_HEADER_INVALID', 'HMAC request headers are invalid.');
  }
  const requestTime = Number(timestamp);
  if (Math.abs(Math.floor(Date.now() / 1000) - requestTime) > timestampToleranceSeconds) {
    return errorResponse(c, 401, 'HMAC_TIMESTAMP_EXPIRED', 'The signed request timestamp is outside the allowed window.');
  }

  const bodyBytes = new Uint8Array(await c.req.raw.clone().arrayBuffer());
  const bodyHash = await sha256Hex(bodyBytes);
  const canonical = [c.req.method.toUpperCase(), c.req.path, timestamp, nonce, idempotencyKey, bodyHash].join('\n');
  if (!await verifySignature(c.get('apiKeySecret'), canonical, signature)) {
    return errorResponse(c, 401, 'HMAC_SIGNATURE_INVALID', 'The request signature is invalid.');
  }

  let body;
  try { body = JSON.parse(new TextDecoder().decode(bodyBytes)); } catch { body = null; }
  if (body?.batch_uid !== idempotencyKey) {
    return errorResponse(c, 409, 'IDEMPOTENCY_KEY_MISMATCH', 'X-SARA-Idempotency-Key must equal batch_uid.');
  }

  const now = new Date();
  await db.delete(apiRequestNonces).where(lt(apiRequestNonces.expiresAt, now));
  try {
    await db.insert(apiRequestNonces).values({
      apiKeyId: auth.api_key_id,
      nonce,
      idempotencyKey,
      requestHash: `sha256:${bodyHash}`,
      expiresAt: new Date(now.getTime() + nonceRetentionSeconds * 1000),
    });
  } catch (error) {
    if (error?.code === '23505') return errorResponse(c, 409, 'HMAC_NONCE_REPLAY', 'The request nonce has already been used.');
    throw error;
  }
  c.set('signedRequest', { nonce, idempotencyKey, requestHash: `sha256:${bodyHash}` });
  return next();
});
