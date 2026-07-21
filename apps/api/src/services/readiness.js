// /apps/api/src/services/readiness.js
import { sql } from '../db/client.js';

async function checkPostgres() {
  try {
    await sql`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkMinio() {
  const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
  const port = process.env.MINIO_PORT || '9000';

  try {
    const response = await fetch(`http://${endpoint}:${port}/minio/health/live`);
    return response.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

async function checkRedis() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');

  try {
    const socket = await Bun.connect({
      hostname: url.hostname,
      port: Number(url.port || 6379),
      socket: {
        open(connection) {
          connection.write('PING\r\n');
          connection.end();
        },
        data() {},
        close() {},
        error() {},
      },
    });
    socket.end();
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function getReadiness() {
  const [postgres, redis, minio] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkMinio(),
  ]);

  const ready = postgres === 'ok' && redis === 'ok' && minio === 'ok';

  return {
    ready,
    dependencies: { postgres, redis, minio },
  };
}
