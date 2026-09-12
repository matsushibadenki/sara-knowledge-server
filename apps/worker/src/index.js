// /apps/worker/src/index.js
import postgres from 'postgres';
import { memoryEventAsyncSchema, memoryEventValues } from '@sara-knowledge/domain-contracts/memory-events';
import { normalizeImportedRecord, parseImportContent } from '@sara-knowledge/domain-contracts/record-import';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://sara:change_me@localhost:5432/sara_knowledge', { max: 4 });
const redis = new Bun.RedisClient(process.env.REDIS_URL || 'redis://localhost:6379');
const workerId = `worker-${crypto.randomUUID()}`;
const chunkSize = Math.max(1, Number(process.env.WORKER_CHUNK_SIZE || 50));
const leaseSeconds = Math.max(10, Number(process.env.JOB_LEASE_SECONDS || 60));
const heartbeatSeconds = Math.max(2, Math.min(Number(process.env.JOB_HEARTBEAT_SECONDS || 15), Math.floor(leaseSeconds / 2)));
const reaperSeconds = Math.max(2, Number(process.env.JOB_REAPER_INTERVAL_SECONDS || 15));
const retryDelaySeconds = Math.max(0, Number(process.env.JOB_RETRY_DELAY_SECONDS || 5));
const redisTimeoutMs = Math.max(50, Number(process.env.JOB_REDIS_TIMEOUT_MS || 500));
const runOnce = process.env.WORKER_RUN_ONCE === 'true';
const s3 = new Bun.S3Client({
  endpoint: `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`,
  accessKeyId: process.env.MINIO_ACCESS_KEY || 'sara_minio',
  secretAccessKey: process.env.MINIO_SECRET_KEY || 'change_me',
  bucket: process.env.MINIO_BUCKET || 'sara-assets',
  region: 'us-east-1',
});

async function heartbeatJob(type, job) {
  if (type === 'import') return sql`UPDATE dataset.import_jobs SET heartbeat_at=now(), lease_expires_at=now() + ${leaseSeconds} * interval '1 second' WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
  if (type === 'export') return sql`UPDATE dataset.export_jobs SET heartbeat_at=now(), lease_expires_at=now() + ${leaseSeconds} * interval '1 second' WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
  return sql`UPDATE memory.event_ingestion_jobs SET heartbeat_at=now(), lease_expires_at=now() + ${leaseSeconds} * interval '1 second' WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
}

async function withHeartbeat(type, job, callback) {
  const timer = setInterval(() => {
    heartbeatJob(type, job).catch((error) => console.error(JSON.stringify({
      level: 'warn', service: 'worker', message: 'Job heartbeat failed', job_type: type, job_id: job.id, error: error.message,
    })));
  }, heartbeatSeconds * 1000);
  try {
    return await callback();
  } finally {
    clearInterval(timer);
  }
}

async function jobIsCancelled(type, job) {
  let rows;
  if (type === 'import') rows = await sql`SELECT cancel_requested FROM dataset.import_jobs WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation}`;
  else if (type === 'export') rows = await sql`SELECT cancel_requested FROM dataset.export_jobs WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation}`;
  else rows = await sql`SELECT cancel_requested FROM memory.event_ingestion_jobs WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation}`;
  return rows.length === 0 || Boolean(rows[0].cancel_requested);
}

async function cancelJob(type, job, values = {}) {
  if (type === 'import') return sql`UPDATE dataset.import_jobs SET status='cancelled', processed_count=${values.processedCount ?? job.processed_count}, succeeded_count=${values.succeededCount ?? job.succeeded_count}, failed_count=${values.failedCount ?? job.failed_count}, completed_at=now(), worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
  if (type === 'export') return sql`UPDATE dataset.export_jobs SET status='cancelled', completed_at=now(), worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
  return sql`UPDATE memory.event_ingestion_jobs SET status='cancelled', completed_at=now(), worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
}

async function retryOrFailJob(type, job, error) {
  const message = String(error?.message || error).slice(0, 2000);
  const terminal = job.attempt_count >= job.max_attempts;
  if (type === 'import') return sql`UPDATE dataset.import_jobs SET status=${terminal ? 'failed' : 'queued'}, error_message=${message}, completed_at=${terminal ? new Date() : null}, next_attempt_at=now() + ${retryDelaySeconds} * interval '1 second', worker_id=NULL, started_at=${terminal ? job.started_at : null}, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
  if (type === 'export') return sql`UPDATE dataset.export_jobs SET status=${terminal ? 'failed' : 'queued'}, error_message=${message}, completed_at=${terminal ? new Date() : null}, next_attempt_at=now() + ${retryDelaySeconds} * interval '1 second', worker_id=NULL, started_at=${terminal ? job.started_at : null}, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
  return sql`UPDATE memory.event_ingestion_jobs SET status=${terminal ? 'failed' : 'queued'}, error_message=${message}, completed_at=${terminal ? new Date() : null}, next_attempt_at=now() + ${retryDelaySeconds} * interval '1 second', worker_id=NULL, started_at=${terminal ? job.started_at : null}, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
}

async function claimImport() {
  return sql.begin(async (tx) => {
    const [job] = await tx`SELECT * FROM dataset.import_jobs WHERE mode='async' AND status='queued' AND cancel_requested=false AND next_attempt_at <= now() AND attempt_count < max_attempts ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!job) return null;
    const [claimed] = await tx`UPDATE dataset.import_jobs SET status='processing', worker_id=${workerId}, started_at=now(), heartbeat_at=now(), lease_expires_at=now() + ${leaseSeconds} * interval '1 second', claim_generation=claim_generation+1, attempt_count=attempt_count+1 WHERE id=${job.id} RETURNING *`;
    return claimed;
  });
}

async function claimExport() {
  return sql.begin(async (tx) => {
    const [job] = await tx`SELECT * FROM dataset.export_jobs WHERE mode='async' AND status='queued' AND cancel_requested=false AND next_attempt_at <= now() AND attempt_count < max_attempts ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!job) return null;
    const [claimed] = await tx`UPDATE dataset.export_jobs SET status='processing', worker_id=${workerId}, started_at=now(), heartbeat_at=now(), lease_expires_at=now() + ${leaseSeconds} * interval '1 second', claim_generation=claim_generation+1, attempt_count=attempt_count+1 WHERE id=${job.id} RETURNING *`;
    return claimed;
  });
}

async function claimMemoryEvents() {
  return sql.begin(async (tx) => {
    const [job] = await tx`SELECT * FROM memory.event_ingestion_jobs WHERE status='queued' AND cancel_requested=false AND next_attempt_at <= now() AND attempt_count < max_attempts ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!job) return null;
    const [claimed] = await tx`UPDATE memory.event_ingestion_jobs SET status='processing', worker_id=${workerId}, started_at=now(), heartbeat_at=now(), lease_expires_at=now() + ${leaseSeconds} * interval '1 second', claim_generation=claim_generation+1, attempt_count=attempt_count+1 WHERE id=${job.id} RETURNING *`;
    return claimed;
  });
}

async function processImport(job) {
  try {
    const content = await s3.file(job.object_key).text();
    const maxRows = Number(process.env.ASYNC_IMPORT_MAX_ROWS || 100000);
    const rows = parseImportContent(job.format, content, { maxRows });
    const [resume] = await sql`SELECT COALESCE(max(row_number),0)::int AS processed, count(*) FILTER (WHERE status='succeeded')::int AS succeeded, count(*) FILTER (WHERE status='failed')::int AS failed FROM dataset.import_items WHERE import_job_id=${job.id}`;
    const active = await sql`UPDATE dataset.import_jobs SET total_count=${rows.length}, processed_count=${resume.processed}, succeeded_count=${resume.succeeded}, failed_count=${resume.failed} WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
    if (active.length === 0) return;
    let succeeded = resume.succeeded; let failed = resume.failed;
    for (let i = resume.processed; i < rows.length; i += 1) {
      if (i % chunkSize === 0 && await jobIsCancelled('import', job)) {
        await cancelJob('import', job, { processedCount: i, succeededCount: succeeded, failedCount: failed });
        return;
      }
      try {
        const item = normalizeImportedRecord(rows[i], job.options || {});
        await sql.begin(async (tx) => {
          const recordId = crypto.randomUUID(); const versionId = crypto.randomUUID();
          await tx`INSERT INTO dataset.records (id,record_type,title,status,current_version_id,language_code,quality_score,confidence,source_id,owner_id,metadata) VALUES (${recordId},${item.recordType},${item.title},${item.status},NULL,${item.languageCode},${item.qualityScore},${item.confidence},${job.source_id},${job.created_by},${tx.json(item.metadata)})`;
          await tx`INSERT INTO dataset.record_versions (id,record_id,version_number,schema_version,content,plain_text,change_summary,created_by,is_current) VALUES (${versionId},${recordId},1,${item.schemaVersion},${tx.json(item.content)},${item.plainText},${`Async import row ${i + 1}`},${job.created_by},true)`;
          await tx`UPDATE dataset.records SET current_version_id=${versionId} WHERE id=${recordId}`;
          await tx`INSERT INTO dataset.import_items (import_job_id,row_number,status,record_id) VALUES (${job.id},${i + 1},'succeeded',${recordId})`;
          await tx`INSERT INTO system.audit_logs (actor_type,action,resource_type,resource_id,after_data,metadata) VALUES ('system','create','record',${recordId},${tx.json({ id: recordId, record_type: item.recordType, status: item.status, current_version_id: versionId })},${tx.json({ import_job_id: job.id, import_row: i + 1, worker_id: workerId })})`;
        });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        await sql`INSERT INTO dataset.import_items (import_job_id,row_number,status,error_code,error_message) VALUES (${job.id},${i + 1},'failed','INVALID_ROW',${String(error.message || error).slice(0, 2000)}) ON CONFLICT (import_job_id,row_number) DO NOTHING`;
      }
      if ((i + 1) % chunkSize === 0 || i === rows.length - 1) {
        const progress = await sql`UPDATE dataset.import_jobs SET processed_count=${i + 1}, succeeded_count=${succeeded}, failed_count=${failed} WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
        if (progress.length === 0) return;
      }
    }
    const status = failed === 0 ? 'completed' : succeeded === 0 ? 'failed' : 'completed_with_errors';
    await sql`UPDATE dataset.import_jobs SET status=${status}, processed_count=${rows.length}, succeeded_count=${succeeded}, failed_count=${failed}, completed_at=now(), worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation}`;
  } catch (error) {
    await retryOrFailJob('import', job, error);
  }
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatRows(rows, format) {
  if (format === 'json') return JSON.stringify(rows, null, 2);
  if (format === 'jsonl') return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const headers = ['id', 'record_type', 'title', 'status', 'language_code', 'quality_score', 'confidence', 'source_id', 'schema_version', 'content', 'plain_text', 'metadata'];
  return `${headers.join(',')}\n${rows.map((row) => headers.map((key) => csvCell(['content', 'metadata'].includes(key) ? JSON.stringify(row[key]) : row[key])).join(',')).join('\n')}\n`;
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function processExport(job) {
  try {
    if (await jobIsCancelled('export', job)) {
      await cancelJob('export', job); return;
    }
    const filters = job.filters || {};
    const rows = await sql`SELECT r.id,r.record_type,r.title,r.status,r.language_code,r.quality_score,r.confidence,r.source_id,v.schema_version,v.content,v.plain_text,r.metadata FROM dataset.records r JOIN dataset.record_versions v ON v.id=r.current_version_id WHERE r.deleted_at IS NULL AND (${filters.status || null}::text IS NULL OR r.status=${filters.status || null}) AND (${filters.record_type || null}::text IS NULL OR r.record_type=${filters.record_type || null}) AND (${filters.language_code || null}::text IS NULL OR r.language_code=${filters.language_code || null}) ORDER BY r.id LIMIT 100001`;
    if (rows.length > 100000) throw new Error('Async export exceeds the 100000 record limit.');
    const content = formatRows(rows, job.format);
    const outputKey = `${job.object_key}.claim-${job.claim_generation}`;
    await s3.write(outputKey, content, { type: 'text/plain; charset=utf-8' });
    await sql`UPDATE dataset.export_jobs SET status='completed', record_count=${rows.length}, byte_size=${new TextEncoder().encode(content).byteLength}, content_hash=${await digest(content)}, object_key=${outputKey}, completed_at=now(), worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation}`;
  } catch (error) {
    await retryOrFailJob('export', job, error);
  }
}

async function processMemoryEvents(job) {
  try {
    if (await jobIsCancelled('memory-events', job)) {
      await cancelJob('memory-events', job);
      return;
    }
    const stored = JSON.parse(await s3.file(job.object_key).text());
    const parsed = memoryEventAsyncSchema.safeParse({
      batch_uid: stored?.batch_uid ?? job.batch_uid,
      events: stored?.events,
    });
    if (!parsed.success || parsed.data.batch_uid !== job.batch_uid || parsed.data.events.length !== job.event_count) {
      throw new Error('Stored Event batch count is invalid.');
    }
    const events = parsed.data.events;
    const batchId = crypto.randomUUID();
    const now = new Date();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO memory.event_ingestion_batches (id,batch_uid,content_hash,event_count,created_by,created_at) VALUES (${batchId},${job.batch_uid},${job.content_hash},${events.length},${job.created_by},${now})`;
      const rows = events.map((event, index) => {
        const values = memoryEventValues(event);
        return {
          id: crypto.randomUUID(), event_uid: values.eventUid,
          source_id: values.sourceId, experience_id: values.experienceId,
          ingestion_batch_id: batchId, batch_position: index + 1,
          occurred_at: values.occurredAt, sequence_time: values.sequenceTime,
          duration: values.duration, modality: values.modality, channel: values.channel,
          event_type: values.eventType, symbol: values.symbol,
          payload: tx.json(values.payload), state_before: values.stateBefore == null ? null : tx.json(values.stateBefore),
          state_after: values.stateAfter == null ? null : tx.json(values.stateAfter),
          reward: values.reward, prediction_error: values.predictionError,
          confidence: values.confidence, quality_score: values.qualityScore,
          proposal_source: values.proposalSource, extractor_name: values.extractorName,
          extractor_version: values.extractorVersion,
          verification_state: values.verificationState, source_hash: values.sourceHash,
          novelty: values.novelty, priority_score: values.priorityScore,
          metadata: tx.json(values.metadata), created_by: job.created_by,
          created_at: now, updated_at: now, deleted_at: null,
        };
      });
      await tx`INSERT INTO memory.events ${tx(rows,
        'id', 'event_uid', 'source_id', 'experience_id', 'ingestion_batch_id', 'batch_position',
        'occurred_at', 'sequence_time', 'duration', 'modality', 'channel', 'event_type', 'symbol',
        'payload', 'state_before', 'state_after', 'reward', 'prediction_error', 'confidence',
        'quality_score', 'proposal_source', 'extractor_name', 'extractor_version', 'verification_state',
        'source_hash', 'novelty', 'priority_score', 'metadata', 'created_by', 'created_at', 'updated_at', 'deleted_at')}`;
      const completed = await tx`UPDATE memory.event_ingestion_jobs SET status='completed', processed_count=${events.length}, ingestion_batch_id=${batchId}, completed_at=now(), worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=${job.id} AND status='processing' AND worker_id=${workerId} AND claim_generation=${job.claim_generation} RETURNING id`;
      if (completed.length === 0) throw new Error('Memory Event claim is stale.');
    });
  } catch (error) {
    await retryOrFailJob('memory-events', job, error);
  }
}

async function reapJobs() {
  await Promise.all([
    sql`UPDATE dataset.import_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END, completed_at=now(), error_message=CASE WHEN cancel_requested THEN error_message ELSE COALESCE(error_message,'Maximum job attempts exhausted.') END WHERE mode='async' AND status='queued' AND (cancel_requested OR attempt_count >= max_attempts)`,
    sql`UPDATE dataset.export_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END, completed_at=now(), error_message=CASE WHEN cancel_requested THEN error_message ELSE COALESCE(error_message,'Maximum job attempts exhausted.') END WHERE mode='async' AND status='queued' AND (cancel_requested OR attempt_count >= max_attempts)`,
    sql`UPDATE memory.event_ingestion_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END, completed_at=now(), error_message=CASE WHEN cancel_requested THEN error_message ELSE COALESCE(error_message,'Maximum job attempts exhausted.') END WHERE status='queued' AND (cancel_requested OR attempt_count >= max_attempts)`,
    sql`UPDATE dataset.import_jobs SET status=CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END, completed_at=CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END, next_attempt_at=now() + ${retryDelaySeconds} * interval '1 second', error_message=CASE WHEN attempt_count >= max_attempts THEN COALESCE(error_message,'Job lease expired after maximum attempts.') ELSE error_message END, worker_id=NULL, started_at=CASE WHEN attempt_count >= max_attempts THEN started_at ELSE NULL END, heartbeat_at=NULL, lease_expires_at=NULL WHERE mode='async' AND status='processing' AND lease_expires_at < now()`,
    sql`UPDATE dataset.export_jobs SET status=CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END, completed_at=CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END, next_attempt_at=now() + ${retryDelaySeconds} * interval '1 second', error_message=CASE WHEN attempt_count >= max_attempts THEN COALESCE(error_message,'Job lease expired after maximum attempts.') ELSE error_message END, worker_id=NULL, started_at=CASE WHEN attempt_count >= max_attempts THEN started_at ELSE NULL END, heartbeat_at=NULL, lease_expires_at=NULL WHERE mode='async' AND status='processing' AND lease_expires_at < now()`,
    sql`UPDATE memory.event_ingestion_jobs SET status=CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END, completed_at=CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END, next_attempt_at=now() + ${retryDelaySeconds} * interval '1 second', error_message=CASE WHEN attempt_count >= max_attempts THEN COALESCE(error_message,'Job lease expired after maximum attempts.') ELSE error_message END, worker_id=NULL, started_at=CASE WHEN attempt_count >= max_attempts THEN started_at ELSE NULL END, heartbeat_at=NULL, lease_expires_at=NULL WHERE status='processing' AND lease_expires_at < now()`,
  ]);
}

const jobQueues = [
  { type: 'import', claim: claimImport, process: processImport },
  { type: 'export', claim: claimExport, process: processExport },
  { type: 'memory-events', claim: claimMemoryEvents, process: processMemoryEvents },
];

async function run() {
  console.log(JSON.stringify({ level: 'info', service: 'worker', message: 'Background worker started', worker_id: workerId }));
  let queueCursor = 0;
  let lastReaperAt = 0;
  let lastRedisWarningAt = 0;
  let redisRetryAt = 0;
  try {
    await reapJobs();
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', service: 'worker', message: 'Queue recovery deferred until migrations are available', error: error.message }));
  }
  while (true) {
    try {
      const now = Date.now();
      if (now - lastReaperAt >= reaperSeconds * 1000) {
        await reapJobs();
        lastReaperAt = now;
      }

      if (now >= redisRetryAt) {
        try {
          await Promise.race([
            redis.rpop('sara:background-jobs'),
            Bun.sleep(redisTimeoutMs).then(() => { throw new Error(`Redis notification timed out after ${redisTimeoutMs}ms.`); }),
          ]);
        } catch (error) {
          redisRetryAt = now + 30000;
          if (now - lastRedisWarningAt >= 30000) {
            console.error(JSON.stringify({ level: 'warn', service: 'worker', message: 'Redis notification unavailable; continuing PostgreSQL polling', error: error.message }));
            lastRedisWarningAt = now;
          }
        }
      }

      let claimed = false;
      for (let offset = 0; offset < jobQueues.length; offset += 1) {
        const queueIndex = (queueCursor + offset) % jobQueues.length;
        const queue = jobQueues[queueIndex];
        const job = await queue.claim();
        if (!job) continue;
        queueCursor = (queueIndex + 1) % jobQueues.length;
        claimed = true;
        await withHeartbeat(queue.type, job, () => queue.process(job));
        break;
      }
      if (claimed) continue;
      if (runOnce) break;
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', service: 'worker', message: error.message }));
      if (runOnce) throw error;
    }
    await Bun.sleep(500);
  }
  redis.close();
  if (runOnce) {
    await Promise.race([sql.end({ timeout: 0 }), Bun.sleep(1000)]);
    process.exit(0);
  }
  await sql.end();
}

if (import.meta.main) {
  process.on('SIGTERM', async () => { redis.close(); await sql.end(); process.exit(0); });
  await run();
}
