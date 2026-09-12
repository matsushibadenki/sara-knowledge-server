DROP INDEX "dataset"."export_jobs_queued_idx";--> statement-breakpoint
DROP INDEX "dataset"."import_jobs_running_idx";--> statement-breakpoint
DROP INDEX "memory"."memory_event_jobs_queued_idx";--> statement-breakpoint
CREATE INDEX "export_jobs_expired_lease_idx" ON "dataset"."export_jobs" USING btree ("lease_expires_at") WHERE "dataset"."export_jobs"."mode" = 'async' AND "dataset"."export_jobs"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "import_jobs_expired_lease_idx" ON "dataset"."import_jobs" USING btree ("lease_expires_at") WHERE "dataset"."import_jobs"."mode" = 'async' AND "dataset"."import_jobs"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "memory_event_jobs_expired_lease_idx" ON "memory"."event_ingestion_jobs" USING btree ("lease_expires_at") WHERE "memory"."event_ingestion_jobs"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "export_jobs_queued_idx" ON "dataset"."export_jobs" USING btree ("next_attempt_at","created_at") WHERE "dataset"."export_jobs"."mode" = 'async' AND "dataset"."export_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "import_jobs_running_idx" ON "dataset"."import_jobs" USING btree ("next_attempt_at","created_at") WHERE "dataset"."import_jobs"."mode" = 'async' AND "dataset"."import_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "memory_event_jobs_queued_idx" ON "memory"."event_ingestion_jobs" USING btree ("next_attempt_at","created_at") WHERE "memory"."event_ingestion_jobs"."status" = 'queued';