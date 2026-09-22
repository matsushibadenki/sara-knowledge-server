ALTER TABLE "dataset"."assets" ADD COLUMN "staging_object_key" text;--> statement-breakpoint
UPDATE "dataset"."assets" SET "staging_object_key" = "object_key", "object_key" = "object_key" || '.final' WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "dataset"."assets" ADD CONSTRAINT "assets_staging_object_key_unique" UNIQUE("staging_object_key");
