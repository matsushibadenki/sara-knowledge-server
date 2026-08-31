CREATE TABLE "dataset"."export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_jobs_format_check" CHECK ("dataset"."export_jobs"."format" IN ('json', 'jsonl', 'csv')),
	CONSTRAINT "export_jobs_status_check" CHECK ("dataset"."export_jobs"."status" IN ('completed', 'failed')),
	CONSTRAINT "export_jobs_counts_check" CHECK ("dataset"."export_jobs"."record_count" >= 0 AND "dataset"."export_jobs"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dataset"."import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"status" text NOT NULL,
	"record_id" uuid,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_items_status_check" CHECK ("dataset"."import_items"."status" IN ('succeeded', 'failed')),
	CONSTRAINT "import_items_row_number_check" CHECK ("dataset"."import_items"."row_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "dataset"."import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"idempotency_key" text NOT NULL,
	"file_name" text,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"raw_content" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"succeeded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"source_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "import_jobs_format_check" CHECK ("dataset"."import_jobs"."format" IN ('json', 'jsonl', 'csv')),
	CONSTRAINT "import_jobs_status_check" CHECK ("dataset"."import_jobs"."status" IN ('running', 'completed', 'completed_with_errors', 'failed')),
	CONSTRAINT "import_jobs_counts_check" CHECK ("dataset"."import_jobs"."total_count" >= 0 AND "dataset"."import_jobs"."succeeded_count" >= 0 AND "dataset"."import_jobs"."failed_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dataset"."export_jobs" ADD CONSTRAINT "export_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."import_items" ADD CONSTRAINT "import_items_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "dataset"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."import_items" ADD CONSTRAINT "import_items_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "dataset"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD CONSTRAINT "import_jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "dataset"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_creator_timeline_idx" ON "dataset"."export_jobs" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_items_job_row_unique" ON "dataset"."import_items" USING btree ("import_job_id","row_number");--> statement-breakpoint
CREATE INDEX "import_items_record_id_idx" ON "dataset"."import_items" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_creator_idempotency_unique" ON "dataset"."import_jobs" USING btree ("created_by","idempotency_key");--> statement-breakpoint
CREATE INDEX "import_jobs_creator_timeline_idx" ON "dataset"."import_jobs" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_source_id_idx" ON "dataset"."import_jobs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "import_jobs_running_idx" ON "dataset"."import_jobs" USING btree ("created_at") WHERE "dataset"."import_jobs"."status" = 'running';