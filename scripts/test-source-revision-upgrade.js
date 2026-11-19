// Upgrade an old database, then restore its pre-upgrade dump and upgrade again.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, restoreCommand } from './coordinated-backup.js';

const token = crypto.randomUUID().slice(0, 8);
const projects = [`sara-restore-upgrade-${token}`, `sara-restore-rollback-${token}`];
const dir = await mkdtemp(join(tmpdir(), 'sara-source-upgrade-'));
const run = (project, ...args) => command(restoreCommand(project, ...args));
const query = (project, statement) => command(restoreCommand(project, 'exec', '-T', 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'restore', '-d', 'restore', '-c', statement), { capture: true });
const sourceId = '10000000-0000-4000-8000-000000000001';
const recordId = '10000000-0000-4000-8000-000000000002';
const versionId = '10000000-0000-4000-8000-000000000003';
try {
  await run(projects[0], 'up', '-d', '--wait', 'postgres');
  // Use the current image, but the committed journal only through migration 28.
  await run(projects[0], 'run', '--rm', '--no-deps', 'verifier', 'bun', '-e', `
    import { cp } from 'node:fs/promises';
    import { migrate } from 'drizzle-orm/postgres-js/migrator';
    import { db, closeDatabase } from './src/db/client.js';
    const folder='/tmp/source-upgrade-migrations';
    await cp('src/db/migrations',folder,{recursive:true});
    const journal=await Bun.file(folder+'/meta/_journal.json').json();
    journal.entries=journal.entries.filter(e=>e.idx<29);
    await Bun.write(folder+'/meta/_journal.json',JSON.stringify(journal));
    try { await migrate(db,{migrationsFolder:folder}); } finally { await closeDatabase(); }
  `);
  await query(projects[0], `INSERT INTO dataset.sources(id,source_type,title) VALUES('${sourceId}','manual','Legacy source');
    INSERT INTO dataset.records(id,record_type,source_id) VALUES('${recordId}','plain_text','${sourceId}');
    INSERT INTO dataset.record_versions(id,record_id,version_number,content,is_current) VALUES('${versionId}','${recordId}',1,'{}',true);
    UPDATE dataset.records SET current_version_id='${versionId}' WHERE id='${recordId}';`);
  await command(restoreCommand(projects[0], 'exec', '-T', 'postgres', 'pg_dump', '-U', 'restore', '-d', 'restore', '-Fc', '--no-owner', '--no-acl'), { output: join(dir, 'before.dump') });
  await run(projects[1], 'up', '-d', '--wait', 'postgres');
  await command(restoreCommand(projects[1], 'exec', '-T', 'postgres', 'pg_restore', '-U', 'restore', '-d', 'restore', '--no-owner', '--no-acl', '--exit-on-error'), { input: join(dir, 'before.dump') });
  for (const project of projects) {
    await run(project, 'run', '--rm', '--no-deps', 'verifier', 'bun', 'run', 'db:migrate');
    assert.equal(await query(project, `SELECT (source_pin_state='legacy_unknown' AND source_id IS NULL AND source_revision IS NULL AND context_snapshot IS NULL)::text FROM dataset.record_versions WHERE id='${versionId}'`), 'true');
    assert.equal(await query(project, `SELECT origin||':'||(snapshot->>'title') FROM dataset.source_revisions WHERE source_id='${sourceId}' AND revision=1`), 'migration_baseline:Legacy source');
    await query(project, `UPDATE dataset.sources SET title='Corrected' WHERE id='${sourceId}';`);
    assert.equal(await query(project, `SELECT revision FROM dataset.sources WHERE id='${sourceId}'`), '2');
    assert.equal(await query(project, `SELECT snapshot->>'title' FROM dataset.source_revisions WHERE source_id='${sourceId}' AND revision=1`), 'Legacy source');
    await query(project, `INSERT INTO dataset.records(id,record_type,source_id) VALUES('10000000-0000-4000-8000-000000000004','plain_text','${sourceId}');
      INSERT INTO dataset.record_versions(record_id,version_number,content) VALUES('10000000-0000-4000-8000-000000000004',1,'{}');`);
    assert.equal(await query(project, "SELECT (source_revision=2 AND source_pin_state='pinned' AND context_snapshot->>'record_type'='plain_text')::text FROM dataset.record_versions WHERE record_id='10000000-0000-4000-8000-000000000004'"), 'true');
  }
  console.log('Source revision upgrade passed: legacy provenance stays unknown, baseline retained, pre-upgrade dump restores and re-upgrades, new records pin the current revision.');
} finally {
  const cleanup = await Promise.allSettled(projects.map((project) => run(project, 'down', '-v', '--remove-orphans')));
  await rm(dir, { recursive: true, force: true });
  for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
}
