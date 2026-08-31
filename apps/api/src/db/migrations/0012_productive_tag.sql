ALTER TABLE "dataset"."export_jobs" DROP CONSTRAINT "export_jobs_status_check";--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" DROP CONSTRAINT "import_jobs_status_check";--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" DROP CONSTRAINT "import_jobs_completed_counts_check";--> statement-breakpoint
DROP INDEX "dataset"."import_jobs_running_idx";--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ALTER COLUMN "content_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ALTER COLUMN "completed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ALTER COLUMN "completed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ALTER COLUMN "raw_content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "mode" text DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "cancel_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "mode" text DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "processed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "cancel_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_creator_idempotency_unique" ON "dataset"."export_jobs" USING btree ("created_by","idempotency_key") WHERE "dataset"."export_jobs"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "export_jobs_queued_idx" ON "dataset"."export_jobs" USING btree ("created_at") WHERE "dataset"."export_jobs"."status" IN ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "import_jobs_running_idx" ON "dataset"."import_jobs" USING btree ("created_at") WHERE "dataset"."import_jobs"."status" IN ('queued', 'running', 'processing');--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD CONSTRAINT "export_jobs_mode_check" CHECK ("dataset"."export_jobs"."mode" IN ('sync', 'async'));--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD CONSTRAINT "export_jobs_status_check" CHECK ("dataset"."export_jobs"."status" IN ('queued', 'processing', 'completed', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD CONSTRAINT "import_jobs_mode_check" CHECK ("dataset"."import_jobs"."mode" IN ('sync', 'async'));--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD CONSTRAINT "import_jobs_status_check" CHECK ("dataset"."import_jobs"."status" IN ('queued', 'running', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD CONSTRAINT "import_jobs_completed_counts_check" CHECK ("dataset"."import_jobs"."status" IN ('queued', 'running', 'processing', 'cancelled') OR "dataset"."import_jobs"."total_count" = "dataset"."import_jobs"."succeeded_count" + "dataset"."import_jobs"."failed_count");