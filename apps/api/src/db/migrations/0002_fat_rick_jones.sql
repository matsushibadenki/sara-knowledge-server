ALTER TABLE "dataset"."records" ADD CONSTRAINT "records_current_version_id_record_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "dataset"."record_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "auth"."api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_active_expiry_idx" ON "auth"."api_keys" USING btree ("expires_at") WHERE "auth"."api_keys"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "record_versions_record_version_unique" ON "dataset"."record_versions" USING btree ("record_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "record_versions_one_current_unique" ON "dataset"."record_versions" USING btree ("record_id") WHERE "dataset"."record_versions"."is_current" = true AND "dataset"."record_versions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "record_versions_record_id_idx" ON "dataset"."record_versions" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "records_active_updated_idx" ON "dataset"."records" USING btree ("updated_at") WHERE "dataset"."records"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "records_status_idx" ON "dataset"."records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "records_record_type_idx" ON "dataset"."records" USING btree ("record_type");--> statement-breakpoint
CREATE INDEX "records_source_id_idx" ON "dataset"."records" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "records_owner_id_idx" ON "dataset"."records" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "auth"."refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_active_expiry_idx" ON "auth"."refresh_tokens" USING btree ("expires_at") WHERE "auth"."refresh_tokens"."revoked_at" IS NULL;