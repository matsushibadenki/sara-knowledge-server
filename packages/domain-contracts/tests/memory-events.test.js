import { expect, test } from 'bun:test';
import { memoryEventAsyncSchema, memoryEventSchema, memoryEventValues } from '../src/memory-events.js';

const event = {
  event_uid: 'event-1',
  occurred_at: '2026-09-08T00:00:00.000Z',
  modality: 'text',
  event_type: 'observation',
  proposal_source: 'integration',
};

test('memory Event contract applies identical defaults before API or Worker persistence', () => {
  const parsed = memoryEventSchema.parse(event);
  expect(parsed.occurred_at).toBeInstanceOf(Date);
  expect(parsed.verification_state).toBe('unverified');
  expect(memoryEventValues(parsed)).toMatchObject({
    eventUid: 'event-1', confidence: 1, qualityScore: 0.5,
    verificationState: 'unverified', payload: {}, metadata: {},
  });
});

test('memory Event contract rejects pre-verified writes and undersized async batches', () => {
  expect(memoryEventSchema.safeParse({ ...event, verification_state: 'verified' }).success).toBe(false);
  expect(memoryEventAsyncSchema.safeParse({ batch_uid: 'batch-1', events: [event] }).success).toBe(false);
});
