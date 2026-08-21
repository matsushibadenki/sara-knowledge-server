CREATE INDEX "sources_active_updated_idx" ON "dataset"."sources" USING btree ("updated_at") WHERE "dataset"."sources"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sources_source_type_idx" ON "dataset"."sources" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "sources_url_idx" ON "dataset"."sources" USING btree ("url");--> statement-breakpoint
CREATE INDEX "sources_content_hash_idx" ON "dataset"."sources" USING btree ("content_hash");--> statement-breakpoint
ALTER TABLE "dataset"."sources" ADD CONSTRAINT "sources_source_type_check" CHECK ("dataset"."sources"."source_type" IN ('manual', 'website', 'document', 'book', 'dataset', 'conversation', 'sensor', 'generated', 'imported', 'wordpress'));