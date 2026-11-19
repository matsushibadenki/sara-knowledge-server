CREATE TABLE "dataset"."source_revisions" (
	"source_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"origin" text DEFAULT 'captured' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_revisions_source_id_revision_pk" PRIMARY KEY("source_id","revision"),
	CONSTRAINT "source_revisions_origin_check" CHECK ("dataset"."source_revisions"."origin" IN ('captured','migration_baseline'))
);
--> statement-breakpoint
ALTER TABLE "dataset"."record_versions" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "dataset"."record_versions" ADD COLUMN "source_revision" integer;--> statement-breakpoint
ALTER TABLE "dataset"."record_versions" ADD COLUMN "source_pin_state" text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."record_versions" ADD COLUMN "context_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "dataset"."sources" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset"."source_revisions" ADD CONSTRAINT "source_revisions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "dataset"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."record_versions" ADD CONSTRAINT "record_versions_source_revision_fk" FOREIGN KEY ("source_id","source_revision") REFERENCES "dataset"."source_revisions"("source_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_versions_source_revision_idx" ON "dataset"."record_versions" USING btree ("source_id","source_revision");--> statement-breakpoint
ALTER TABLE "dataset"."record_versions" ADD CONSTRAINT "record_versions_source_pin_check" CHECK (("dataset"."record_versions"."source_pin_state"='pinned' AND "dataset"."record_versions"."source_id" IS NOT NULL AND "dataset"."record_versions"."source_revision" IS NOT NULL) OR ("dataset"."record_versions"."source_pin_state"='none' AND "dataset"."record_versions"."source_id" IS NULL AND "dataset"."record_versions"."source_revision" IS NULL) OR ("dataset"."record_versions"."source_pin_state"='legacy_unknown' AND "dataset"."record_versions"."source_revision" IS NULL));
--> statement-breakpoint
-- Only the present Source is known at migration time. Do not invent old Record provenance.
INSERT INTO dataset.source_revisions (source_id,revision,snapshot,origin)
SELECT id,revision,to_jsonb(s)-'revision','migration_baseline' FROM dataset.sources s;
--> statement-breakpoint
CREATE FUNCTION dataset.capture_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_WHEN='BEFORE' THEN
    IF TG_OP='INSERT' THEN NEW.revision:=1;
    ELSIF (to_jsonb(NEW)-'revision'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'updated_at') THEN
      NEW.revision:=OLD.revision+1;
    ELSE NEW.revision:=OLD.revision;
    END IF;
  ELSE
    IF TG_OP='INSERT' OR NEW.revision IS DISTINCT FROM OLD.revision THEN
      INSERT INTO dataset.source_revisions(source_id,revision,snapshot) VALUES(NEW.id,NEW.revision,to_jsonb(NEW)-'revision');
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER source_revision_number BEFORE INSERT OR UPDATE ON dataset.sources FOR EACH ROW EXECUTE FUNCTION dataset.capture_source_revision();
--> statement-breakpoint
CREATE TRIGGER source_revision_capture AFTER INSERT OR UPDATE ON dataset.sources FOR EACH ROW EXECUTE FUNCTION dataset.capture_source_revision();
--> statement-breakpoint
CREATE FUNCTION dataset.guard_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Physical parent deletion is reserved for fixture/admin cleanup; FK pins still apply.
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM dataset.sources WHERE id=OLD.source_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Source revisions are immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER source_revision_immutable BEFORE UPDATE OR DELETE ON dataset.source_revisions FOR EACH ROW EXECUTE FUNCTION dataset.guard_source_revision();
--> statement-breakpoint
CREATE FUNCTION dataset.pin_record_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent dataset.records%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.source_id,NEW.source_revision,NEW.source_pin_state,NEW.context_snapshot) IS DISTINCT FROM ROW(OLD.source_id,OLD.source_revision,OLD.source_pin_state,OLD.context_snapshot) THEN
      RAISE EXCEPTION 'Record version provenance is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT parent FROM dataset.records WHERE id=NEW.record_id;
  IF NEW.context_snapshot IS NULL THEN
    NEW.context_snapshot:=jsonb_build_object('record_type',parent.record_type,'title',parent.title,'language_code',parent.language_code,'metadata',parent.metadata,'quality_score',parent.quality_score,'confidence',parent.confidence);
  END IF;
  IF NEW.version_number=1 THEN
    NEW.source_id:=parent.source_id;
    IF parent.source_id IS NULL THEN NEW.source_pin_state:='none'; NEW.source_revision:=NULL;
    ELSE
      SELECT revision INTO STRICT NEW.source_revision FROM dataset.sources WHERE id=parent.source_id FOR SHARE;
      NEW.source_pin_state:='pinned';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER record_source_pin BEFORE INSERT OR UPDATE ON dataset.record_versions FOR EACH ROW EXECUTE FUNCTION dataset.pin_record_source();
