CREATE TABLE "dataset"."dataset_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manifest_format" text DEFAULT 'json' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dataset_definitions_manifest_format_check" CHECK ("dataset"."dataset_definitions"."manifest_format" IN ('json', 'jsonl'))
);
--> statement-breakpoint
CREATE TABLE "dataset"."dataset_snapshot_records" (
	"snapshot_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"record_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_snapshot_records_snapshot_id_record_id_pk" PRIMARY KEY("snapshot_id","record_id"),
	CONSTRAINT "dataset_snapshot_records_ordinal_check" CHECK ("dataset"."dataset_snapshot_records"."ordinal" > 0)
);
--> statement-breakpoint
CREATE TABLE "dataset"."dataset_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"definition_revision" timestamp with time zone NOT NULL,
	"filters" jsonb NOT NULL,
	"manifest_format" text NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"manifest_object_key" text,
	"manifest_hash" text,
	"error_message" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "dataset_snapshots_status_check" CHECK ("dataset"."dataset_snapshots"."status" IN ('building', 'completed', 'failed')),
	CONSTRAINT "dataset_snapshots_format_check" CHECK ("dataset"."dataset_snapshots"."manifest_format" IN ('json', 'jsonl')),
	CONSTRAINT "dataset_snapshots_record_count_check" CHECK ("dataset"."dataset_snapshots"."record_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dataset"."dataset_definitions" ADD CONSTRAINT "dataset_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."dataset_snapshot_records" ADD CONSTRAINT "dataset_snapshot_records_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "dataset"."dataset_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."dataset_snapshot_records" ADD CONSTRAINT "dataset_snapshot_records_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "dataset"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."dataset_snapshot_records" ADD CONSTRAINT "dataset_snapshot_records_record_version_id_record_versions_id_fk" FOREIGN KEY ("record_version_id") REFERENCES "dataset"."record_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_definition_id_dataset_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "dataset"."dataset_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."dataset_snapshots" ADD CONSTRAINT "dataset_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_definitions_creator_name_unique" ON "dataset"."dataset_definitions" USING btree ("created_by","name");--> statement-breakpoint
CREATE INDEX "dataset_definitions_creator_timeline_idx" ON "dataset"."dataset_definitions" USING btree ("created_by","updated_at");--> statement-breakpoint
CREATE INDEX "dataset_definitions_active_idx" ON "dataset"."dataset_definitions" USING btree ("updated_at") WHERE "dataset"."dataset_definitions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_snapshot_records_snapshot_ordinal_unique" ON "dataset"."dataset_snapshot_records" USING btree ("snapshot_id","ordinal");--> statement-breakpoint
CREATE INDEX "dataset_snapshot_records_record_id_idx" ON "dataset"."dataset_snapshot_records" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "dataset_snapshot_records_version_id_idx" ON "dataset"."dataset_snapshot_records" USING btree ("record_version_id");--> statement-breakpoint
CREATE INDEX "dataset_snapshots_definition_timeline_idx" ON "dataset"."dataset_snapshots" USING btree ("definition_id","created_at");--> statement-breakpoint
CREATE INDEX "dataset_snapshots_created_by_idx" ON "dataset"."dataset_snapshots" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "dataset_snapshots_building_idx" ON "dataset"."dataset_snapshots" USING btree ("created_at") WHERE "dataset"."dataset_snapshots"."status" = 'building';