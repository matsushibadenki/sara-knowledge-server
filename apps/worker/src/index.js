// /apps/worker/src/index.js
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://sara:change_me@localhost:5432/sara_knowledge', { max: 4 });
const redis = new Bun.RedisClient(process.env.REDIS_URL || 'redis://localhost:6379');
const workerId = `worker-${crypto.randomUUID()}`;
const chunkSize = Math.max(1, Number(process.env.WORKER_CHUNK_SIZE || 50));
const s3 = new Bun.S3Client({
  endpoint: `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`,
  accessKeyId: process.env.MINIO_ACCESS_KEY || 'sara_minio',
  secretAccessKey: process.env.MINIO_SECRET_KEY || 'change_me',
  bucket: process.env.MINIO_BUCKET || 'sara-assets',
  region: 'us-east-1',
});

function parseCsv(content) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const data = rows.filter((values) => values.some(Boolean));
  if (data.length < 2) return [];
  const headers = data[0].map((value) => value.trim());
  return data.slice(1).map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ''])));
}

function parseContent(format, content) {
  if (format === 'jsonl') return content.split(/\r?\n/).filter((line) => line.trim()).map(JSON.parse);
  if (format === 'csv') return parseCsv(content);
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [parsed];
}

function maybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalize(row, defaults = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || !Object.keys(row).length) throw new Error('Row must be a non-empty object.');
  const recordType = row.record_type || defaults.record_type || (row.instruction !== undefined ? 'instruction' : 'plain_text');
  const allowed = ['plain_text', 'instruction', 'qa', 'chat', 'sharegpt', 'chatml', 'dpo', 'rlhf', 'classification', 'image_caption', 'multimodal', 'event_sequence', 'custom'];
  if (!allowed.includes(recordType)) throw new Error(`Unsupported record_type: ${recordType}`);
  const status = row.status || defaults.status || 'draft';
  if (!['draft', 'pending_review', 'approved', 'rejected', 'archived'].includes(status)) throw new Error(`Unsupported status: ${status}`);
  const qualityScore = row.quality_score === '' || row.quality_score == null ? null : Number(row.quality_score);
  const confidence = row.confidence === '' || row.confidence == null ? null : Number(row.confidence);
  if ((qualityScore != null && (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 1))
    || (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))) {
    throw new Error('quality_score and confidence must be between 0 and 1.');
  }
  return {
    recordType, title: row.title || null, status,
    languageCode: row.language_code || defaults.language_code || null,
    qualityScore, confidence,
    content: row.content === undefined ? row : maybeJson(row.content),
    plainText: row.plain_text || row.text || null, schemaVersion: row.schema_version || '1.0',
    metadata: row.metadata && typeof maybeJson(row.metadata) === 'object' ? maybeJson(row.metadata) : {},
  };
}

async function claimImport() {
  return sql.begin(async (tx) => {
    const [job] = await tx`SELECT * FROM dataset.import_jobs WHERE mode='async' AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!job) return null;
    const [claimed] = await tx`UPDATE dataset.import_jobs SET status='processing', worker_id=${workerId}, started_at=now() WHERE id=${job.id} RETURNING *`;
    return claimed;
  });
}

async function claimExport() {
  return sql.begin(async (tx) => {
    const [job] = await tx`SELECT * FROM dataset.export_jobs WHERE mode='async' AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!job) return null;
    const [claimed] = await tx`UPDATE dataset.export_jobs SET status='processing', worker_id=${workerId}, started_at=now() WHERE id=${job.id} RETURNING *`;
    return claimed;
  });
}

async function claimMemoryEvents() {
  return sql.begin(async (tx) => {
    const [job] = await tx`SELECT * FROM memory.event_ingestion_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!job) return null;
    const [claimed] = await tx`UPDATE memory.event_ingestion_jobs SET status='processing', worker_id=${workerId}, started_at=now() WHERE id=${job.id} RETURNING *`;
    return claimed;
  });
}

async function isCancelled(type, id) {
  const [row] = type === 'import'
    ? await sql`SELECT cancel_requested FROM dataset.import_jobs WHERE id=${id}`
    : await sql`SELECT cancel_requested FROM dataset.export_jobs WHERE id=${id}`;
  return Boolean(row?.cancel_requested);
}

async function processImport(job) {
  try {
    const content = await s3.file(job.object_key).text();
    const rows = parseContent(job.format, content);
    const maxRows = Number(process.env.ASYNC_IMPORT_MAX_ROWS || 100000);
    if (rows.length > maxRows) throw new Error(`Import exceeds the ${maxRows} row limit.`);
    const [resume] = await sql`SELECT COALESCE(max(row_number),0)::int AS processed, count(*) FILTER (WHERE status='succeeded')::int AS succeeded, count(*) FILTER (WHERE status='failed')::int AS failed FROM dataset.import_items WHERE import_job_id=${job.id}`;
    await sql`UPDATE dataset.import_jobs SET total_count=${rows.length}, processed_count=${resume.processed}, succeeded_count=${resume.succeeded}, failed_count=${resume.failed} WHERE id=${job.id}`;
    let succeeded = resume.succeeded; let failed = resume.failed;
    for (let i = resume.processed; i < rows.length; i += 1) {
      if (i % chunkSize === 0 && await isCancelled('import', job.id)) {
        await sql`UPDATE dataset.import_jobs SET status='cancelled', processed_count=${i}, succeeded_count=${succeeded}, failed_count=${failed}, completed_at=now() WHERE id=${job.id}`;
        return;
      }
      try {
        const item = normalize(rows[i], job.options || {});
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
        await sql`UPDATE dataset.import_jobs SET processed_count=${i + 1}, succeeded_count=${succeeded}, failed_count=${failed} WHERE id=${job.id}`;
      }
    }
    const status = failed === 0 ? 'completed' : succeeded === 0 ? 'failed' : 'completed_with_errors';
    await sql`UPDATE dataset.import_jobs SET status=${status}, processed_count=${rows.length}, succeeded_count=${succeeded}, failed_count=${failed}, completed_at=now() WHERE id=${job.id}`;
  } catch (error) {
    await sql`UPDATE dataset.import_jobs SET status='failed', error_message=${String(error.message || error).slice(0, 2000)}, completed_at=now() WHERE id=${job.id}`;
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
    if (await isCancelled('export', job.id)) {
      await sql`UPDATE dataset.export_jobs SET status='cancelled', completed_at=now() WHERE id=${job.id}`; return;
    }
    const filters = job.filters || {};
    const rows = await sql`SELECT r.id,r.record_type,r.title,r.status,r.language_code,r.quality_score,r.confidence,r.source_id,v.schema_version,v.content,v.plain_text,r.metadata FROM dataset.records r JOIN dataset.record_versions v ON v.id=r.current_version_id WHERE r.deleted_at IS NULL AND (${filters.status || null}::text IS NULL OR r.status=${filters.status || null}) AND (${filters.record_type || null}::text IS NULL OR r.record_type=${filters.record_type || null}) AND (${filters.language_code || null}::text IS NULL OR r.language_code=${filters.language_code || null}) ORDER BY r.id LIMIT 100001`;
    if (rows.length > 100000) throw new Error('Async export exceeds the 100000 record limit.');
    const content = formatRows(rows, job.format);
    await s3.write(job.object_key, content, { type: 'text/plain; charset=utf-8' });
    await sql`UPDATE dataset.export_jobs SET status='completed', record_count=${rows.length}, byte_size=${new TextEncoder().encode(content).byteLength}, content_hash=${await digest(content)}, completed_at=now() WHERE id=${job.id}`;
  } catch (error) {
    await sql`UPDATE dataset.export_jobs SET status='failed', error_message=${String(error.message || error).slice(0, 2000)}, completed_at=now() WHERE id=${job.id}`;
  }
}

async function processMemoryEvents(job) {
  try {
    const [state] = await sql`SELECT cancel_requested FROM memory.event_ingestion_jobs WHERE id=${job.id}`;
    if (state?.cancel_requested) {
      await sql`UPDATE memory.event_ingestion_jobs SET status='cancelled', completed_at=now() WHERE id=${job.id}`;
      return;
    }
    const parsed = JSON.parse(await s3.file(job.object_key).text());
    const events = parsed?.events;
    if (!Array.isArray(events) || events.length !== job.event_count || events.length < 501 || events.length > 10000) {
      throw new Error('Stored Event batch count is invalid.');
    }
    const batchId = crypto.randomUUID();
    const now = new Date();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO memory.event_ingestion_batches (id,batch_uid,content_hash,event_count,created_by,created_at) VALUES (${batchId},${job.batch_uid},${job.content_hash},${events.length},${job.created_by},${now})`;
      const rows = events.map((event, index) => ({
        id: crypto.randomUUID(), event_uid: event.event_uid,
        source_id: event.source_id ?? null, experience_id: event.experience_id ?? null,
        ingestion_batch_id: batchId, batch_position: index + 1,
        occurred_at: event.occurred_at ?? null, sequence_time: event.sequence_time ?? null,
        duration: event.duration ?? null, modality: event.modality, channel: event.channel ?? null,
        event_type: event.event_type, symbol: event.symbol ?? null,
        payload: tx.json(event.payload ?? {}), state_before: event.state_before == null ? null : tx.json(event.state_before),
        state_after: event.state_after == null ? null : tx.json(event.state_after),
        reward: event.reward ?? 0, prediction_error: event.prediction_error ?? 0,
        confidence: event.confidence ?? 1, quality_score: event.quality_score ?? 0.5,
        proposal_source: event.proposal_source, extractor_name: event.extractor_name ?? null,
        extractor_version: event.extractor_version ?? null,
        verification_state: event.verification_state ?? 'unverified', source_hash: event.source_hash ?? null,
        novelty: event.novelty ?? 0, priority_score: event.priority_score ?? 0,
        metadata: tx.json(event.metadata ?? {}), created_by: job.created_by,
        created_at: now, updated_at: now, deleted_at: null,
      }));
      await tx`INSERT INTO memory.events ${tx(rows,
        'id', 'event_uid', 'source_id', 'experience_id', 'ingestion_batch_id', 'batch_position',
        'occurred_at', 'sequence_time', 'duration', 'modality', 'channel', 'event_type', 'symbol',
        'payload', 'state_before', 'state_after', 'reward', 'prediction_error', 'confidence',
        'quality_score', 'proposal_source', 'extractor_name', 'extractor_version', 'verification_state',
        'source_hash', 'novelty', 'priority_score', 'metadata', 'created_by', 'created_at', 'updated_at', 'deleted_at')}`;
      await tx`UPDATE memory.event_ingestion_jobs SET status='completed', processed_count=${events.length}, ingestion_batch_id=${batchId}, completed_at=now() WHERE id=${job.id}`;
    });
  } catch (error) {
    await sql`UPDATE memory.event_ingestion_jobs SET status='failed', error_message=${String(error.message || error).slice(0, 2000)}, completed_at=now() WHERE id=${job.id}`;
  }
}

async function run() {
  console.log(JSON.stringify({ level: 'info', service: 'worker', message: 'Background worker started', worker_id: workerId }));
  try {
    await sql`UPDATE dataset.import_jobs SET status='queued', worker_id=NULL, started_at=NULL WHERE mode='async' AND status='processing' AND started_at < now() - interval '5 minutes'`;
    await sql`UPDATE dataset.export_jobs SET status='queued', worker_id=NULL, started_at=NULL WHERE mode='async' AND status='processing' AND started_at < now() - interval '5 minutes'`;
    await sql`UPDATE memory.event_ingestion_jobs SET status='queued', worker_id=NULL, started_at=NULL WHERE status='processing' AND started_at < now() - interval '5 minutes'`;
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', service: 'worker', message: 'Queue recovery deferred until migrations are available', error: error.message }));
  }
  while (true) {
    try {
      await redis.rpop('sara:background-jobs');
      const importJob = await claimImport();
      if (importJob) { await processImport(importJob); continue; }
      const exportJob = await claimExport();
      if (exportJob) { await processExport(exportJob); continue; }
      const memoryEventJob = await claimMemoryEvents();
      if (memoryEventJob) { await processMemoryEvents(memoryEventJob); continue; }
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', service: 'worker', message: error.message }));
    }
    await Bun.sleep(500);
  }
}

process.on('SIGTERM', async () => { redis.close(); await sql.end(); process.exit(0); });
run();
