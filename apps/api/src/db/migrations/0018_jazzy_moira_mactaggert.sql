CREATE TABLE "memory"."event_ingestion_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_uid" text NOT NULL,
	"content_hash" text NOT NULL,
	"event_count" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_event_batches_event_count_check" CHECK ("memory"."event_ingestion_batches"."event_count" BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "memory"."events" ADD COLUMN "ingestion_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "memory"."event_ingestion_batches" ADD CONSTRAINT "event_ingestion_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_event_batches_creator_uid_unique" ON "memory"."event_ingestion_batches" USING btree ("created_by","batch_uid");--> statement-breakpoint
CREATE INDEX "memory_event_batches_creator_timeline_idx" ON "memory"."event_ingestion_batches" USING btree ("created_by","created_at");--> statement-breakpoint
ALTER TABLE "memory"."events" ADD CONSTRAINT "events_ingestion_batch_id_event_ingestion_batches_id_fk" FOREIGN KEY ("ingestion_batch_id") REFERENCES "memory"."event_ingestion_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_events_ingestion_batch_idx" ON "memory"."events" USING btree ("ingestion_batch_id","created_at");