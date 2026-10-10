import { expect, test } from 'bun:test';
import { withWorkspaceFixture } from './support/workspace-fixture.js';
const integrationTest = process.env.RUN_INTEGRATION === '1' ? test : test.skip;

integrationTest('Memory graph bounds, evidence and verification revisions remain consistent', async () => {
  await withWorkspaceFixture(async ({ request, headers, roleHeaders }) => {
    const source = await request('/api/v1/sources', { method: 'POST', headers, body: JSON.stringify({ source_type: 'manual', title: 'Independent Memory source' }) });
    expect(source.response.status).toBe(201);
    const sourceId = source.body.data.id;
    const editorHeaders = await roleHeaders('editor');
    const viewerHeaders = await roleHeaders('viewer');
    const createdRecord = await request('/api/v1/records', { method: 'POST', headers, body: JSON.stringify({ record_type: 'plain_text', source_id: sourceId, content: { text: 'Memory reference fixture' } }) });
    expect(createdRecord.response.status).toBe(201);
    const recordId = createdRecord.body.data.id;
    const experience = await request('/api/v1/memory/experiences', {
      method: 'POST', headers,
      body: JSON.stringify({
        experience_uid: `experience-${crypto.randomUUID()}`, source_id: sourceId,
        title: 'Bell and meal observation', state_before: { hungry: true },
        event_summary: { event_count: 1 }, state_after: { food_available: true },
        reward: 0.2, prediction_error: 0.8, quality_score: 0.9,
        curriculum_level: 'observation', metadata: { session: 'integration' },
      }),
    });
    expect(experience.response.status).toBe(201);
    expect(experience.body.data.source_id).toBe(sourceId);

    const eventUid = `event-${crypto.randomUUID()}`;
    const memoryEvent = await request('/api/v1/memory/events', {
      method: 'POST', headers,
      body: JSON.stringify({
        event_uid: eventUid, source_id: sourceId, experience_id: experience.body.data.id,
        occurred_at: '2026-08-31T12:00:00+09:00', sequence_time: 0, duration: 0.5,
        modality: 'audio', channel: 'microphone', event_type: 'observation', symbol: 'bell',
        payload: { amplitude: 0.7 }, reward: 0.2, prediction_error: 0.8,
        confidence: 0.7, quality_score: 0.8, proposal_source: 'llm',
        extractor_name: 'integration-extractor', extractor_version: '1.0',
        verification_state: 'candidate', novelty: 0.6,
      }),
    });
    expect(memoryEvent.response.status).toBe(201);
    expect(memoryEvent.body.data.verification_state).toBe('candidate');
    const duplicateEvent = await request('/api/v1/memory/events', {
      method: 'POST', headers,
      body: JSON.stringify({ event_uid: eventUid, modality: 'audio', event_type: 'observation', proposal_source: 'human' }),
    });
    expect(duplicateEvent.response.status).toBe(409);

    const invalidSourceEntity = await request('/api/v1/memory/entities', {
      method: 'POST', headers,
      body: JSON.stringify({ entity_uid: `invalid-${crypto.randomUUID()}`, entity_type: 'object', proposal_source: 'human', source_id: crypto.randomUUID() }),
    });
    expect(invalidSourceEntity.response.status).toBe(404);
    expect(invalidSourceEntity.body.error.code).toBe('SOURCE_NOT_FOUND');

    const entity = await request('/api/v1/memory/entities', {
      method: 'POST', headers,
      body: JSON.stringify({
        entity_uid: `entity-${crypto.randomUUID()}`, entity_type: 'object', canonical_name: 'bell',
        properties: { material: 'metal' }, confidence: 0.95,
        verification_state: 'candidate', proposal_source: 'human', source_id: sourceId,
      }),
    });
    expect(entity.response.status).toBe(201);

    const editorEntity = await request('/api/v1/memory/entities', {
      method: 'POST', headers: editorHeaders,
      body: JSON.stringify({
        entity_uid: `editor-entity-${crypto.randomUUID()}`,
        entity_type: 'document', canonical_name: 'shared record reference',
        proposal_source: 'human', source_id: sourceId,
      }),
    });
    expect(editorEntity.response.status).toBe(201);

    const editorRecordRelation = await request('/api/v1/memory/relations', {
      method: 'POST', headers: editorHeaders,
      body: JSON.stringify({
        relation_uid: `editor-relation-${crypto.randomUUID()}`,
        source_type: 'entity', source_id: editorEntity.body.data.id,
        relation_type: 'derived_from', target_type: 'record', target_id: recordId,
        proposal_source: 'human', verification_state: 'candidate',
      }),
    });
    expect(editorRecordRelation.response.status).toBe(201);

    const editorRecordEvidence = await request(`/api/v1/memory/relations/${editorRecordRelation.body.data.id}/evidence`, {
      method: 'POST', headers: editorHeaders,
      body: JSON.stringify({
        expected_revision: editorRecordRelation.body.data.revision,
        evidence_uid: `editor-record-evidence-${crypto.randomUUID()}`,
        evidence_type: 'record', reference_type: 'record', reference_id: recordId,
        supports: true,
      }),
    });
    expect(editorRecordEvidence.response.status).toBe(201);

    const editorCanReferenceWorkspaceMemory = await request('/api/v1/memory/relations', {
      method: 'POST', headers: editorHeaders,
      body: JSON.stringify({
        relation_uid: `private-relation-${crypto.randomUUID()}`,
        source_type: 'entity', source_id: editorEntity.body.data.id,
        relation_type: 'references', target_type: 'entity', target_id: entity.body.data.id,
        proposal_source: 'human',
      }),
    });
    expect(editorCanReferenceWorkspaceMemory.response.status).toBe(201);

    const entityAlias = await request(`/api/v1/memory/entities/${entity.body.data.id}/aliases`, {
      method: 'POST', headers,
      body: JSON.stringify({
        alias: 'Ｂｅｌｌ', language_code: 'en', alias_type: 'name', confidence: 0.9,
        proposal_source: 'human', verification_state: 'candidate',
      }),
    });
    expect(entityAlias.response.status).toBe(201);
    expect(entityAlias.body.data.normalized_alias).toBe('bell');
    const duplicateAlias = await request(`/api/v1/memory/entities/${entity.body.data.id}/aliases`, {
      method: 'POST', headers,
      body: JSON.stringify({ alias: ' bell ', language_code: 'EN', proposal_source: 'human' }),
    });
    expect(duplicateAlias.response.status).toBe(409);

    const concept = await request('/api/v1/memory/concepts', {
      method: 'POST', headers,
      body: JSON.stringify({
        concept_uid: `concept-${crypto.randomUUID()}`, concept_type: 'prediction', label: 'bell predicts meal',
        evidence_count: 1, contradiction_count: 0, verification_state: 'candidate',
        proposal_source: 'rule', utility_score: 0.4, event_pattern: { sequence: ['bell', 'meal'] },
        source_id: sourceId,
      }),
    });
    expect(concept.response.status).toBe(201);

    const invalidRelation = await request('/api/v1/memory/relations', {
      method: 'POST', headers,
      body: JSON.stringify({
        relation_uid: `invalid-relation-${crypto.randomUUID()}`,
        source_type: 'entity', source_id: entity.body.data.id, relation_type: 'predicts',
        target_type: 'concept', target_id: crypto.randomUUID(), proposal_source: 'rule',
      }),
    });
    expect(invalidRelation.response.status).toBe(404);
    expect(invalidRelation.body.error.code).toBe('TARGET_NODE_NOT_FOUND');

    const relation = await request('/api/v1/memory/relations', {
      method: 'POST', headers,
      body: JSON.stringify({
        relation_uid: `relation-${crypto.randomUUID()}`,
        source_type: 'entity', source_id: entity.body.data.id, relation_type: 'associated_with',
        target_type: 'concept', target_id: concept.body.data.id,
        strength: 0.75, confidence: 0.65, evidence_count: 1,
        min_delay_ms: 100, max_delay_ms: 2000, verification_state: 'candidate',
        proposal_source: 'rule', context: { environment: 'lab' },
      }),
    });
    expect(relation.response.status).toBe(201);
    expect(relation.body.data.source_id).toBe(entity.body.data.id);

    const predictionEvent = await request('/api/v1/memory/events', {
      method: 'POST', headers,
      body: JSON.stringify({ event_uid: `prediction-${crypto.randomUUID()}`, source_id: sourceId,
        modality: 'state', event_type: 'observation', proposal_source: 'rule' }),
    });
    expect(predictionEvent.response.status).toBe(201);
    const predictionRelation = await request('/api/v1/memory/relations', {
      method: 'POST', headers,
      body: JSON.stringify({
        relation_uid: `relation-${crypto.randomUUID()}`,
        source_type: 'concept', source_id: concept.body.data.id, relation_type: 'predicts',
        target_type: 'event', target_id: predictionEvent.body.data.id,
        strength: 0.7, confidence: 0.8, verification_state: 'candidate',
        proposal_source: 'rule', context: { environment: 'lab' },
      }),
    });
    expect(predictionRelation.response.status).toBe(201);

    const traversal = await request('/api/v1/memory/traverse', {
      method: 'POST', headers,
      body: JSON.stringify({
        start_nodes: [{ type: 'entity', id: entity.body.data.id }],
        relation_types: ['associated_with', 'predicts'], direction: 'outgoing',
        max_depth: 2, max_nodes: 10, max_edges: 10,
      }),
    });
    expect(traversal.response.status).toBe(200);
    expect(traversal.body.data.nodes).toHaveLength(3);
    expect(traversal.body.data.relations).toHaveLength(2);
    expect(traversal.body.meta.depth_reached).toBe(2);

    const shallowTraversal = await request('/api/v1/memory/traverse', {
      method: 'POST', headers,
      body: JSON.stringify({
        start_nodes: [{ type: 'entity', id: entity.body.data.id }],
        direction: 'outgoing', max_depth: 1, max_nodes: 10, max_edges: 10,
      }),
    });
    expect(shallowTraversal.response.status).toBe(200);
    expect(shallowTraversal.body.data.nodes).toHaveLength(2);
    expect(shallowTraversal.body.data.relations).toHaveLength(1);

    const filteredTraversal = await request('/api/v1/memory/traverse', {
      method: 'POST', headers,
      body: JSON.stringify({
        start_nodes: [{ type: 'entity', id: entity.body.data.id }],
        relation_types: ['not_present'], max_depth: 2, max_nodes: 10, max_edges: 10,
      }),
    });
    expect(filteredTraversal.response.status).toBe(200);
    expect(filteredTraversal.body.data.nodes).toHaveLength(1);
    expect(filteredTraversal.body.data.relations).toHaveLength(0);

    const nodeLimitedTraversal = await request('/api/v1/memory/traverse', {
      method: 'POST', headers,
      body: JSON.stringify({
        start_nodes: [{ type: 'entity', id: entity.body.data.id }],
        max_depth: 2, max_nodes: 1, max_edges: 10,
      }),
    });
    expect(nodeLimitedTraversal.response.status).toBe(200);
    expect(nodeLimitedTraversal.body.data.nodes).toHaveLength(1);
    expect(nodeLimitedTraversal.body.meta.node_limit_reached).toBe(true);

    const invalidTraversalLimits = await request('/api/v1/memory/traverse', {
      method: 'POST', headers,
      body: JSON.stringify({
        start_nodes: [
          { type: 'entity', id: entity.body.data.id },
          { type: 'concept', id: concept.body.data.id },
        ],
        max_nodes: 1,
      }),
    });
    expect(invalidTraversalLimits.response.status).toBe(400);

    const supportingEvidence = await request(`/api/v1/memory/relations/${relation.body.data.id}/evidence`, {
      method: 'POST', headers,
      body: JSON.stringify({
        expected_revision: relation.body.data.revision,
        evidence_uid: `evidence-${crypto.randomUUID()}`, evidence_type: 'observation',
        reference_type: 'event', reference_id: memoryEvent.body.data.id,
        supports: true, weight: 1.2, details: { note: 'Bell observation supports association' },
      }),
    });
    expect(supportingEvidence.response.status).toBe(201);
    expect(supportingEvidence.body.data.relation.evidence_count).toBe(2);
    const duplicateEvidence = await request(`/api/v1/memory/relations/${relation.body.data.id}/evidence`, {
      method: 'POST', headers,
      body: JSON.stringify({
        expected_revision: supportingEvidence.body.data.relation.revision,
        evidence_uid: supportingEvidence.body.data.evidence.evidence_uid,
        evidence_type: 'observation', reference_type: 'event', reference_id: memoryEvent.body.data.id,
        supports: true,
      }),
    });
    expect(duplicateEvidence.response.status).toBe(409);
    const counterEvidence = await request(`/api/v1/memory/relations/${relation.body.data.id}/evidence`, {
      method: 'POST', headers,
      body: JSON.stringify({
        expected_revision: supportingEvidence.body.data.relation.revision,
        evidence_uid: `counter-${crypto.randomUUID()}`, evidence_type: 'external_report',
        reference_type: 'external', supports: false, weight: 0.5,
        details: { url: 'https://example.invalid/counterexample' },
      }),
    });
    expect(counterEvidence.response.status).toBe(201);
    expect(counterEvidence.body.data.relation.evidence_count).toBe(2);
    expect(counterEvidence.body.data.relation.counterexample_count).toBe(1);
    const evidenceList = await request(`/api/v1/memory/relations/${relation.body.data.id}/evidence`, { headers });
    expect(evidenceList.response.status).toBe(200);
    expect(evidenceList.body.data).toHaveLength(2);

    const neighbors = await request(`/api/v1/memory/nodes/entity/${entity.body.data.id}/neighbors`, { headers });
    expect(neighbors.response.status).toBe(200);
    expect(neighbors.body.data).toHaveLength(2);
    expect(neighbors.body.data[0].target_id).toBe(concept.body.data.id);

    const directVerificationPatch = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ expected_revision: concept.body.data.revision, verification_state: 'verified', evidence_count: 2 }),
    });
    expect(directVerificationPatch.response.status).toBe(400);
    const updatedConceptEvidence = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ expected_revision: concept.body.data.revision, evidence_count: 2 }),
    });
    expect(updatedConceptEvidence.response.status).toBe(200);
    expect(updatedConceptEvidence.body.data.revision).toBe(2);
    expect(updatedConceptEvidence.body.data.event_pattern.sequence).toEqual(['bell', 'meal']);

    const verifiedConcept = await request(`/api/v1/memory/verification/concept/${concept.body.data.id}`, {
      method: 'POST', headers,
      body: JSON.stringify({ expected_revision: updatedConceptEvidence.body.data.revision, expected_state: 'candidate', state: 'verified', notes: 'Confirmed by integration reviewer' }),
    });
    expect(verifiedConcept.response.status).toBe(200);
    expect(verifiedConcept.body.data.revision).toBe(3);
    expect(verifiedConcept.body.data.verification_state).toBe('verified');
    expect(verifiedConcept.body.data.decision.target_revision).toBe(3);
    expect(verifiedConcept.body.data.decision.target_snapshot.event_pattern.sequence).toEqual(['bell', 'meal']);
    expect(verifiedConcept.body.data.decision.target_snapshot.verification_state).toBe('verified');
    const repeatedVerification = await request(`/api/v1/memory/verification/concept/${concept.body.data.id}`, {
      method: 'POST', headers,
      body: JSON.stringify({ expected_revision: verifiedConcept.body.data.revision, expected_state: 'candidate', state: 'rejected' }),
    });
    expect(repeatedVerification.response.status).toBe(409);
    expect(repeatedVerification.body.error.code).toBe('VERIFICATION_STATE_CONFLICT');

    const revisedVerifiedConcept = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        expected_revision: verifiedConcept.body.data.revision,
        event_pattern: { sequence: ['bell', 'meal', 'salivation'] },
      }),
    });
    expect(revisedVerifiedConcept.response.status).toBe(200);
    expect(revisedVerifiedConcept.body.data.revision).toBe(4);
    expect(revisedVerifiedConcept.body.data.verification_state).toBe('candidate');

    const concurrentConceptUpdates = await Promise.all([
      request(`/api/v1/memory/concepts/${concept.body.data.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ expected_revision: 4, utility_score: 0.6 }),
      }),
      request(`/api/v1/memory/concepts/${concept.body.data.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ expected_revision: 4, utility_score: 0.7 }),
      }),
    ]);
    expect(concurrentConceptUpdates.map((result) => result.response.status).sort()).toEqual([200, 409]);
    expect(concurrentConceptUpdates.find((result) => result.response.status === 409).body.error.code).toBe('REVISION_CONFLICT');

    const verificationHistory = await request(`/api/v1/memory/verification/concept/${concept.body.data.id}`, { headers });
    expect(verificationHistory.response.status).toBe(200);
    expect(verificationHistory.body.data).toHaveLength(1);
    expect(verificationHistory.body.data[0].to_state).toBe('verified');
    expect(verificationHistory.body.data[0].target_revision).toBe(3);
    expect(verificationHistory.body.data[0].target_snapshot.event_pattern.sequence).toEqual(['bell', 'meal']);

    const viewerMemoryRead = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, { headers: viewerHeaders });
    expect(viewerMemoryRead.response.status).toBe(200);

    const referencedConceptDelete = await request(`/api/v1/memory/concepts/${concept.body.data.id}`, { method: 'DELETE', headers });
    expect(referencedConceptDelete.response.status).toBe(409);
    expect(referencedConceptDelete.body.error.code).toBe('MEMORY_NODE_IN_USE');

    const deletedEvent = await request(`/api/v1/memory/events/${memoryEvent.body.data.id}`, { method: 'DELETE', headers });
    expect(deletedEvent.response.status).toBe(200);
    expect(deletedEvent.body.data.deleted_at).not.toBeNull();
    const deletedEventRead = await request(`/api/v1/memory/events/${memoryEvent.body.data.id}`, { headers });
    expect(deletedEventRead.response.status).toBe(404);


  });
}, 30_000);

