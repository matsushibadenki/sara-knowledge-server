CREATE INDEX "annotations_resolved_by_idx" ON "dataset"."annotations" USING btree ("resolved_by");--> statement-breakpoint
CREATE INDEX "record_versions_created_by_idx" ON "dataset"."record_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "records_current_version_id_idx" ON "dataset"."records" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "sources_created_by_idx" ON "dataset"."sources" USING btree ("created_by");