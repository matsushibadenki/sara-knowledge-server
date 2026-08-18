import { hashSecret } from './secrets.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const maxAttempts = positiveInteger(process.env.LOGIN_MAX_ATTEMPTS, 5);
const windowSeconds = positiveInteger(process.env.LOGIN_ATTEMPT_WINDOW_SECONDS, 900);
const redis = new Bun.RedisClient(redisUrl);

export class LoginRateLimitError extends Error {
  constructor(cause) {
    super('Login rate limit storage is unavailable.', { cause });
    this.name = 'LoginRateLimitError';
  }
}

async function keyForEmail(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const pepper = process.env.JWT_SECRET || 'development-only-change-me';
  return `auth:login:email:${await hashSecret(`${pepper}:${normalizedEmail}`)}`;
}

export function getLoginRateLimitConfig() {
  return { maxAttempts, windowSeconds };
}

export async function consumeLoginAttempt(email) {
  try {
    const key = await keyForEmail(email);
    const count = Number(await redis.incr(key));
    let ttl = Number(await redis.ttl(key));

    if (ttl < 0) {
      await redis.expire(key, windowSeconds);
      ttl = windowSeconds;
    }

    return {
      limited: count > maxAttempts,
      remainingAttempts: Math.max(maxAttempts - count, 0),
      retryAfterSeconds: Math.max(ttl, 1),
    };
  } catch (error) {
    throw new LoginRateLimitError(error);
  }
}

export async function clearLoginAttempts(email) {
  try {
    await redis.del(await keyForEmail(email));
  } catch (error) {
    throw new LoginRateLimitError(error);
  }
}

export function closeLoginRateLimiter() {
  redis.close();
}
