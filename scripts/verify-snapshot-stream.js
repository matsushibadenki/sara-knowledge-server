import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

const digest = (hash) => `sha256:${hash.digest('hex')}`;

export async function verifySnapshotStream(stream, expectedHash) {
  const whole = createHash('sha256');
  const paths = new Set();
  let pending = Buffer.alloc(0);
  let header;
  let active;
  let complete = false;
  function checkLine(bytes) {
    const frame = JSON.parse(bytes.toString('utf8'));
    if (complete) throw new Error('Trailing data after completion.');
    if (!header) {
      if (frame.type !== 'bundle' || frame.schema !== 'sara.snapshot-stream/1') throw new Error('Invalid bundle header.');
      header = frame;
    } else if (frame.type === 'file' && !active) {
      if (!/^(manifest\.jsonl?|records\.jsonl|sources\.jsonl|assets\/[a-f0-9-]{36})$/.test(frame.path) || paths.has(frame.path)) {
        throw new Error('Invalid or duplicate file path.');
      }
      active = { path: frame.path, hash: createHash('sha256'), size: 0 };
    } else if (frame.type === 'data' && active) {
      const decoded = Buffer.from(frame.base64, 'base64');
      if (!decoded.length || decoded.length > 48 * 1024 || decoded.toString('base64') !== frame.base64) throw new Error('Invalid data frame.');
      active.hash.update(decoded);
      active.size += decoded.length;
    } else if (frame.type === 'end' && active) {
      if (frame.size_bytes !== active.size || frame.sha256 !== digest(active.hash)) {
        throw new Error(`Integrity check failed for ${active.path}.`);
      }
      paths.add(active.path);
      active = null;
    } else if (frame.type === 'complete' && !active) {
      complete = true;
    } else {
      throw new Error('Unexpected bundle frame.');
    }
  }
  for await (const bytes of stream) {
    const chunk = Buffer.from(bytes);
    whole.update(chunk);
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      if (pending.length + end - offset > 66 * 1024) throw new Error('Frame is too large.');
      pending = Buffer.concat([pending, chunk.subarray(offset, end)]);
      if (newline >= 0) {
        checkLine(pending);
        pending = Buffer.alloc(0);
      }
      offset = end + 1;
    }
  }
  if (pending.length || !complete || !paths.has('records.jsonl') || !paths.has('sources.jsonl') ||
      Number(paths.has('manifest.json')) + Number(paths.has('manifest.jsonl')) !== 1) throw new Error('Incomplete bundle.');
  const sha256 = digest(whole);
  if (expectedHash && expectedHash !== sha256) throw new Error('Bundle SHA-256 does not match.');
  return { snapshot_id: header.snapshot_id, file_count: paths.size, sha256 };
}

if (import.meta.main) {
  try {
    const [path, expectedHash] = process.argv.slice(2);
    if (!path || !/^sha256:[a-f0-9]{64}$/.test(expectedHash ?? '')) throw new Error('Usage: bun scripts/verify-snapshot-stream.js FILE sha256:...');
    console.log(await verifySnapshotStream(createReadStream(path), expectedHash));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
