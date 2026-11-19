CREATE TABLE "dataset"."snapshot_bundle_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"object_key" text,
	"sha256" text,
	"size_bytes" bigint,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "dataset"."snapshot_bundle_jobs" ADD CONSTRAINT "snapshot_bundle_jobs_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "dataset"."dataset_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_bundle_jobs_snapshot_unique" ON "dataset"."snapshot_bundle_jobs" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "snapshot_bundle_jobs_queue_idx" ON "dataset"."snapshot_bundle_jobs" USING btree ("next_attempt_at") WHERE "dataset"."snapshot_bundle_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "snapshot_bundle_jobs_lease_idx" ON "dataset"."snapshot_bundle_jobs" USING btree ("lease_expires_at") WHERE "dataset"."snapshot_bundle_jobs"."status" = 'processing';