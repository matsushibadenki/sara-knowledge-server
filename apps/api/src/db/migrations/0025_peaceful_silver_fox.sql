DROP INDEX "dataset"."export_jobs_queued_idx";--> statement-breakpoint
DROP INDEX "dataset"."import_jobs_running_idx";--> statement-breakpoint
DROP INDEX "memory"."memory_event_jobs_queued_idx";--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "claim_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "claim_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD COLUMN "claim_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "dataset"."export_jobs" SET "lease_expires_at" = now() WHERE "status" = 'processing';--> statement-breakpoint
UPDATE "dataset"."import_jobs" SET "lease_expires_at" = now() WHERE "mode" = 'async' AND "status" = 'processing';--> statement-breakpoint
UPDATE "memory"."event_ingestion_jobs" SET "lease_expires_at" = now() WHERE "status" = 'processing';--> statement-breakpoint
CREATE INDEX "export_jobs_queued_idx" ON "dataset"."export_jobs" USING btree ("next_attempt_at","created_at") WHERE "dataset"."export_jobs"."status" IN ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "import_jobs_running_idx" ON "dataset"."import_jobs" USING btree ("next_attempt_at","created_at") WHERE "dataset"."import_jobs"."status" IN ('queued', 'running', 'processing');--> statement-breakpoint
CREATE INDEX "memory_event_jobs_queued_idx" ON "memory"."event_ingestion_jobs" USING btree ("next_attempt_at","created_at") WHERE "memory"."event_ingestion_jobs"."status" IN ('queued', 'processing');--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD CONSTRAINT "export_jobs_attempts_check" CHECK ("dataset"."export_jobs"."claim_generation" >= 0 AND "dataset"."export_jobs"."attempt_count" >= 0 AND "dataset"."export_jobs"."max_attempts" BETWEEN 1 AND 100 AND "dataset"."export_jobs"."attempt_count" <= "dataset"."export_jobs"."max_attempts");--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD CONSTRAINT "import_jobs_attempts_check" CHECK ("dataset"."import_jobs"."claim_generation" >= 0 AND "dataset"."import_jobs"."attempt_count" >= 0 AND "dataset"."import_jobs"."max_attempts" BETWEEN 1 AND 100 AND "dataset"."import_jobs"."attempt_count" <= "dataset"."import_jobs"."max_attempts");--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_jobs" ADD CONSTRAINT "memory_event_jobs_attempts_check" CHECK ("memory"."event_ingestion_jobs"."claim_generation" >= 0 AND "memory"."event_ingestion_jobs"."attempt_count" >= 0 AND "memory"."event_ingestion_jobs"."max_attempts" BETWEEN 1 AND 100 AND "memory"."event_ingestion_jobs"."attempt_count" <= "memory"."event_ingestion_jobs"."max_attempts");
