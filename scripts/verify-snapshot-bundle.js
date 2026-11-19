import { createHash } from 'node:crypto';

const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function verifySnapshotBundle(bytes, expectedHash) {
  const hash = digest(bytes);
  if (expectedHash && hash !== expectedHash) throw new Error('Bundle SHA-256 does not match.');
  const bundle = JSON.parse(bytes.toString('utf8'));
  if (bundle.schema !== 'sara.snapshot-bundle/1' || !Array.isArray(bundle.files)) throw new Error('Invalid Snapshot bundle.');
  const paths = new Set();
  for (const file of bundle.files) {
    if (typeof file.path !== 'string' || !/^(manifest\.jsonl?|records\.json|sources\.json|assets\/[a-f0-9-]{36})$/.test(file.path) || paths.has(file.path)) {
      throw new Error('Invalid or duplicate file path.');
    }
    paths.add(file.path);
    const decoded = Buffer.from(file.base64, 'base64');
    if (decoded.toString('base64') !== file.base64 || decoded.length !== file.size_bytes || digest(decoded) !== file.sha256) {
      throw new Error(`Integrity check failed for ${file.path}.`);
    }
  }
  if (!paths.has('records.json') || !paths.has('sources.json') ||
      Number(paths.has('manifest.json')) + Number(paths.has('manifest.jsonl')) !== 1) {
    throw new Error('Bundle is missing required files.');
  }
  const manifestFile = bundle.files.find((file) => file.path.startsWith('manifest.'));
  const manifestText = Buffer.from(manifestFile.base64, 'base64').toString('utf8');
  const manifest = JSON.parse(manifestFile.path.endsWith('.jsonl') ? manifestText.split('\n')[0] : manifestText);
  if (manifest.snapshot_id !== bundle.snapshot_id || manifest.schema !== 'sara.dataset-manifest/1.2') throw new Error('Manifest identity differs.');
  const readJson = (path) => JSON.parse(Buffer.from(bundle.files.find((file) => file.path === path).base64, 'base64').toString('utf8'));
  const records = readJson('records.json');
  const sources = readJson('sources.json');
  const entries = manifestFile.path.endsWith('.jsonl')
    ? manifestText.trimEnd().split('\n').slice(1).map((line) => JSON.parse(line)) : manifest.records;
  if (records.length !== manifest.record_count || entries.length !== records.length ||
      records.some((record, index) => {
        const entry = entries[index];
        return record.id !== entry.record_version_id || record.ordinal !== entry.ordinal ||
          record.record_id !== entry.record_id || record.source_id !== entry.source_id ||
          record.source_revision !== entry.source_revision;
      })) throw new Error('Record versions differ from the manifest.');
  const expectedSources = new Set(records.filter((record) => record.source_id)
    .map((record) => `${record.source_id}:${record.source_revision}`));
  if (sources.length !== expectedSources.size ||
      sources.some((source) => !expectedSources.delete(`${source.source_id}:${source.revision}`))) {
    throw new Error('Source revisions differ from the Record pins.');
  }
  const expectedAssets = new Map(manifest.asset_bindings_at_creation.map((asset) => [`assets/${asset.asset_id}`, asset]));
  const bundledAssets = bundle.files.filter((file) => file.path.startsWith('assets/'));
  if (bundledAssets.length !== expectedAssets.size || bundledAssets.some((file) => {
    const asset = expectedAssets.get(file.path);
    return !asset || asset.sha256 !== file.sha256 || Number(asset.size_bytes) !== file.size_bytes;
  })) throw new Error('Asset files differ from the manifest.');
  return { snapshot_id: bundle.snapshot_id, file_count: paths.size, sha256: hash };
}

if (import.meta.main) {
  try {
    const [path, expectedHash] = process.argv.slice(2);
    if (!path) throw new Error('Usage: bun scripts/verify-snapshot-bundle.js FILE [sha256:...]');
    console.log(JSON.stringify(verifySnapshotBundle(Buffer.from(await Bun.file(path).arrayBuffer()), expectedHash)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
