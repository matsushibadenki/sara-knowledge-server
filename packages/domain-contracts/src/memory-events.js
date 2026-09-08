import { z } from 'zod';

const uuidSchema = z.string().uuid();
const jsonObject = z.record(z.string(), z.unknown());
const probability = z.number().finite().min(0).max(1);
const initialVerificationState = z.enum(['unverified', 'candidate']);

export const memoryEventSchema = z.object({
  event_uid: z.string().trim().min(1).max(200),
  source_id: uuidSchema.nullable().optional(),
  experience_id: uuidSchema.nullable().optional(),
  occurred_at: z.coerce.date().nullable().optional(),
  sequence_time: z.number().finite().nullable().optional(),
  duration: z.number().finite().min(0).nullable().optional(),
  modality: z.string().trim().min(1).max(100),
  channel: z.string().max(200).nullable().optional(),
  event_type: z.string().trim().min(1).max(200),
  symbol: z.string().max(500).nullable().optional(),
  payload: jsonObject.default({}),
  state_before: jsonObject.nullable().optional(),
  state_after: jsonObject.nullable().optional(),
  reward: z.number().finite().default(0),
  prediction_error: z.number().finite().default(0),
  confidence: probability.default(1),
  quality_score: probability.default(0.5),
  proposal_source: z.string().trim().min(1).max(200),
  extractor_name: z.string().max(200).nullable().optional(),
  extractor_version: z.string().max(200).nullable().optional(),
  verification_state: initialVerificationState.default('unverified'),
  source_hash: z.string().max(200).nullable().optional(),
  novelty: probability.default(0),
  priority_score: z.number().finite().default(0),
  metadata: jsonObject.default({}),
});

export const memoryEventBulkSchema = z.object({
  batch_uid: z.string().trim().min(1).max(200),
  events: z.array(memoryEventSchema).min(1).max(500),
}).strict();

export const memoryEventAsyncSchema = z.object({
  batch_uid: z.string().trim().min(1).max(200),
  events: z.array(memoryEventSchema).min(501).max(10000),
}).strict();

export function memoryEventValues(value) {
  return {
    eventUid: value.event_uid,
    sourceId: value.source_id ?? null,
    experienceId: value.experience_id ?? null,
    occurredAt: value.occurred_at ?? null,
    sequenceTime: value.sequence_time ?? null,
    duration: value.duration ?? null,
    modality: value.modality,
    channel: value.channel ?? null,
    eventType: value.event_type,
    symbol: value.symbol ?? null,
    payload: value.payload,
    stateBefore: value.state_before ?? null,
    stateAfter: value.state_after ?? null,
    reward: value.reward,
    predictionError: value.prediction_error,
    confidence: value.confidence,
    qualityScore: value.quality_score,
    proposalSource: value.proposal_source,
    extractorName: value.extractor_name ?? null,
    extractorVersion: value.extractor_version ?? null,
    verificationState: value.verification_state,
    sourceHash: value.source_hash ?? null,
    novelty: value.novelty,
    priorityScore: value.priority_score,
    metadata: value.metadata,
  };
}
