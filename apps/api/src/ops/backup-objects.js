import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { sql, closeDatabase } from '../db/client.js';
import { captureBackupState, sameDatabaseState } from '../services/backup-state.js';
import { copyObject, hashFile, verifyBundle, verifyObjectReferences } from '../services/backup-bundle.js';

const [action, root = '/bundle'] = process.argv.slice(2);
const bucket = process.env.MINIO_BUCKET || 'sara-assets';
const storage = new Bun.S3Client({ endpoint: `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT || 'minio'}:${process.env.MINIO_PORT || '9000'}`,
  accessKeyId: process.env.MINIO_ACCESS_KEY || 'sara_minio', secretAccessKey: process.env.MINIO_SECRET_KEY || 'change_me', bucket, region: 'us-east-1' });
try {
  if (action === 'state') {
    await Bun.write(join(root, 'state.json'), JSON.stringify(await captureBackupState(sql, bucket)));
  } else if (action === 'capture') {
    const state = await Bun.file(join(root, 'state.json')).json();
    const objects = []; const keys = new Set();
    await mkdir(join(root, 'objects'), { recursive: true, mode: 0o700 });
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (item.status !== 'success' || typeof item.key !== 'string') throw new Error('Incomplete object inventory');
      if (item.type === 'folder') continue;
      if (keys.has(item.key)) throw new Error('Duplicate inventory key');
      keys.add(item.key); objects.push(await copyObject(storage, item.key, root));
    }
    await verifyObjectReferences(root, state, objects);
    if (!sameDatabaseState(state, await captureBackupState(sql, bucket))) throw new Error('Database changed during backup; bundle is incomplete');
    const manifest = { format: 'sara-backup-v1', createdAt: new Date().toISOString(), bucket, database: await hashFile(join(root, 'database.dump')), state, objects };
    await Bun.write(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await verifyBundle(root);
    console.log(JSON.stringify({ backup: 'verified', tables: Object.keys(state.tables).length, objects: objects.length }));
  } else if (action === 'upload') {
    const manifest = await verifyBundle(root);
    if (manifest.bucket !== bucket) throw new Error('Restore bucket differs from bundle');
    for (const object of manifest.objects) await storage.write(object.key, Bun.file(join(root, object.file)), { type: object.contentType });
  } else if (action === 'verify-restored') {
    const manifest = await verifyBundle(root);
    if (manifest.bucket !== bucket) throw new Error('Restore bucket differs from bundle');
    const actual = await captureBackupState(sql, bucket);
    if (!sameDatabaseState(manifest.state, actual)) throw new Error('Restored database differs from backup or references are invalid');
    for (const object of manifest.objects) {
      const hasher = new Bun.CryptoHasher('sha256'); let size = 0;
      for await (const chunk of storage.file(object.key).stream()) { hasher.update(chunk); size += chunk.length; }
      if (hasher.digest('hex') !== object.sha256 || size !== object.size) throw new Error(`Restored object mismatch: ${object.key}`);
    }
    console.log(JSON.stringify({ restore: 'verified', tables: Object.keys(actual.tables).length, objects: manifest.objects.length }));
  } else throw new Error('Unknown backup operation');
} finally { await closeDatabase(); }
