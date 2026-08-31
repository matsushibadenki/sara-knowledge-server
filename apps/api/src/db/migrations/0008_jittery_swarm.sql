CREATE TABLE "dataset"."annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"record_version_id" uuid NOT NULL,
	"annotation_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "annotations_type_check" CHECK ("dataset"."annotations"."annotation_type" IN ('comment', 'correction', 'label', 'entity', 'relation')),
	CONSTRAINT "annotations_status_check" CHECK ("dataset"."annotations"."status" IN ('active', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "dataset"."evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"record_version_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"score" double precision,
	"verdict" text NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_score_check" CHECK ("dataset"."evaluations"."score" IS NULL OR ("dataset"."evaluations"."score" >= 0 AND "dataset"."evaluations"."score" <= 1)),
	CONSTRAINT "evaluations_verdict_check" CHECK ("dataset"."evaluations"."verdict" IN ('pass', 'fail', 'needs_review'))
);
--> statement-breakpoint
CREATE TABLE "dataset"."record_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"record_version_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid,
	"reviewed_by" uuid,
	"submission_note" text,
	"decision_note" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "record_reviews_status_check" CHECK ("dataset"."record_reviews"."status" IN ('pending', 'approved', 'rejected', 'changes_requested'))
);
--> statement-breakpoint
CREATE TABLE "dataset"."record_tags" (
	"record_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_tags_record_id_tag_id_pk" PRIMARY KEY("record_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "dataset"."tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system"."audit_logs" DROP CONSTRAINT "audit_logs_action_check";--> statement-breakpoint
ALTER TABLE "dataset"."annotations" ADD CONSTRAINT "annotations_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "dataset"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."annotations" ADD CONSTRAINT "annotations_record_version_id_record_versions_id_fk" FOREIGN KEY ("record_version_id") REFERENCES "dataset"."record_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."annotations" ADD CONSTRAINT "annotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."annotations" ADD CONSTRAINT "annotations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."evaluations" ADD CONSTRAINT "evaluations_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "dataset"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."evaluations" ADD CONSTRAINT "evaluations_record_version_id_record_versions_id_fk" FOREIGN KEY ("record_version_id") REFERENCES "dataset"."record_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."evaluations" ADD CONSTRAINT "evaluations_evaluated_by_users_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."record_reviews" ADD CONSTRAINT "record_reviews_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "dataset"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."record_reviews" ADD CONSTRAINT "record_reviews_record_version_id_record_versions_id_fk" FOREIGN KEY ("record_version_id") REFERENCES "dataset"."record_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."record_reviews" ADD CONSTRAINT "record_reviews_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."record_reviews" ADD CONSTRAINT "record_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."record_tags" ADD CONSTRAINT "record_tags_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "dataset"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."record_tags" ADD CONSTRAINT "record_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "dataset"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."record_tags" ADD CONSTRAINT "record_tags_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_record_timeline_idx" ON "dataset"."annotations" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "annotations_record_version_id_idx" ON "dataset"."annotations" USING btree ("record_version_id");--> statement-breakpoint
CREATE INDEX "annotations_created_by_idx" ON "dataset"."annotations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "annotations_unresolved_idx" ON "dataset"."annotations" USING btree ("record_id","created_at") WHERE "dataset"."annotations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "evaluations_record_timeline_idx" ON "dataset"."evaluations" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "evaluations_record_version_id_idx" ON "dataset"."evaluations" USING btree ("record_version_id");--> statement-breakpoint
CREATE INDEX "evaluations_evaluated_by_idx" ON "dataset"."evaluations" USING btree ("evaluated_by");--> statement-breakpoint
CREATE INDEX "evaluations_metric_timeline_idx" ON "dataset"."evaluations" USING btree ("metric","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "record_reviews_one_pending_per_record_unique" ON "dataset"."record_reviews" USING btree ("record_id") WHERE "dataset"."record_reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "record_reviews_pending_queue_idx" ON "dataset"."record_reviews" USING btree ("submitted_at","id") WHERE "dataset"."record_reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "record_reviews_record_version_id_idx" ON "dataset"."record_reviews" USING btree ("record_version_id");--> statement-breakpoint
CREATE INDEX "record_reviews_submitted_by_idx" ON "dataset"."record_reviews" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "record_reviews_reviewed_by_idx" ON "dataset"."record_reviews" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "record_tags_tag_id_idx" ON "dataset"."record_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "record_tags_assigned_by_idx" ON "dataset"."record_tags" USING btree ("assigned_by");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_normalized_name_unique" ON "dataset"."tags" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "tags_created_by_idx" ON "dataset"."tags" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "system"."audit_logs" ADD CONSTRAINT "audit_logs_action_check" CHECK ("system"."audit_logs"."action" IN ('create', 'update', 'delete', 'restore', 'submit_review', 'approve', 'reject', 'request_changes'));