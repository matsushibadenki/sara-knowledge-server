ALTER TABLE "memory"."relation_evidence" ADD COLUMN "supersedes_evidence_id" uuid;--> statement-breakpoint
ALTER TABLE "memory"."relation_evidence" ADD CONSTRAINT "memory_evidence_replacement_fk" FOREIGN KEY ("supersedes_evidence_id") REFERENCES "memory"."relation_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_evidence_replacement_unique" ON "memory"."relation_evidence" USING btree ("supersedes_evidence_id");
--> statement-breakpoint
CREATE VIEW memory.active_stale_source_evidence AS
SELECT stale.* FROM memory.stale_source_evidence stale
WHERE NOT EXISTS (
  SELECT 1 FROM memory.relation_evidence replacement
  WHERE replacement.supersedes_evidence_id = stale.evidence_id
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION memory.queue_evidence_revalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO memory.evidence_revalidation_jobs(source_id, source_revision, queued_at)
  VALUES (NEW.id, NEW.revision, clock_timestamp());
  RETURN NEW;
END $$;
