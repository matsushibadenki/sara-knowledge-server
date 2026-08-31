CREATE TABLE "memory"."entity_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"language_code" text DEFAULT 'und' NOT NULL,
	"alias_type" text DEFAULT 'name' NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"proposal_source" text NOT NULL,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memory_entity_aliases_confidence_check" CHECK ("memory"."entity_aliases"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "memory_entity_aliases_verification_check" CHECK ("memory"."entity_aliases"."verification_state" IN ('unverified', 'candidate', 'verified', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "memory"."relation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_uid" text NOT NULL,
	"relation_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid,
	"supports" boolean NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_relation_evidence_weight_check" CHECK ("memory"."relation_evidence"."weight" > 0),
	CONSTRAINT "memory_relation_evidence_reference_type_check" CHECK ("memory"."relation_evidence"."reference_type" IN ('source', 'record', 'event', 'experience', 'entity', 'concept', 'dataset_snapshot', 'model', 'external')),
	CONSTRAINT "memory_relation_evidence_reference_presence_check" CHECK (("memory"."relation_evidence"."reference_type" = 'external' AND "memory"."relation_evidence"."reference_id" IS NULL) OR ("memory"."relation_evidence"."reference_type" <> 'external' AND "memory"."relation_evidence"."reference_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "memory"."verification_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_verification_target_type_check" CHECK ("memory"."verification_decisions"."target_type" IN ('event', 'entity', 'entity_alias', 'concept', 'relation')),
	CONSTRAINT "memory_verification_state_check" CHECK ("memory"."verification_decisions"."from_state" IN ('unverified', 'candidate', 'verified', 'rejected') AND "memory"."verification_decisions"."to_state" IN ('candidate', 'verified', 'rejected') AND "memory"."verification_decisions"."from_state" <> "memory"."verification_decisions"."to_state")
);
--> statement-breakpoint
ALTER TABLE "memory"."entity_aliases" ADD CONSTRAINT "entity_aliases_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "memory"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."entity_aliases" ADD CONSTRAINT "entity_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."relation_evidence" ADD CONSTRAINT "relation_evidence_relation_id_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "memory"."relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."relation_evidence" ADD CONSTRAINT "relation_evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."verification_decisions" ADD CONSTRAINT "verification_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entity_aliases_active_unique" ON "memory"."entity_aliases" USING btree ("entity_id","language_code","normalized_alias") WHERE "memory"."entity_aliases"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_entity_aliases_entity_timeline_idx" ON "memory"."entity_aliases" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_entity_aliases_active_lookup_idx" ON "memory"."entity_aliases" USING btree ("normalized_alias","language_code") WHERE "memory"."entity_aliases"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_entity_aliases_created_by_idx" ON "memory"."entity_aliases" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_relation_evidence_relation_uid_unique" ON "memory"."relation_evidence" USING btree ("relation_id","evidence_uid");--> statement-breakpoint
CREATE INDEX "memory_relation_evidence_relation_timeline_idx" ON "memory"."relation_evidence" USING btree ("relation_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_relation_evidence_reference_idx" ON "memory"."relation_evidence" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "memory_relation_evidence_created_by_idx" ON "memory"."relation_evidence" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "memory_verification_target_timeline_idx" ON "memory"."verification_decisions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_verification_decided_by_idx" ON "memory"."verification_decisions" USING btree ("decided_by");