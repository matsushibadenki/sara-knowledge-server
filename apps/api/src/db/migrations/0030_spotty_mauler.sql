ALTER TABLE "memory"."relation_evidence" ADD COLUMN "reference_snapshot" jsonb;
--> statement-breakpoint
CREATE FUNCTION memory.guard_evidence_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.reference_type, OLD.reference_id, OLD.reference_snapshot)
     IS DISTINCT FROM ROW(NEW.reference_type, NEW.reference_id, NEW.reference_snapshot) THEN
    RAISE EXCEPTION 'Evidence reference is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_reference_immutable BEFORE UPDATE ON memory.relation_evidence
FOR EACH ROW EXECUTE FUNCTION memory.guard_evidence_reference();
