import { createInterface } from 'node:readline';
import { sql, closeDatabase } from '../db/client.js';
import { closeBackgroundQueue, hashBytes } from '../services/background-jobs.js';
import { inspectAssetInventory, reconcileAssets } from '../services/asset-reconciliation.js';

const args = process.argv.slice(2);
if (args.some((arg) => !['--apply', '--inventory'].includes(arg))) throw new Error('Usage: reconcile-assets.js [--apply] [--inventory]');
const bucket = process.env.MINIO_BUCKET || 'sara-assets';
const storage = new Bun.S3Client({
  endpoint: `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`,
  accessKeyId: process.env.MINIO_ACCESS_KEY || 'sara_minio', secretAccessKey: process.env.MINIO_SECRET_KEY || 'change_me',
  bucket, region: 'us-east-1',
});
const output = (finding) => console.log(JSON.stringify(finding));
try {
  let unowned = 0;
  if (args.includes('--inventory')) {
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      if (entry.status !== 'success' || typeof entry.key !== 'string') throw new Error('Invalid or incomplete object inventory');
      if (entry.type === 'folder') continue;
      const finding = await inspectAssetInventory({ sql, bucket, key: entry.key });
      if (finding) { output(finding); unowned += 1; }
    }
  }
  const summary = await reconcileAssets({ sql, bucket, apply: args.includes('--apply'),
    statObject: (key) => storage.stat(key), readObjectBytes: async (key) => new Uint8Array(await storage.file(key).arrayBuffer()), hashBytes, onFinding: output });
  output({ type: 'summary', mode: args.includes('--apply') ? 'apply' : 'report', unowned, ...summary });
  if (summary.errors || unowned || summary.findings > summary.requeued) process.exitCode = 2;
} finally { closeBackgroundQueue(); await closeDatabase(); }
