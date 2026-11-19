import { hashBytes } from './background-jobs.js';

export const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;

export class SnapshotBundleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createBundleFiles() {
  const files = [];
  let remaining = MAX_BUNDLE_BYTES;
  return {
    files,
    get remaining() { return remaining; },
    async add(path, bytes, expectedHash) {
      if (bytes.length > remaining) throw new SnapshotBundleError('BUNDLE_TOO_LARGE', 'Snapshot bundle exceeds 32 MiB of decoded files.');
      const sha256 = await hashBytes(bytes);
      if (expectedHash && sha256 !== expectedHash) {
        throw new SnapshotBundleError('BUNDLE_INTEGRITY_ERROR', `Hash mismatch for ${path}.`);
      }
      files.push({ path, sha256, size_bytes: bytes.length, base64: Buffer.from(bytes).toString('base64') });
      remaining -= bytes.length;
    },
  };
}
