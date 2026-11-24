import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRoles, requireScopes } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { recordSearchChunks, recordVersions, records } from '../db/schema/index.js';
import { chunkSearchText, encodeSearchText, ENCODER } from '../services/search-encoder.js';

const search = new Hono();
const kind = z.enum(['record', 'relation']);
const cursorSchema = z.object({ kind, id: z.string().uuid(), query: z.string() });
const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  mode: z.enum(['candidate', 'confirmed']),
  kind: kind.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
});

function invalid(c, message) {
  return c.json({ data: null, meta: {}, error: { code: 'VALIDATION_ERROR', message, details: [] } }, 400);
}

function literalMatches(document, terms) {
  return sql.join(terms.map((term) => sql`${document} LIKE lower(${'%' + term.replace(/[\\%_]/g, '\\$&') + '%'})`), sql` AND `);
}

const recordDocument = sql`lower(normalize(coalesce(v.context_snapshot->>'title','') || ' ' || coalesce(v.plain_text,'') || ' ' || v.content::text, NFKC))`;

function recordEligibility(confirmed) {
  const state = confirmed ? sql`r.status='approved' AND (
    v.source_pin_state='none' OR
    (v.source_pin_state='pinned' AND s.deleted_at IS NULL AND s.revision=v.source_revision)
  )` : sql`r.status IN ('draft','pending_review')`;
  return sql`r.deleted_at IS NULL AND v.deleted_at IS NULL AND v.is_current AND ${state}`;
}

search.get('/', requireAuth, requireScopes('records:read', 'memory:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, 'Invalid knowledge search query.');
  const { q, mode, kind: selectedKind, limit } = parsed.data;
  const terms = q.normalize('NFKC').trim().split(/\s+/u).filter(Boolean);
  if (!terms.length || terms.length > 12) return invalid(c, 'Provide one to twelve search terms.');
  const queryKey = createHash('sha256').update(JSON.stringify([terms, mode, selectedKind])).digest('hex');
  let cursor;
  if (parsed.data.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(parsed.data.cursor, 'base64url').toString())); }
    catch { return invalid(c, 'Invalid search cursor.'); }
    if (cursor.query !== queryKey) return invalid(c, 'The search cursor belongs to a different query.');
  }

  const confirmed = mode === 'confirmed';
  const recordMatches = sql`
    SELECT 'record'::text AS kind, r.id, v.id AS version_id, v.version_number AS revision,
           COALESCE(v.context_snapshot->>'title', r.title) AS label, r.status AS state
    FROM dataset.records r
    JOIN dataset.record_versions v ON v.id=r.current_version_id AND v.record_id=r.id
    LEFT JOIN dataset.sources s ON s.id=v.source_id
    WHERE ${recordEligibility(confirmed)}
      AND ${literalMatches(recordDocument, terms)}
      ${cursor ? sql`AND ('record'::text, r.id) > (${cursor.kind}::text, ${cursor.id}::uuid)` : sql``}`;
  const relationMatches = sql`
    SELECT 'relation'::text AS kind, r.id, NULL::uuid AS version_id, r.revision,
           r.relation_type AS label, r.verification_state AS state
    FROM memory.relations r
    WHERE r.deleted_at IS NULL
      AND (r.valid_from IS NULL OR r.valid_from <= now())
      AND (r.valid_until IS NULL OR r.valid_until >= now())
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND ${confirmed ? sql`r.verification_state='verified'
        AND EXISTS (
          SELECT 1 FROM memory.relation_evidence e
          WHERE e.relation_id=r.id AND e.supports AND e.reference_snapshot->'pin'->>'source_id' IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM memory.relation_evidence replacement WHERE replacement.supersedes_evidence_id=e.id)
        )
        AND NOT EXISTS (SELECT 1 FROM memory.active_stale_source_evidence s WHERE s.relation_id=r.id)
        AND NOT EXISTS (
          SELECT 1 FROM memory.relation_evidence e
          LEFT JOIN dataset.sources pinned_source ON pinned_source.id=(e.reference_snapshot->'pin'->>'source_id')::uuid
          LEFT JOIN dataset.records target ON e.reference_type='record' AND target.id=e.reference_id
          WHERE e.relation_id=r.id
            AND NOT EXISTS (SELECT 1 FROM memory.relation_evidence replacement WHERE replacement.supersedes_evidence_id=e.id)
            AND (
              pinned_source.id IS NULL OR
              (e.reference_type='record' AND (target.id IS NULL OR target.deleted_at IS NOT NULL OR
                target.current_version_id::text IS DISTINCT FROM e.reference_snapshot->'pin'->>'record_version_id'))
            )
        )` : sql`r.verification_state IN ('candidate','unverified')`}
      AND ${literalMatches(sql`lower(normalize(r.relation_type || ' ' || r.context::text || ' ' || r.payload::text, NFKC))`, terms)}
      ${cursor ? sql`AND ('relation'::text, r.id) > (${cursor.kind}::text, ${cursor.id}::uuid)` : sql``}`;
  const matches = selectedKind === 'record' ? recordMatches : selectedKind === 'relation'
    ? relationMatches : sql`${recordMatches} UNION ALL ${relationMatches}`;
  const rows = await db.execute(sql`SELECT * FROM (${matches}) matches ORDER BY kind, id LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit
    ? Buffer.from(JSON.stringify({ kind: last.kind, id: last.id, query: queryKey })).toString('base64url') : null;
  return c.json({ data: page, meta: { mode, next_cursor: nextCursor }, error: null });
});

search.put('/records/:id/versions/:versionId/index',
  requireAuth, requireScopes('records:read', 'records:write'), requireRoles('admin', 'editor'), async (c) => {
    const ids = z.object({ id: z.string().uuid(), versionId: z.string().uuid() }).safeParse(c.req.param());
    if (!ids.success) return invalid(c, 'Invalid Record or Version ID.');
    const [version] = await db.select({ title: recordVersions.contextSnapshot, text: recordVersions.plainText, content: recordVersions.content })
      .from(recordVersions).innerJoin(records, eq(records.id, recordVersions.recordId))
      .where(and(eq(records.id, ids.data.id), eq(recordVersions.id, ids.data.versionId), isNull(records.deletedAt), isNull(recordVersions.deletedAt)));
    if (!version) return c.json({ data: null, meta: {}, error: { code: 'RESOURCE_NOT_FOUND', message: 'Record version was not found.', details: [] } }, 404);
    let chunks;
    try {
      chunks = chunkSearchText([version.title?.title, version.text, JSON.stringify(version.content)].filter(Boolean).join(' '));
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return c.json({ data: null, meta: {}, error: { code: 'SEARCH_TEXT_TOO_LARGE', message: error.message, details: [] } }, 413);
    }
    if (chunks.length) await db.insert(recordSearchChunks).values(chunks.map((chunk) => ({
      ...chunk, recordVersionId: ids.data.versionId, encoder: ENCODER,
    }))).onConflictDoNothing();
    return c.json({ data: { record_version_id: ids.data.versionId, encoder: ENCODER, chunk_count: chunks.length }, meta: {}, error: null });
  });

search.get('/hybrid',
  requireAuth, requireScopes('records:read'), requireRoles('admin', 'editor', 'reviewer', 'viewer'), async (c) => {
    const parsed = querySchema.pick({ q: true, mode: true, limit: true }).safeParse(c.req.query());
    if (!parsed.success) return invalid(c, 'Invalid hybrid query.');
    const { q, mode, limit } = parsed.data;
    const terms = q.normalize('NFKC').trim().split(/\s+/u).filter(Boolean);
    const embedding = encodeSearchText(q);
    if (!embedding || terms.length > 12) return invalid(c, 'Provide one to twelve search terms containing letters or numbers.');
    const literal = literalMatches(recordDocument, terms);
    const queryVector = JSON.stringify(embedding);
    const data = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '3s'`);
      return tx.execute(sql`
        WITH matches AS (
          SELECT r.id, v.id AS version_id, v.version_number AS revision,
                 v.context_snapshot->>'title' AS label, r.status AS state,
                 (${literal}) AS lexical_match, ranked.similarity
          FROM dataset.records r
          JOIN dataset.record_versions v ON v.id=r.current_version_id AND v.record_id=r.id
          LEFT JOIN dataset.sources s ON s.id=v.source_id
          LEFT JOIN LATERAL (
            SELECT max(1 - (chunk.embedding <=> ${queryVector}::vector)) AS similarity
            FROM dataset.record_search_chunks chunk
            WHERE chunk.record_version_id=v.id AND chunk.encoder=${ENCODER}
          ) ranked ON true
          WHERE ${recordEligibility(mode === 'confirmed')}
        )
        SELECT * FROM matches WHERE lexical_match OR similarity >= 0.5
        ORDER BY lexical_match DESC, similarity DESC NULLS LAST, id LIMIT ${limit}`);
    }).catch((error) => {
      if ((error.code ?? error.cause?.code) === '57014') return null;
      throw error;
    });
    if (!data) return c.json({ data: null, meta: {}, error: { code: 'SEARCH_TIMEOUT', message: 'Hybrid search exceeded its time budget.', details: [] } }, 503);
    return c.json({ data, meta: { mode, encoder: ENCODER, comparison: 'lexical-first-cosine' }, error: null });
  });

export default search;
