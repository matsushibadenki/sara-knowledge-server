CREATE TABLE "memory"."relation_revisions" (
	"relation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"origin" text DEFAULT 'captured' NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "relation_revisions_relation_id_revision_pk" PRIMARY KEY("relation_id","revision")
);
--> statement-breakpoint
ALTER TABLE "memory"."relation_revisions" ADD CONSTRAINT "relation_revisions_relation_id_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "memory"."relations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO memory.relation_revisions (relation_id, revision, origin, snapshot)
SELECT id, revision, 'migration_baseline', to_jsonb(r) FROM memory.relations r;
--> statement-breakpoint
CREATE FUNCTION memory.capture_relation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_WHEN = 'BEFORE' THEN
    IF TG_OP = 'INSERT' THEN NEW.revision := 1;
    ELSE NEW.revision := OLD.revision + 1;
    END IF;
  ELSE
    INSERT INTO memory.relation_revisions (relation_id, revision, recorded_at, snapshot)
    VALUES (NEW.id, NEW.revision, clock_timestamp(), to_jsonb(NEW));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER relation_revision_number BEFORE INSERT OR UPDATE ON memory.relations
FOR EACH ROW EXECUTE FUNCTION memory.capture_relation_revision();
--> statement-breakpoint
CREATE TRIGGER relation_revision_capture AFTER INSERT OR UPDATE ON memory.relations
FOR EACH ROW EXECUTE FUNCTION memory.capture_relation_revision();
--> statement-breakpoint
CREATE FUNCTION memory.guard_relation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM memory.relations WHERE id = OLD.relation_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Relation revisions are immutable' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER relation_revision_immutable BEFORE UPDATE OR DELETE ON memory.relation_revisions
FOR EACH ROW EXECUTE FUNCTION memory.guard_relation_revision();
