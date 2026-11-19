CREATE TABLE "memory"."evidence_revalidation_jobs" (
	"source_id" uuid NOT NULL,
	"source_revision" integer NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"affected_count" integer,
	"review_required" boolean,
	CONSTRAINT "evidence_revalidation_jobs_source_id_source_revision_pk" PRIMARY KEY("source_id","source_revision")
);
--> statement-breakpoint
ALTER TABLE "memory"."evidence_revalidation_jobs" ADD CONSTRAINT "evidence_revalidation_jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "dataset"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_revalidation_pending_idx" ON "memory"."evidence_revalidation_jobs" USING btree ("queued_at") WHERE "memory"."evidence_revalidation_jobs"."checked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_evidence_pinned_source_idx" ON "memory"."relation_evidence" USING btree (("reference_snapshot"->'pin'->>'source_id'));
--> statement-breakpoint
CREATE VIEW memory.stale_source_evidence AS
SELECT e.id AS evidence_id, e.relation_id, s.id AS source_id, s.revision AS current_revision,
       CASE WHEN s.deleted_at IS NOT NULL THEN 'source_withdrawn' ELSE 'source_revised' END AS reason
FROM memory.relation_evidence e
JOIN dataset.sources s ON s.id = (e.reference_snapshot->'pin'->>'source_id')::uuid
WHERE s.deleted_at IS NOT NULL OR s.revision <> (e.reference_snapshot->'pin'->>'source_revision')::integer;
--> statement-breakpoint
CREATE FUNCTION memory.queue_evidence_revalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO memory.evidence_revalidation_jobs(source_id, source_revision)
  VALUES (NEW.id, NEW.revision);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER source_evidence_revalidation AFTER UPDATE ON dataset.sources
FOR EACH ROW WHEN (OLD.revision IS DISTINCT FROM NEW.revision)
EXECUTE FUNCTION memory.queue_evidence_revalidation();
--> statement-breakpoint
INSERT INTO memory.evidence_revalidation_jobs(source_id, source_revision)
SELECT DISTINCT source_id, current_revision FROM memory.stale_source_evidence;
--> statement-breakpoint
-- Historical Record versions can introduce another stale pin after a check.
CREATE FUNCTION memory.queue_late_stale_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_source dataset.sources%ROWTYPE;
BEGIN
  SELECT * INTO current_source FROM dataset.sources
  WHERE id = (NEW.reference_snapshot->'pin'->>'source_id')::uuid
  FOR SHARE;
  IF NOT FOUND OR current_source.revision <= (NEW.reference_snapshot->'pin'->>'source_revision')::integer THEN
    RETURN NEW;
  END IF;
  INSERT INTO memory.evidence_revalidation_jobs(source_id, source_revision)
  VALUES (current_source.id, current_source.revision)
  ON CONFLICT (source_id, source_revision) DO UPDATE
    SET checked_at = NULL, affected_count = NULL, review_required = NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_late_revalidation AFTER INSERT ON memory.relation_evidence
FOR EACH ROW EXECUTE FUNCTION memory.queue_late_stale_evidence();
