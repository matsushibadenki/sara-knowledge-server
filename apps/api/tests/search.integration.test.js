import { expect, test } from 'bun:test';
import { withWorkspaceFixture } from './support/workspace-fixture.js';

const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

integrationTest('multilingual literal search separates candidates and excludes stale confirmed knowledge', async () => {
  await withWorkspaceFixture(async ({ request, headers, roleHeaders }) => {
    const reviewer = await roleHeaders('reviewer');
    const suffix = crypto.randomUUID();
    const write = (path, method, body) => request('/api/v1' + path, { method, headers, body: JSON.stringify(body) });
    const find = (q, mode, extra = {}) => request('/api/v1/search?' + new URLSearchParams({ q, mode, ...extra }), { headers });
    const source = (await write('/sources', 'POST', { source_type: 'manual', title: suffix })).body.data;
    const title = `再起動手順 Ｒｅｃｏｖｅｒｙ 恢复指南 ${suffix}`;
    const record = (await write('/records', 'POST', { record_type: 'plain_text', source_id: source.id, title, content: { text: title } })).body.data;
    const second = (await write('/records', 'POST', { record_type: 'plain_text', title, content: { text: title } })).body.data;
    for (const term of ['再起動', 'RECOVERY', '恢复指南']) {
      const result = await find(`${term} ${suffix}`, 'candidate', { kind: 'record' });
      expect(result.response.status).toBe(200);
      expect(result.body.data.map((row) => row.id)).toContain(record.id);
    }
    expect((await find(`% ${suffix}`, 'candidate')).body.data).toEqual([]);
    const first = await find(suffix, 'candidate', { kind: 'record', limit: '1' });
    const cursor = first.body.meta.next_cursor;
    expect(cursor).toBeTruthy();
    const next = await find(suffix, 'candidate', { kind: 'record', limit: '1', cursor });
    expect(new Set([first.body.data[0].id, next.body.data[0].id])).toEqual(new Set([record.id, second.id]));
    expect((await find(suffix, 'confirmed', { cursor })).response.status).toBe(400);

    const relation = (await write('/memory/relations', 'POST', {
      relation_uid: suffix, source_type: 'record', source_id: record.id, target_type: 'record', target_id: second.id,
      relation_type: 'references', proposal_source: 'human', verification_state: 'candidate', context: { text: title },
    })).body.data;
    const evidencePath = `/memory/relations/${relation.id}/evidence`;
    const addEvidence = (revision, predecessor) => write(evidencePath, 'POST', {
      expected_revision: revision, evidence_uid: crypto.randomUUID(), reference_type: 'source',
      reference_id: source.id, evidence_type: 'document', supports: true, supersedes_evidence_id: predecessor,
    });
    const verify = (revision) => write(`/memory/verification/relation/${relation.id}`, 'POST', {
      expected_revision: revision, expected_state: 'candidate', state: 'verified',
    });
    const original = (await addEvidence(relation.revision)).body.data;
    expect((await find(suffix, 'confirmed')).body.data).toEqual([]);
    expect((await verify(original.relation.revision)).response.status).toBe(200);
    const confirmed = () => find(`恢复指南 recovery ${suffix}`, 'confirmed', { kind: 'relation' });
    expect((await confirmed()).body.data.map((row) => row.id)).toEqual([relation.id]);

    const review = (await write(`/records/${record.id}/submit-review`, 'POST', {})).body.data;
    expect((await request(`/api/v1/records/${record.id}/reviews/${review.id}/decision`, {
      method: 'POST', headers: reviewer, body: JSON.stringify({ decision: 'approved' }),
    })).response.status).toBe(200);
    const confirmedRecords = () => find(`再起動 ${suffix}`, 'confirmed', { kind: 'record' });
    expect((await confirmedRecords()).body.data.map((row) => row.id)).toEqual([record.id]);
    expect((await find(suffix, 'candidate', { kind: 'record' })).body.data.map((row) => row.id)).toEqual([second.id]);

    expect((await write(`/sources/${source.id}`, 'PATCH', { expected_revision: 1, title: 'Corrected' })).response.status).toBe(200);
    expect((await confirmed()).body.data).toEqual([]);
    expect((await confirmedRecords()).body.data).toEqual([]);
    const current = (await request(`/api/v1/memory/relations/${relation.id}`, { headers })).body.data;
    const replacement = (await addEvidence(current.revision, original.evidence.id)).body.data;
    expect((await verify(replacement.relation.revision)).response.status).toBe(200);
    expect((await confirmed()).body.data.map((row) => row.id)).toEqual([relation.id]);

    expect((await write(`/sources/${source.id}`, 'DELETE')).response.status).toBe(200);
    expect((await confirmed()).body.data).toEqual([]);
    expect((await request('/api/v1/search?q=test&mode=confirmed')).response.status).toBe(401);
  });
}, 30_000);
