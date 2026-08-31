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

export async function storeObject(key, content, contentType = 'application/octet-stream') {
  await s3Client().write(key, content, { type: contentType });
  return key;
}

export async function readObject(key) {
  return s3Client().file(key).text();
}

export async function enqueueBackgroundJob(type, id) {
  await queue.lpush('sara:background-jobs', JSON.stringify({ type, id }));
}

export function closeBackgroundQueue() {
  queue.close();
}
