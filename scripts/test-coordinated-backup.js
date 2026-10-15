import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, restore, command, restoreCommand } from './coordinated-backup.js';
import { verifyBundle } from '../apps/api/src/services/backup-bundle.js';

const root = await mkdtemp(join(tmpdir(), 'sara-restore-drill-'));
const fixtureRoot = join(root, 'fixture'); await mkdir(fixtureRoot, { mode: 0o700 });
const bundle = join(root, 'bundle');
const project = `sara-restore-${crypto.randomUUID()}`;
const rejectedProject = `sara-restore-rejected-${crypto.randomUUID().slice(0, 12)}`;
const sourceRunning = () => command(['docker', 'compose', 'ps', '--status', 'running', '--services'], { capture: true });
const workerWasRunning = (await sourceRunning()).split('\n').includes('worker');
const fixture = (action) => command(['docker', 'compose', 'run', '--rm', '--no-deps', '-T', '--user', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`, '-v', `${fixtureRoot}:/bundle`, 'api', 'bun', 'src/ops/backup-fixture.js', action]);
let created = false;
try {
  if (workerWasRunning) await command(['docker', 'compose', 'stop', 'worker']);
  created = true; await fixture('create');
  await backup(bundle);
  const manifest = await verifyBundle(bundle);
  const data = await Bun.file(join(fixtureRoot, 'fixture.json')).json();
  for (const kind of ['asset', 'snapshot', 'import', 'export', 'event_job']) assert(manifest.state.references.some((ref) => ref.kind === kind && ref.required));
  const wasRunning = (await sourceRunning()).split('\n');
  assert(!wasRunning.includes('worker'), 'Backup must not start a previously stopped Worker');
  await restore(bundle, project);
  await assert.rejects(restore(bundle, project), /already exists/);
  const env = { RESTORE_BUCKET: manifest.bucket };
  const clone = (...args) => command(restoreCommand(project, ...args), { env });
  const verify = () => clone('run', '--rm', '--no-deps', '-T', '-v', `${bundle}:/bundle:ro`, 'verifier', 'bun', 'src/ops/backup-objects.js', 'verify-restored');
  const assetRef = manifest.state.references.find((ref) => ref.kind === 'asset' && ref.id === data.ids.asset);
  const object = manifest.objects.find((obj) => obj.key === assetRef.key);
  // Detect corruption in the restored store, not just in the input archive.
  await clone('exec', '-T', 'minio', 'sh', '-c', 'mc alias set drill http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && printf corrupted | mc pipe "drill/$1/$2"', 'sh', manifest.bucket, object.key);
  await assert.rejects(verify(), /Command failed/);
  await clone('run', '--rm', '--no-deps', '-T', '-v', `${bundle}:/bundle:ro`, 'verifier', 'bun', 'src/ops/backup-objects.js', 'upload');
  await verify();
  const sql = (query) => clone('exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'restore', '-d', 'restore', '-c', query);
  await sql(`UPDATE dataset.asset_bindings SET target_id='${crypto.randomUUID()}' WHERE asset_id='${data.ids.asset}'`);
  await assert.rejects(verify(), /Command failed/);
  await sql(`UPDATE dataset.asset_bindings SET target_id='${data.ids.record}' WHERE asset_id='${data.ids.asset}'`);
  await sql(`UPDATE dataset.records SET title='Tampered restore' WHERE id='${data.ids.record}'`);
  await assert.rejects(verify(), /Command failed/);
  // Input damage is rejected before a new target or volume is created.
  const originalBytes = await Bun.file(join(bundle, object.file)).arrayBuffer();
  await Bun.write(join(bundle, object.file), 'damaged archive');
  await assert.rejects(restore(bundle, rejectedProject), /checksum mismatch/);
  assert.equal(await command(['docker', 'volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${rejectedProject}`], { capture: true }), '');
  await Bun.write(join(bundle, object.file), originalBytes);
  const originalManifest = await Bun.file(join(bundle, 'manifest.json')).text();
  await Bun.write(join(bundle, 'manifest.json'), JSON.stringify({ ...manifest, objects: manifest.objects.filter((obj) => obj.key !== object.key) }));
  await assert.rejects(verifyBundle(bundle), /Required object missing/);
  await Bun.write(join(bundle, 'manifest.json'), originalManifest);
  await assert.rejects(backup(bundle), /EEXIST/);
  // Missing source originals must prevent a completed backup, but still resume API.
  const apiWasRunning = (await sourceRunning()).split('\n').includes('api');
  await fixture('remove-original');
  const failedBundle = join(root, 'failed-bundle');
  await assert.rejects(backup(failedBundle), /Command failed/);
  await assert.rejects(access(join(failedBundle, 'COMPLETE')));
  assert.equal((await sourceRunning()).split('\n').includes('api'), apiWasRunning);
  await fixture('repair-original');
  const interruptedBundle = join(root, 'interrupted-bundle');
  const interrupted = Bun.spawn(['bun', 'scripts/coordinated-backup.js', 'backup', interruptedBundle], { stdout: 'inherit', stderr: 'inherit' });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await Bun.file(join(interruptedBundle, 'maintenance.json')).exists()) break;
    if (interrupted.exitCode !== null) throw new Error('Backup exited before cancellation test');
    await Bun.sleep(100);
  }
  interrupted.kill('SIGTERM');
  assert.equal(await interrupted.exited, 130);
  await assert.rejects(access(join(interruptedBundle, 'COMPLETE')));
  assert.equal((await sourceRunning()).split('\n').includes('api'), apiWasRunning);
  console.log(JSON.stringify({ drill: 'passed', tables: Object.keys(manifest.state.tables).length, objects: manifest.objects.length,
    checks: ['isolated restore', 'all table fingerprints', 'all object hashes', 'polymorphic references', 'pinned versions', 'archive corruption', 'restored corruption', 'database tampering', 'overwrite refusal', 'failure resumes writers', 'graceful cancellation'] }));
} finally {
  const failures = [];
  if (created && await Bun.file(join(fixtureRoot, 'fixture.json')).exists()) {
    try { await fixture('repair-original'); } catch (error) { failures.push(error); }
    try { await fixture('cleanup'); } catch (error) { failures.push(error); }
  }
  try { await command(restoreCommand(project, 'down', '-v', '--remove-orphans')); } catch (error) { failures.push(error); }
  if (workerWasRunning) {
    try { await command(['docker', 'compose', 'start', 'worker']); } catch (error) { failures.push(error); }
  }
  if (!failures.length) await rm(root, { recursive: true, force: true });
  else console.error(`Drill files retained for cleanup: ${root}`);
  if (failures.length) throw new AggregateError(failures, 'Restore drill cleanup failed');
}
