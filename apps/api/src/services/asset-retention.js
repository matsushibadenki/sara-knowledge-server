import { assetDeletionJobs } from '../db/schema/index.js';

// Five-minute signed URLs plus a five-minute grace period for storage requests.
export const ASSET_URL_SECONDS = 300;
export const ASSET_URL_GRACE_SECONDS = 600;

export function assetRetentionSeconds() {
  const value = Number(process.env.ASSET_RETENTION_SECONDS ?? 86400);
  if (!Number.isSafeInteger(value) || value < ASSET_URL_GRACE_SECONDS || value > 31536000) {
    throw new Error('ASSET_RETENTION_SECONDS must be an integer between 600 and 31536000.');
  }
  return value;
}

export async function scheduleAssetDeletion(tx, asset, reason, now = new Date()) {
  const keys = reason === 'staging' ? [asset.stagingObjectKey] : [asset.objectKey, asset.stagingObjectKey];
  const due = new Date(Math.max(
    now.getTime() + (reason === 'deleted_asset' ? assetRetentionSeconds() * 1000 : 0),
    new Date(asset.createdAt).getTime() + ASSET_URL_GRACE_SECONDS * 1000,
  ));
  const maxAttempts = Math.max(1, Math.min(100, Number(process.env.JOB_MAX_ATTEMPTS || 3)));
  const rows = keys.filter(Boolean).map((objectKey) => ({
    assetId: asset.id, objectKey, bucketName: asset.bucketName,
    reason, notBefore: due, nextAttemptAt: due, maxAttempts,
  }));
  return tx.insert(assetDeletionJobs).values(rows).onConflictDoNothing({ target: assetDeletionJobs.objectKey }).returning();
}

export function serializeDeletionJob(job) {
  return {
    id: job.id, asset_id: job.assetId, reason: job.reason, status: job.status,
    not_before: job.notBefore, next_attempt_at: job.nextAttemptAt,
    attempt_count: job.attemptCount, max_attempts: job.maxAttempts,
    claim_generation: job.claimGeneration, error_message: job.errorMessage,
    created_at: job.createdAt, completed_at: job.completedAt,
  };
}
