import { chmod, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyBundle } from '../apps/api/src/services/backup-bundle.js';

process.umask(0o077);
let cancelled;
export async function command(args, { capture = false, input, output, env = {}, cleanup = false } = {}) {
  if (cancelled && !cleanup) throw new Error(`Interrupted: ${cancelled}`);
  const child = Bun.spawn(args, { stdin: input ? Bun.file(input) : 'ignore', stdout: capture ? 'pipe' : output ? Bun.file(output) : 'inherit', stderr: 'inherit', env: { ...process.env, ...env } });
  const text = capture ? await new Response(child.stdout).text() : '';
  if (await child.exited) throw new Error(`Command failed: ${args.slice(0, 4).join(' ')}`);
  if (cancelled && !cleanup) throw new Error(`Interrupted: ${cancelled}`);
  return text.trim();
}
const compose = (...args) => ['docker', 'compose', ...args];
function archivePath(path) {
  if (!path) throw new Error('An archive directory is required');
  const root = resolve(path);
  if (root.includes(':') || root.includes('\n')) throw new Error('Unsupported archive path');
  return root;
}
async function sourceConfig() {
  const config = JSON.parse(await command(compose('config', '--format', 'json'), { capture: true }));
  const api = config.services.api?.environment;
  const pg = config.services.postgres?.environment;
  if (!api || !pg) throw new Error('Expected local API/PostgreSQL Compose services');
  const url = new URL(api.DATABASE_URL);
  if (url.hostname !== 'postgres' || (url.port && url.port !== '5432') || decodeURIComponent(url.pathname.slice(1)) !== pg.POSTGRES_DB || api.MINIO_ENDPOINT !== 'minio') throw new Error('This tool supports the local Compose DB and object store only');
  return { bucket: api.MINIO_BUCKET || 'sara-assets' };
}
const sourceOp = (root, action, input) => command(compose('run', '--rm', '--no-deps', '-T', '--user', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`, '-v', `${root}:/bundle`, 'api', 'bun', 'src/ops/backup-objects.js', action), { input });

export async function backup(path) {
  const root = archivePath(path);
  const { bucket } = await sourceConfig();
  const running = (await command(compose('ps', '--status', 'running', '--services'), { capture: true })).split('\n');
  if (!running.includes('postgres') || !running.includes('minio')) throw new Error('PostgreSQL and MinIO must already be running');
  await mkdir(root, { mode: 0o700 }); // Never overwrite an existing or partial archive.
  const writers = ['api', 'worker'].filter((service) => running.includes(service));
  await Bun.write(join(root, 'maintenance.json'), JSON.stringify({ writers, createdAt: new Date().toISOString() }));
  try {
    if (writers.length) await command(compose('stop', '-t', '60', ...writers));
    await sourceOp(root, 'state');
    await command(compose('exec', '-T', 'postgres', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl -Fc'), { output: join(root, 'database.dump') });
    await command(compose('exec', '-T', 'minio', 'sh', '-c', 'mc alias set backup http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc ls --recursive --json "backup/$1"', 'sh', bucket), { output: join(root, 'inventory.jsonl') });
    await sourceOp(root, 'capture', join(root, 'inventory.jsonl'));
    await verifyBundle(root);
    for (const name of ['manifest.json', 'state.json', 'inventory.jsonl', 'database.dump']) await chmod(join(root, name), 0o600);
    // The completion marker is written only after full validation.
    await Bun.write(join(root, 'COMPLETE'), 'sara-backup-v1\n');
    console.log(JSON.stringify({ backup_directory: root, status: 'complete' }));
    return root;
  } finally {
    if (writers.length) {
      // A cancelled Docker stop can still be finishing on the daemon.
      try { await command(compose('stop', '-t', '60', ...writers), { cleanup: true }); }
      finally { await command(compose('start', ...writers), { cleanup: true }); }
    }
  }
}

export function restoreCommand(project, ...args) {
  if (!/^sara-restore-[a-z0-9][a-z0-9-]{0,39}$/.test(project)) throw new Error('Restore project must start with sara-restore-');
  return ['docker', 'compose', '-f', 'docker-compose.restore.yml', '-p', project, ...args];
}
export async function restore(path, project) {
  const root = archivePath(path);
  const manifest = await verifyBundle(root); // Validate all files before creating anything.
  if ((await Bun.file(join(root, 'COMPLETE')).text()) !== 'sara-backup-v1\n') throw new Error('Backup is incomplete');
  const env = { RESTORE_BUCKET: manifest.bucket };
  const containers = await command(['docker', 'ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`], { capture: true });
  const volumes = await command(['docker', 'volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`], { capture: true });
  if (containers || volumes) throw new Error('Restore project already exists; choose a new name');
  const run = (...args) => command(restoreCommand(project, ...args), { env });
  await run('up', '-d', '--wait', 'postgres', 'minio');
  await command(restoreCommand(project, 'exec', '-T', 'postgres', 'pg_restore', '-U', 'restore', '-d', 'restore', '--no-owner', '--no-acl', '--exit-on-error'), { input: join(root, 'database.dump'), env });
  await run('exec', '-T', 'minio', 'sh', '-c', 'mc alias set restore http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mb "restore/$1"', 'sh', manifest.bucket);
  const op = (action) => run('run', '--rm', '--no-deps', '-T', '-v', `${root}:/bundle:ro`, 'verifier', 'bun', 'src/ops/backup-objects.js', action);
  await op('upload');
  await verifyRestored(root, project);
  console.log(JSON.stringify({ project, restore: 'verified', application_started: false }));
  return project;
}
export async function verifyRestored(path, project) {
  const root = archivePath(path);
  const manifest = await verifyBundle(root);
  if ((await Bun.file(join(root, 'COMPLETE')).text()) !== 'sara-backup-v1\n') throw new Error('Backup is incomplete');
  const env = { RESTORE_BUCKET: manifest.bucket };
  const running = (await command(restoreCommand(project, 'ps', '--status', 'running', '--services'), { capture: true, env })).split('\n');
  if (!running.includes('postgres') || !running.includes('minio')) throw new Error('Restore DB and object store must be running');
  await command(restoreCommand(project, 'run', '--rm', '--no-deps', '-T', '-v', `${root}:/bundle:ro`, 'verifier', 'bun', 'src/ops/backup-objects.js', 'verify-restored'), { env });
}

if (import.meta.main) {
  // Finish the current Docker step before resuming writers; killing `compose stop`
  // mid-request can race a subsequent `compose start` on the daemon.
  process.on('SIGINT', () => { cancelled = 'SIGINT'; });
  process.on('SIGTERM', () => { cancelled = 'SIGTERM'; });
  try {
    const [action, path, project] = process.argv.slice(2);
    if (action === 'backup' && !project) await backup(path);
    else if (action === 'restore' && project) await restore(path, project);
    else if (action === 'check-restored' && project) await verifyRestored(path, project);
    else if (action === 'verify' && !project) { const root = archivePath(path); if ((await Bun.file(join(root, 'COMPLETE')).text()) !== 'sara-backup-v1\n') throw new Error('Backup is incomplete'); await verifyBundle(root); console.log('Backup bundle verified'); }
    else throw new Error('Usage: bun scripts/coordinated-backup.js backup|verify DIR | restore|check-restored DIR sara-restore-NAME');
    if (cancelled) throw new Error(`Interrupted: ${cancelled}`);
  } catch (error) { console.error(error.message); process.exitCode = cancelled ? 130 : 1; }
}
