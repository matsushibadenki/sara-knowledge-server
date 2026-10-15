import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

export async function hashFile(path) {
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length; }
  return { sha256: hash.digest('hex'), size };
}
export async function copyObject(storage, key, root) {
  const file = `objects/${createHash('sha256').update(key).digest('hex')}.bin`;
  await mkdir(join(root, 'objects'), { recursive: true, mode: 0o700 });
  const hash = createHash('sha256'); let size = 0;
  const stat = await storage.stat(key);
  await pipeline(Readable.fromWeb(storage.file(key).stream()), new Transform({ transform(chunk, encoding, callback) {
    hash.update(chunk); size += chunk.length; callback(null, chunk);
  } }), createWriteStream(join(root, file), { flags: 'wx', mode: 0o600 }));
  return { key, file, sha256: hash.digest('hex'), size, contentType: stat.type || 'application/octet-stream' };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
export async function verifyObjectReferences(root, state, objects) {
  const byKey = new Map(objects.map((object) => [object.key, object]));
  for (const reference of state.references) {
    const object = byKey.get(reference.key);
    if (!object) {
      if (reference.required) throw new Error(`Required object missing: ${reference.kind}/${reference.id}`);
      continue;
    }
    if (reference.size !== null && Number(reference.size) !== object.size) throw new Error(`Object size mismatch: ${reference.kind}/${reference.id}`);
    let hash = `sha256:${object.sha256}`;
    if (reference.kind === 'event_job') {
      const value = await Bun.file(join(root, object.file)).json();
      if (value.batch_uid !== reference.batch_uid || !Array.isArray(value.events) || value.events.length !== reference.event_count) throw new Error(`Event job payload mismatch: ${reference.id}`);
      hash = `sha256:${createHash('sha256').update(JSON.stringify(stable(value.events))).digest('hex')}`;
    }
    if (reference.hash && reference.hash !== hash) throw new Error(`Object hash mismatch: ${reference.kind}/${reference.id}`);
  }
}

export async function verifyBundle(root) {
  const manifestStat = await lstat(join(root, 'manifest.json'));
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Invalid manifest file');
  const manifest = await Bun.file(join(root, 'manifest.json')).json();
  if (manifest.format !== 'sara-backup-v1' || typeof manifest.bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(manifest.bucket) || !Array.isArray(manifest.objects) || !manifest.state?.tables || !Array.isArray(manifest.state.references)) throw new Error('Unsupported backup manifest');
  const keys = new Set(); const paths = new Set();
  const dir = await lstat(join(root, 'objects'));
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Invalid object directory');
  for (const object of [{ ...manifest.database, file: 'database.dump' }, ...manifest.objects]) {
    if (object.file !== 'database.dump' && !/^objects\/[a-f0-9]{64}\.bin$/.test(object.file)) throw new Error('Unsafe bundle path');
    if (!/^[a-f0-9]{64}$/.test(object.sha256) || !Number.isSafeInteger(object.size) || object.size < 0 || paths.has(object.file)) throw new Error('Invalid or duplicate bundle file');
    paths.add(object.file);
    const stat = await lstat(join(root, object.file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Bundle symlinks are not supported');
    const actual = await hashFile(join(root, object.file));
    if (actual.size !== object.size || actual.sha256 !== object.sha256) throw new Error(`Bundle checksum mismatch: ${object.file}`);
    if (object.file !== 'database.dump') {
      if (typeof object.key !== 'string' || !object.key || keys.has(object.key)) throw new Error('Invalid or duplicate object key');
      keys.add(object.key);
    }
  }
  await verifyObjectReferences(root, manifest.state, manifest.objects);
  return manifest;
}
