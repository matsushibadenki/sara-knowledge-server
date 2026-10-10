import { expect, test } from 'bun:test';
import { withWorkspaceFixture } from './support/workspace-fixture.js';
const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

integrationTest('quality annotations, pending review restrictions and approval audit are independent of provenance tests', async () => {
  await withWorkspaceFixture(async ({ request, headers, login }) => {
    const created = await request('/api/v1/records', {
      method: 'POST', headers,
      body: JSON.stringify({ record_type: 'instruction', content: { instruction: 'ping', output: 'pong' } }),
    });
    expect(created.response.status).toBe(201);
    const recordId = created.body.data.id;
    const annotation = await request(`/api/v1/records/${recordId}/annotations`, {
      method: 'POST', headers,
      body: JSON.stringify({ annotation_type: 'correction', payload: { field: 'output', suggestion: 'PONG' } }),
    });
    expect(annotation.response.status).toBe(201);
    expect(annotation.body.data.record_version_id).toBe(created.body.data.current_version_id);
    const resolvedAnnotation = await request(
      `/api/v1/records/${recordId}/annotations/${annotation.body.data.id}/resolve`,
      { method: 'POST', headers },
    );
    expect(resolvedAnnotation.response.status).toBe(200);
    expect(resolvedAnnotation.body.data.status).toBe('resolved');

    const invalidEvaluation = await request(`/api/v1/records/${recordId}/evaluations`, {
      method: 'POST', headers,
      body: JSON.stringify({ metric: 'correctness', score: 1.1, verdict: 'pass' }),
    });
    expect(invalidEvaluation.response.status).toBe(400);
    const evaluation = await request(`/api/v1/records/${recordId}/evaluations`, {
      method: 'POST', headers,
      body: JSON.stringify({ metric: 'correctness', score: 0.95, verdict: 'pass', notes: 'Verified fixture' }),
    });
    expect(evaluation.response.status).toBe(201);
    expect(evaluation.body.data.score).toBe(0.95);

    const submittedReview = await request(`/api/v1/records/${recordId}/submit-review`, {
      method: 'POST', headers, body: JSON.stringify({ note: 'Ready for review' }),
    });
    expect(submittedReview.response.status).toBe(201);
    const duplicateReview = await request(`/api/v1/records/${recordId}/submit-review`, {
      method: 'POST', headers, body: '{}',
    });
    expect(duplicateReview.response.status).toBe(409);
    const blockedUpdate = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ expected_version: 1, title: 'Must wait for review' }),
    });
    expect(blockedUpdate.response.status).toBe(409);
    expect(blockedUpdate.body.error.code).toBe('RECORD_PENDING_REVIEW');
    const blockedDelete = await request(`/api/v1/records/${recordId}`, { method: 'DELETE', headers });
    expect(blockedDelete.response.status).toBe(409);
    expect(blockedDelete.body.error.code).toBe('RECORD_PENDING_REVIEW');
    const reviewQueue = await request('/api/v1/review-queue', { headers });
    expect(reviewQueue.response.status).toBe(200);
    expect(reviewQueue.body.data.some((review) => review.id === submittedReview.body.data.id)).toBe(true);
    const approvedReview = await request(
      `/api/v1/records/${recordId}/reviews/${submittedReview.body.data.id}/decision`,
      { method: 'POST', headers, body: JSON.stringify({ decision: 'approved', note: 'Accepted' }) },
    );
    expect(approvedReview.response.status).toBe(200);
    expect(approvedReview.body.data.status).toBe('approved');
    const directlyReapproved = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ expected_version: 1, status: 'approved', title: 'Bypass review' }),
    });
    expect(directlyReapproved.response.status).toBe(422);
    expect(directlyReapproved.body.error.code).toBe('REVIEW_STATUS_REQUIRED');
    const revisedAfterApproval = await request(`/api/v1/records/${recordId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        expected_version: 1,
        content: { instruction: 'ping', output: 'PONG' },
        change_summary: 'Correct approved content',
      }),
    });
    expect(revisedAfterApproval.response.status).toBe(200);
    expect(revisedAfterApproval.body.data.status).toBe('draft');
    expect(revisedAfterApproval.body.data.current_version.version_number).toBe(2);
    expect(revisedAfterApproval.body.data.current_version_id).not.toBe(submittedReview.body.data.record_version_id);
    const reviewHistory = await request(`/api/v1/records/${recordId}/reviews`, { headers });
    expect(reviewHistory.response.status).toBe(200);
    expect(reviewHistory.body.data[0].reviewed_by).toBe(login.body.data.user.id);
    const reviewAuditFilter = await request('/api/v1/audit-logs?action=submit_review&limit=20', { headers });
    expect(reviewAuditFilter.response.status).toBe(200);
    expect(reviewAuditFilter.body.data.some((entry) => entry.resource_id === recordId)).toBe(true);

    const audit = await request(`/api/v1/audit-logs?resource_type=record&resource_id=${recordId}`, { headers });
    expect(new Set(audit.body.data.map((entry) => entry.action))).toEqual(new Set(['create', 'submit_review', 'approve', 'update']));
  });
}, 30_000);
