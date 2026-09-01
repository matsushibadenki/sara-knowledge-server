const queue = new Bun.RedisClient(process.env.REDIS_URL || 'redis://localhost:6379');

function s3Client() {
  const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  return new Bun.S3Client({
    endpoint: `${protocol}://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`,
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'sara_minio',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'change_me',
    bucket: process.env.MINIO_BUCKET || 'sara-assets',
    region: 'us-east-1',
  });
}

function publicS3Client() {
  return new Bun.S3Client({
    endpoint: process.env.MINIO_PUBLIC_ENDPOINT || `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`,
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'sara_minio',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'change_me',
    bucket: process.env.MINIO_BUCKET || 'sara-assets',
    region: 'us-east-1',
  });
}

export async function storeObject(key, content, contentType = 'application/octet-stream') {
  await s3Client().write(key, content, { type: contentType });
  return key;
}

export async function readObject(key) {
  return s3Client().file(key).text();
}

export function presignObject(key, method, expiresIn = 300, options = {}) {
  return publicS3Client().presign(key, { method, expiresIn, ...options });
}

export async function statObject(key) {
  return s3Client().stat(key);
}

export async function hashObject(key) {
  const bytes = new Uint8Array(await s3Client().file(key).arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function deleteObject(key) {
  await s3Client().delete(key);
}

export async function enqueueBackgroundJob(type, id) {
  await queue.lpush('sara:background-jobs', JSON.stringify({ type, id }));
}

export function closeBackgroundQueue() {
  queue.close();
}
