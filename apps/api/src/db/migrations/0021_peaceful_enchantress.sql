CREATE TABLE "memory"."event_ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_uid" text NOT NULL,
	"content_hash" text NOT NULL,
	"object_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"event_count" integer NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"worker_id" text,
	"ingestion_batch_id" uuid,
	"error_message" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "memory_event_jobs_status_check" CHECK ("memory"."event_ingestion_jobs"."status" IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "memory_event_jobs_counts_check" CHECK ("memory"."event_ingestion_jobs"."event_count" BETWEEN 501 AND 10000 AND "memory"."event_ingestion_jobs"."processed_count" BETWEEN 0 AND "memory"."event_ingestion_jobs"."event_count")
);
--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_batches" DROP CONSTRAINT "memory_event_batches_event_count_check";--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD CONSTRAINT "event_ingestion_jobs_ingestion_batch_id_event_ingestion_batches_id_fk" FOREIGN KEY ("ingestion_batch_id") REFERENCES "memory"."event_ingestion_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD CONSTRAINT "event_ingestion_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_event_jobs_creator_batch_unique" ON "memory"."event_ingestion_jobs" USING btree ("created_by","batch_uid");--> statement-breakpoint
CREATE INDEX "memory_event_jobs_creator_timeline_idx" ON "memory"."event_ingestion_jobs" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "memory_event_jobs_queued_idx" ON "memory"."event_ingestion_jobs" USING btree ("created_at") WHERE "memory"."event_ingestion_jobs"."status" IN ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "memory_event_jobs_ingestion_batch_id_idx" ON "memory"."event_ingestion_jobs" USING btree ("ingestion_batch_id");--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_batches" ADD CONSTRAINT "memory_event_batches_event_count_check" CHECK ("memory"."event_ingestion_batches"."event_count" BETWEEN 1 AND 10000);