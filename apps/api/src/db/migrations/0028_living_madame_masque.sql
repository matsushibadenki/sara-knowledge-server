CREATE TABLE "dataset"."asset_deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"bucket_name" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"claim_generation" integer DEFAULT 0 NOT NULL,
	"worker_id" text,
	"heartbeat_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "asset_deletion_jobs_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "asset_deletion_jobs_reason_check" CHECK ("dataset"."asset_deletion_jobs"."reason" IN ('staging', 'deleted_asset')),
	CONSTRAINT "asset_deletion_jobs_status_check" CHECK ("dataset"."asset_deletion_jobs"."status" IN ('queued', 'processing', 'completed', 'failed')),
	CONSTRAINT "asset_deletion_jobs_attempts_check" CHECK ("dataset"."asset_deletion_jobs"."attempt_count" >= 0 AND "dataset"."asset_deletion_jobs"."max_attempts" BETWEEN 1 AND 100 AND "dataset"."asset_deletion_jobs"."attempt_count" <= "dataset"."asset_deletion_jobs"."max_attempts" AND "dataset"."asset_deletion_jobs"."claim_generation" >= 0),
	CONSTRAINT "asset_deletion_jobs_lease_check" CHECK (("dataset"."asset_deletion_jobs"."status" = 'processing') = ("dataset"."asset_deletion_jobs"."worker_id" IS NOT NULL AND "dataset"."asset_deletion_jobs"."heartbeat_at" IS NOT NULL AND "dataset"."asset_deletion_jobs"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "dataset"."asset_deletion_jobs" ADD CONSTRAINT "asset_deletion_jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "dataset"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_deletion_jobs_asset_idx" ON "dataset"."asset_deletion_jobs" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_deletion_jobs_queue_idx" ON "dataset"."asset_deletion_jobs" USING btree ("next_attempt_at","created_at") WHERE "dataset"."asset_deletion_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "asset_deletion_jobs_lease_idx" ON "dataset"."asset_deletion_jobs" USING btree ("lease_expires_at") WHERE "dataset"."asset_deletion_jobs"."status" = 'processing';
--> statement-breakpoint
-- Backfill durable requests without deleting existing metadata or bytes. Existing
-- deleted Assets receive a fresh 24-hour window; referenced originals stay protected.
INSERT INTO dataset.asset_deletion_jobs (asset_id, object_key, bucket_name, reason, not_before, next_attempt_at)
SELECT id, object_key, bucket_name, 'deleted_asset', now() + interval '24 hours', now() + interval '24 hours'
FROM dataset.assets WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
INSERT INTO dataset.asset_deletion_jobs (asset_id, object_key, bucket_name, reason, not_before, next_attempt_at)
SELECT id, staging_object_key, bucket_name, CASE WHEN deleted_at IS NULL THEN 'staging' ELSE 'deleted_asset' END,
  now() + CASE WHEN deleted_at IS NULL THEN interval '10 minutes' ELSE interval '24 hours' END,
  now() + CASE WHEN deleted_at IS NULL THEN interval '10 minutes' ELSE interval '24 hours' END
FROM dataset.assets WHERE staging_object_key IS NOT NULL AND (status = 'ready' OR deleted_at IS NOT NULL);
