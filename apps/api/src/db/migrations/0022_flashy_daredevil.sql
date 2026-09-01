CREATE TABLE "dataset"."asset_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"role" text DEFAULT 'attachment' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_bindings_target_type_check" CHECK ("dataset"."asset_bindings"."target_type" IN ('source', 'record', 'event'))
);
--> statement-breakpoint
CREATE TABLE "dataset"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_name" text NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "assets_status_check" CHECK ("dataset"."assets"."status" IN ('pending', 'ready')),
	CONSTRAINT "assets_size_check" CHECK ("dataset"."assets"."size_bytes" > 0),
	CONSTRAINT "assets_dimensions_check" CHECK (("dataset"."assets"."width" IS NULL OR "dataset"."assets"."width" > 0) AND ("dataset"."assets"."height" IS NULL OR "dataset"."assets"."height" > 0) AND ("dataset"."assets"."duration_ms" IS NULL OR "dataset"."assets"."duration_ms" >= 0))
);
--> statement-breakpoint
ALTER TABLE "dataset"."asset_bindings" ADD CONSTRAINT "asset_bindings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "dataset"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."asset_bindings" ADD CONSTRAINT "asset_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_bindings_asset_target_role_unique" ON "dataset"."asset_bindings" USING btree ("asset_id","target_type","target_id","role");--> statement-breakpoint
CREATE INDEX "asset_bindings_target_idx" ON "dataset"."asset_bindings" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "asset_bindings_created_by_idx" ON "dataset"."asset_bindings" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "assets_creator_timeline_idx" ON "dataset"."assets" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "assets_active_creator_hash_idx" ON "dataset"."assets" USING btree ("created_by","sha256") WHERE "dataset"."assets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_pending_timeline_idx" ON "dataset"."assets" USING btree ("created_at") WHERE "dataset"."assets"."status" = 'pending' AND "dataset"."assets"."deleted_at" IS NULL;