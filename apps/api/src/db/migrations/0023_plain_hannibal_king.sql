CREATE TABLE "auth"."workspace_memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_memberships_role_check" CHECK ("auth"."workspace_memberships"."role" IN ('admin', 'editor', 'reviewer', 'viewer', 'service')),
	CONSTRAINT "workspace_memberships_status_check" CHECK ("auth"."workspace_memberships"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "auth"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_key" text DEFAULT 'server' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspaces_scope_key_unique" UNIQUE("scope_key"),
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_scope_key_check" CHECK ("auth"."workspaces"."scope_key" = 'server'),
	CONSTRAINT "workspaces_status_check" CHECK ("auth"."workspaces"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "auth"."workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "auth"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_status_idx" ON "auth"."workspace_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "workspaces_created_by_idx" ON "auth"."workspaces" USING btree ("created_by");--> statement-breakpoint
INSERT INTO "auth"."workspaces" ("id", "scope_key", "slug", "name", "status", "created_by")
SELECT
	'00000000-0000-4000-8000-000000000001'::uuid,
	'server',
	'default',
	'SARA Workspace',
	'active',
	(SELECT "id" FROM "auth"."users" WHERE "role" = 'admin' AND "status" = 'active' ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
INSERT INTO "auth"."workspace_memberships" ("workspace_id", "user_id", "role", "status")
SELECT
	'00000000-0000-4000-8000-000000000001'::uuid,
	"id",
	"role",
	CASE WHEN "status" = 'active' THEN 'active' ELSE 'suspended' END
FROM "auth"."users";
