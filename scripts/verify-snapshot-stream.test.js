import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { verifySnapshotStream } from './verify-snapshot-stream.js';

const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

test('stream verifier checks split frames, same-size corruption and truncation', async () => {
  const frames = [{ type: 'bundle', schema: 'sara.snapshot-stream/1', snapshot_id: crypto.randomUUID() }];
  for (const path of ['manifest.json', 'records.jsonl', 'sources.jsonl']) {
    frames.push({ type: 'file', path }, { type: 'data', base64: 'eA==' }, { type: 'end', size_bytes: 1, sha256: sha('x') });
  }
  frames.push({ type: 'complete' });
  const encoded = frames.map((frame) => JSON.stringify(frame) + '\n').join('');
  function* chunks(text) {
    for (let i = 0; i < text.length; i += 17) yield Buffer.from(text.slice(i, i + 17));
  }
  expect(await verifySnapshotStream(chunks(encoded), sha(encoded))).toMatchObject({ file_count: 3 });
  await expect(verifySnapshotStream(chunks(encoded.replace('eA==', 'eQ==')), sha(encoded))).rejects.toThrow('Integrity check failed');
  await expect(verifySnapshotStream(chunks(encoded.slice(0, -1)), sha(encoded))).rejects.toThrow('Incomplete bundle');
  await expect(verifySnapshotStream(chunks(encoded), sha('wrong'))).rejects.toThrow('Bundle SHA-256');
});
