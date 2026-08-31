CREATE SCHEMA "system";
--> statement-breakpoint
CREATE TABLE "system"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"request_id" text,
	"ip_address" "inet",
	"user_agent" text,
	"before_data" jsonb,
	"after_data" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_type_check" CHECK ("system"."audit_logs"."actor_type" IN ('user', 'api_key', 'system')),
	CONSTRAINT "audit_logs_action_check" CHECK ("system"."audit_logs"."action" IN ('create', 'update', 'delete', 'restore')),
	CONSTRAINT "audit_logs_resource_type_check" CHECK ("system"."audit_logs"."resource_type" IN ('source', 'record'))
);
--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "system"."audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_timeline_idx" ON "system"."audit_logs" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_timeline_idx" ON "system"."audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_request_id_idx" ON "system"."audit_logs" USING btree ("request_id");