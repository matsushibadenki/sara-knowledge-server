CREATE SCHEMA "training";
--> statement-breakpoint
CREATE TABLE "training"."metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"epoch" double precision,
	"metric_name" text NOT NULL,
	"metric_value" double precision NOT NULL,
	"split" text DEFAULT 'custom' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_metrics_step_check" CHECK ("training"."metrics"."step" >= 0),
	CONSTRAINT "training_metrics_epoch_check" CHECK ("training"."metrics"."epoch" IS NULL OR "training"."metrics"."epoch" >= 0),
	CONSTRAINT "training_metrics_value_check" CHECK ("training"."metrics"."metric_value" = "training"."metrics"."metric_value"),
	CONSTRAINT "training_metrics_split_check" CHECK ("training"."metrics"."split" IN ('train', 'validation', 'test', 'holdout', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "training"."models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"model_family" text,
	"model_version" text,
	"base_model" text,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training"."runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_uid" text NOT NULL,
	"model_id" uuid NOT NULL,
	"dataset_snapshot_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"task_type" text NOT NULL,
	"transformer" jsonb NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"environment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"code_revision" text,
	"seed" integer,
	"output_object_key" text,
	"error_message" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "training_runs_status_check" CHECK ("training"."runs"."status" IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "training_runs_seed_check" CHECK ("training"."runs"."seed" IS NULL OR "training"."runs"."seed" >= 0),
	CONSTRAINT "training_runs_lifecycle_check" CHECK (("training"."runs"."status" = 'queued' AND "training"."runs"."started_at" IS NULL AND "training"."runs"."finished_at" IS NULL)
      OR ("training"."runs"."status" = 'running' AND "training"."runs"."started_at" IS NOT NULL AND "training"."runs"."finished_at" IS NULL)
      OR ("training"."runs"."status" IN ('completed', 'failed') AND "training"."runs"."started_at" IS NOT NULL AND "training"."runs"."finished_at" IS NOT NULL)
      OR ("training"."runs"."status" = 'cancelled' AND "training"."runs"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "training"."metrics" ADD CONSTRAINT "metrics_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "training"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."models" ADD CONSTRAINT "models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."runs" ADD CONSTRAINT "runs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "training"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."runs" ADD CONSTRAINT "runs_dataset_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("dataset_snapshot_id") REFERENCES "dataset"."dataset_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."runs" ADD CONSTRAINT "runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_metrics_run_metric_split_step_unique" ON "training"."metrics" USING btree ("run_id","metric_name","split","step");--> statement-breakpoint
CREATE INDEX "training_metrics_run_timeline_idx" ON "training"."metrics" USING btree ("run_id","recorded_at");--> statement-breakpoint
CREATE INDEX "training_metrics_name_timeline_idx" ON "training"."metrics" USING btree ("metric_name","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "training_models_creator_name_unique" ON "training"."models" USING btree ("created_by","name");--> statement-breakpoint
CREATE INDEX "training_models_creator_timeline_idx" ON "training"."models" USING btree ("created_by","updated_at");--> statement-breakpoint
CREATE INDEX "training_models_active_idx" ON "training"."models" USING btree ("updated_at") WHERE "training"."models"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "training_runs_creator_uid_unique" ON "training"."runs" USING btree ("created_by","run_uid");--> statement-breakpoint
CREATE INDEX "training_runs_creator_timeline_idx" ON "training"."runs" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "training_runs_model_timeline_idx" ON "training"."runs" USING btree ("model_id","created_at");--> statement-breakpoint
CREATE INDEX "training_runs_snapshot_timeline_idx" ON "training"."runs" USING btree ("dataset_snapshot_id","created_at");--> statement-breakpoint
CREATE INDEX "training_runs_active_queue_idx" ON "training"."runs" USING btree ("created_at") WHERE "training"."runs"."status" IN ('queued', 'running');