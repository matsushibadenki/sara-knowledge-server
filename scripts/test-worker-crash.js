// Real SIGKILL recovery; all triggers, data and volumes belong to a fresh project.
import { command } from './coordinated-backup.js';
import assert from 'node:assert/strict';

const project = `sara-crash-${crypto.randomUUID().slice(0, 8)}`;
const compose = ['docker', 'compose', '-f', 'docker-compose.restore.yml', '-f', 'docker-compose.crash-test.yml', '-p', project];
let interrupted;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = signal; });
function active() { if (interrupted) throw new Error(`Interrupted: ${interrupted}`); }
const run = (...args) => { active(); return command([...compose, ...args]); };
const capture = (...args) => { active(); return command([...compose, ...args], { capture: true }); };
const query = (sql) => capture('exec', '-T', 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'restore', '-d', 'restore', '-c', sql);
const check = async (expression) => assert.equal((await query(`SELECT (${expression})::text`)).trim(), 'true', expression);
async function until(checkReady, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await checkReady()) return;
    await Bun.sleep(500);
  }
  throw new Error(`Timed out: ${label}`);
}
async function killAtSleep() {
  await until(async () => (await query("SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep'")).trim() === '1', 'Worker entered the transaction pause');
  const id = (await capture('ps', '-q', 'worker')).trim();
  assert.ok(id);
  await run('kill', '--signal', 'SIGKILL', 'worker');
  assert.equal((await command(['docker', 'inspect', '--format', '{{.State.ExitCode}}', id], { capture: true })).trim(), '137');
  // Wait for the server to settle; submitted autocommit SQL may still commit.
  await until(async () => (await query("SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep'")).trim() === '0', 'killed client database operation settled');
}
async function recover(table, id, expected) {
  // Restart the actual Worker and let its reaper observe natural lease expiry.
  await run('start', 'worker');
  await until(async () => (await query(`SELECT status FROM ${table} WHERE id='${id}'`)).trim() === expected, `${table} recovered`);
  await check(`(SELECT claim_generation=2 AND attempt_count=2 AND worker_id IS NULL AND lease_expires_at IS NULL FROM ${table} WHERE id='${id}')`);
}
async function upload(key, content) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const dir = await mkdtemp('/tmp/sara-crash-');
  try {
    await Bun.write(`${dir}/input.json`, content);
    await command([...compose, 'exec', '-T', 'minio', 'mc', 'pipe', `crash/sara-assets/${key}`], { input: `${dir}/input.json` });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
try {
  await run('up', '-d', '--wait', 'postgres', 'minio');
  await run('run', '--rm', '--no-deps', 'verifier', 'bun', 'run', 'db:migrate');
  await run('run', '--rm', '--no-deps', 'verifier', 'bun', 'run', 'db:seed');
  await run('exec', '-T', 'minio', 'mc', 'alias', 'set', 'crash', 'http://localhost:9000', 'restore_only', 'restore_isolated_only');
  await run('exec', '-T', 'minio', 'mc', 'mb', 'crash/sara-assets');
  const rows = Array.from({ length: 100 }, (_, i) => ({ record_type: [16, 72].includes(i) ? 'invalid' : 'plain_text', text: `Crash row ${i + 1}` }));
  const payload = JSON.stringify(rows);
  await upload('crash/import.json', payload);
  const importId = (await query(`INSERT INTO dataset.import_jobs (format,mode,status,idempotency_key,content_hash,byte_size,object_key,options,created_by) SELECT 'json','async','queued','crash-import','sha256:fixture',${Buffer.byteLength(payload)},'crash/import.json','{}',id FROM auth.users LIMIT 1 RETURNING id`)).trim();
  await query(`CREATE FUNCTION public.crash_import_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.row_number=37 THEN PERFORM pg_sleep(15); END IF; RETURN NEW; END $$;
    CREATE TRIGGER crash_pause BEFORE INSERT ON dataset.import_items FOR EACH ROW EXECUTE FUNCTION public.crash_import_pause();`);
  await run('up', '-d', 'worker');
  await killAtSleep();
  await check(`(SELECT processed_count=30 AND status='processing' AND claim_generation=1 FROM dataset.import_jobs WHERE id='${importId}')`);
  await check(`(SELECT count(*)=36 AND max(row_number)=36 FROM dataset.import_items WHERE import_job_id='${importId}')`);
  await check('(SELECT count(*)=35 FROM dataset.records) AND (SELECT count(*)=35 FROM dataset.record_versions)');
  await query('DROP TRIGGER crash_pause ON dataset.import_items; DROP FUNCTION public.crash_import_pause();');
  await recover('dataset.import_jobs', importId, 'completed_with_errors');
  await check(`(SELECT processed_count=100 AND succeeded_count=98 AND failed_count=2 FROM dataset.import_jobs WHERE id='${importId}')`);
  await check(`(SELECT count(*)=100 AND count(DISTINCT row_number)=100 AND min(row_number)=1 AND max(row_number)=100 FROM dataset.import_items WHERE import_job_id='${importId}')`);
  await check('(SELECT count(*)=98 FROM dataset.records) AND (SELECT count(*)=98 FROM dataset.record_versions)');
  await check(`(SELECT count(*)=98 FROM system.audit_logs WHERE metadata->>'import_job_id'='${importId}')`);
  console.log('Import SIGKILL passed: 36 committed rows, one rolled-back row, stale progress resumed, 98 records and 2 rejected rows without duplicates.');

  await query(`CREATE FUNCTION public.crash_export_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='completed' THEN PERFORM pg_sleep(15); END IF; RETURN NEW; END $$;
    CREATE TRIGGER crash_pause BEFORE UPDATE ON dataset.export_jobs FOR EACH ROW EXECUTE FUNCTION public.crash_export_pause();`);
  const exportId = (await query("INSERT INTO dataset.export_jobs (format,mode,status,idempotency_key,filters,object_key,created_by) SELECT 'json','async','queued','crash-export','{}','crash/export.json',id FROM auth.users LIMIT 1 RETURNING id")).trim();
  await killAtSleep();
  const exportState = JSON.parse(await query(`SELECT row_to_json(j) FROM dataset.export_jobs j WHERE id='${exportId}'`));
  const first = await capture('exec', '-T', 'minio', 'mc', 'cat', 'crash/sara-assets/crash/export.json.claim-1');
  assert.equal(JSON.parse(first).length, 98);
  await query('DROP TRIGGER crash_pause ON dataset.export_jobs; DROP FUNCTION public.crash_export_pause();');
  // An already submitted autocommit UPDATE may finish after its client dies.
  // Both outcomes are valid, but the referenced object must match that claim.
  let generation = 1;
  if (exportState.status === 'processing') {
    await recover('dataset.export_jobs', exportId, 'completed');
    generation = 2;
  } else {
    assert.equal(exportState.status, 'completed');
    await check(`(SELECT claim_generation=1 AND attempt_count=1 AND worker_id IS NULL AND lease_expires_at IS NULL FROM dataset.export_jobs WHERE id='${exportId}')`);
  }
  const second = await capture('exec', '-T', 'minio', 'mc', 'cat', `crash/sara-assets/crash/export.json.claim-${generation}`);
  assert.equal(second, first);
  const hash = `sha256:${new Bun.CryptoHasher('sha256').update(second).digest('hex')}`;
  await check(`(SELECT object_key='crash/export.json.claim-${generation}' AND record_count=98 AND byte_size=${Buffer.byteLength(second)} AND content_hash='${hash}' FROM dataset.export_jobs WHERE id='${exportId}')`);
  console.log('Export SIGKILL passed: object persisted before crash, durable completion references the correct claim with matching bytes/hash.');

  // A single Event batch transaction must leave no partial batch or Events.
  await run('start', 'worker');
  const events = Array.from({ length: 501 }, (_, i) => ({ event_uid: `crash-${i}`, modality: 'text', event_type: 'observed', proposal_source: 'crash-test', payload: { index: i } }));
  await upload('crash/events.json', JSON.stringify({ batch_uid: 'crash-batch', events }));
  await query(`CREATE FUNCTION public.crash_event_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.batch_position=251 THEN PERFORM pg_sleep(15); END IF; RETURN NEW; END $$;
    CREATE TRIGGER crash_pause BEFORE INSERT ON memory.events FOR EACH ROW EXECUTE FUNCTION public.crash_event_pause();`);
  const eventId = (await query("INSERT INTO memory.event_ingestion_jobs (batch_uid,content_hash,object_key,event_count,created_by) SELECT 'crash-batch','sha256:fixture','crash/events.json',501,id FROM auth.users LIMIT 1 RETURNING id")).trim();
  await killAtSleep();
  await check('(SELECT count(*)=0 FROM memory.events) AND (SELECT count(*)=0 FROM memory.event_ingestion_batches)');
  await check(`(SELECT status='processing' AND processed_count=0 AND ingestion_batch_id IS NULL AND claim_generation=1 FROM memory.event_ingestion_jobs WHERE id='${eventId}')`);
  await query('DROP TRIGGER crash_pause ON memory.events; DROP FUNCTION public.crash_event_pause();');
  await recover('memory.event_ingestion_jobs', eventId, 'completed');
  await check('(SELECT count(*)=1 FROM memory.event_ingestion_batches) AND (SELECT count(*)=501 AND count(DISTINCT event_uid)=501 AND count(DISTINCT batch_position)=501 AND min(batch_position)=1 AND max(batch_position)=501 FROM memory.events)');
  await check(`(SELECT processed_count=501 AND ingestion_batch_id=(SELECT id FROM memory.event_ingestion_batches) FROM memory.event_ingestion_jobs WHERE id='${eventId}')`);
  console.log('Memory Event SIGKILL passed: partial batch rolled back, recovered claim committed exactly 501 unique Events and one batch.');
} catch (error) {
  await run('logs', '--no-color', '--tail=100', 'worker').catch(() => {});
  throw error;
} finally {
  await command([...compose, 'down', '-v', '--remove-orphans']);
}
