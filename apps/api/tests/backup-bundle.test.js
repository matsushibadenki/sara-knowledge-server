import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashFile, verifyBundle } from '../src/services/backup-bundle.js';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'bundle-contract-'));
  try {
    await mkdir(join(root, 'objects'));
    await Bun.write(join(root, 'database.dump'), 'unit metadata fixture, not a PostgreSQL dump');
    const file = `objects/${'a'.repeat(64)}.bin`;
    await Bun.write(join(root, file), 'original');
    const object = { key: 'assets/unit/original', file, ...await hashFile(join(root, file)) };
    const manifest = { format: 'sara-backup-v1', bucket: 'unit-bucket', database: await hashFile(join(root, 'database.dump')), objects: [object], state: { tables: {}, references: [{ kind: 'asset', id: 'unit', key: object.key, hash: `sha256:${object.sha256}`, size: String(object.size), required: true }] } };
    const save = () => Bun.write(join(root, 'manifest.json'), JSON.stringify(manifest));
    await save(); await run({ root, file, object, manifest, save });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('backup validation detects same-size corruption, missing required objects and duplicate keys', async () => {
  await fixture(async ({ root, file, object, manifest, save }) => {
    expect((await verifyBundle(root)).objects).toHaveLength(1);
    await Bun.write(join(root, file), 'tampered'); // Same size: SHA-256 must detect it.
    await expect(verifyBundle(root)).rejects.toThrow('checksum mismatch');
    await Bun.write(join(root, file), 'original');
    manifest.objects = []; await save();
    await expect(verifyBundle(root)).rejects.toThrow('Required object missing');
    manifest.objects = [object, object]; await save();
    await expect(verifyBundle(root)).rejects.toThrow('duplicate');
  });
});

test('backup validation rejects paths outside the bundle and symlinked files', async () => {
  await fixture(async ({ root, file, manifest, save }) => {
    manifest.objects[0].file = '../outside'; await save();
    await expect(verifyBundle(root)).rejects.toThrow('Unsafe bundle path');
    manifest.objects[0].file = file; await save();
    await rm(join(root, file));
    await symlink(join(root, 'database.dump'), join(root, file));
    await expect(verifyBundle(root)).rejects.toThrow('symlinks');
  });
});
