CREATE SCHEMA "memory";
--> statement-breakpoint
CREATE TABLE "memory"."concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_uid" text NOT NULL,
	"label" text,
	"concept_type" text NOT NULL,
	"description" text,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"contradiction_count" integer DEFAULT 0 NOT NULL,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"proposal_source" text NOT NULL,
	"utility_score" double precision DEFAULT 0 NOT NULL,
	"event_pattern" jsonb,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memory_concepts_counts_check" CHECK ("memory"."concepts"."evidence_count" >= 0 AND "memory"."concepts"."contradiction_count" >= 0),
	CONSTRAINT "memory_concepts_verification_check" CHECK ("memory"."concepts"."verification_state" IN ('unverified', 'candidate', 'verified', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "memory"."entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_uid" text NOT NULL,
	"entity_type" text NOT NULL,
	"canonical_name" text,
	"description" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"proposal_source" text NOT NULL,
	"source_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memory_entities_confidence_check" CHECK ("memory"."entities"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "memory_entities_verification_check" CHECK ("memory"."entities"."verification_state" IN ('unverified', 'candidate', 'verified', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "memory"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_uid" text NOT NULL,
	"source_id" uuid,
	"experience_id" uuid,
	"occurred_at" timestamp with time zone,
	"sequence_time" double precision,
	"duration" double precision,
	"modality" text NOT NULL,
	"channel" text,
	"event_type" text NOT NULL,
	"symbol" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_before" jsonb,
	"state_after" jsonb,
	"reward" double precision DEFAULT 0 NOT NULL,
	"prediction_error" double precision DEFAULT 0 NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"quality_score" double precision DEFAULT 0.5 NOT NULL,
	"proposal_source" text NOT NULL,
	"extractor_name" text,
	"extractor_version" text,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"source_hash" text,
	"novelty" double precision DEFAULT 0 NOT NULL,
	"priority_score" double precision DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memory_events_duration_check" CHECK ("memory"."events"."duration" IS NULL OR "memory"."events"."duration" >= 0),
	CONSTRAINT "memory_events_confidence_check" CHECK ("memory"."events"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "memory_events_quality_check" CHECK ("memory"."events"."quality_score" BETWEEN 0 AND 1),
	CONSTRAINT "memory_events_novelty_check" CHECK ("memory"."events"."novelty" BETWEEN 0 AND 1),
	CONSTRAINT "memory_events_verification_check" CHECK ("memory"."events"."verification_state" IN ('unverified', 'candidate', 'verified', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "memory"."experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_uid" text NOT NULL,
	"source_id" uuid,
	"title" text,
	"state_before" jsonb,
	"event_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_after" jsonb,
	"reward" double precision DEFAULT 0 NOT NULL,
	"prediction_error" double precision DEFAULT 0 NOT NULL,
	"quality_score" double precision DEFAULT 0.5 NOT NULL,
	"curriculum_level" text DEFAULT 'raw' NOT NULL,
	"split_name" text DEFAULT 'unsplit' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memory_experiences_quality_check" CHECK ("memory"."experiences"."quality_score" BETWEEN 0 AND 1),
	CONSTRAINT "memory_experiences_split_check" CHECK ("memory"."experiences"."split_name" IN ('unsplit', 'train', 'validation', 'test', 'holdout', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "memory"."relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relation_uid" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"strength" double precision DEFAULT 0.5 NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"counterexample_count" integer DEFAULT 0 NOT NULL,
	"min_delay_ms" double precision,
	"max_delay_ms" double precision,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"proposal_source" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "memory_relations_strength_check" CHECK ("memory"."relations"."strength" BETWEEN 0 AND 1),
	CONSTRAINT "memory_relations_confidence_check" CHECK ("memory"."relations"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "memory_relations_counts_check" CHECK ("memory"."relations"."evidence_count" >= 0 AND "memory"."relations"."counterexample_count" >= 0),
	CONSTRAINT "memory_relations_node_type_check" CHECK ("memory"."relations"."source_type" IN ('event', 'experience', 'entity', 'concept', 'record', 'dataset_snapshot', 'model') AND "memory"."relations"."target_type" IN ('event', 'experience', 'entity', 'concept', 'record', 'dataset_snapshot', 'model')),
	CONSTRAINT "memory_relations_delay_check" CHECK (("memory"."relations"."min_delay_ms" IS NULL OR "memory"."relations"."min_delay_ms" >= 0) AND ("memory"."relations"."max_delay_ms" IS NULL OR "memory"."relations"."max_delay_ms" >= 0) AND ("memory"."relations"."min_delay_ms" IS NULL OR "memory"."relations"."max_delay_ms" IS NULL OR "memory"."relations"."min_delay_ms" <= "memory"."relations"."max_delay_ms")),
	CONSTRAINT "memory_relations_validity_check" CHECK ("memory"."relations"."valid_from" IS NULL OR "memory"."relations"."valid_until" IS NULL OR "memory"."relations"."valid_from" <= "memory"."relations"."valid_until"),
	CONSTRAINT "memory_relations_verification_check" CHECK ("memory"."relations"."verification_state" IN ('unverified', 'candidate', 'verified', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "memory"."concepts" ADD CONSTRAINT "concepts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "dataset"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."concepts" ADD CONSTRAINT "concepts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."entities" ADD CONSTRAINT "entities_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "dataset"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."entities" ADD CONSTRAINT "entities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."events" ADD CONSTRAINT "events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "dataset"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."events" ADD CONSTRAINT "events_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "memory"."experiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."experiences" ADD CONSTRAINT "experiences_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "dataset"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."experiences" ADD CONSTRAINT "experiences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory"."relations" ADD CONSTRAINT "relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_concepts_creator_uid_unique" ON "memory"."concepts" USING btree ("created_by","concept_uid");--> statement-breakpoint
CREATE INDEX "memory_concepts_active_creator_timeline_idx" ON "memory"."concepts" USING btree ("created_by","updated_at") WHERE "memory"."concepts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_concepts_type_label_idx" ON "memory"."concepts" USING btree ("concept_type","label");--> statement-breakpoint
CREATE INDEX "memory_concepts_source_id_idx" ON "memory"."concepts" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_entities_creator_uid_unique" ON "memory"."entities" USING btree ("created_by","entity_uid");--> statement-breakpoint
CREATE INDEX "memory_entities_active_creator_timeline_idx" ON "memory"."entities" USING btree ("created_by","updated_at") WHERE "memory"."entities"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_entities_type_name_idx" ON "memory"."entities" USING btree ("entity_type","canonical_name");--> statement-breakpoint
CREATE INDEX "memory_entities_source_id_idx" ON "memory"."entities" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_events_creator_uid_unique" ON "memory"."events" USING btree ("created_by","event_uid");--> statement-breakpoint
CREATE INDEX "memory_events_active_creator_timeline_idx" ON "memory"."events" USING btree ("created_by","occurred_at","created_at") WHERE "memory"."events"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_events_experience_timeline_idx" ON "memory"."events" USING btree ("experience_id","sequence_time");--> statement-breakpoint
CREATE INDEX "memory_events_source_id_idx" ON "memory"."events" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "memory_events_modality_type_idx" ON "memory"."events" USING btree ("modality","event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_experiences_creator_uid_unique" ON "memory"."experiences" USING btree ("created_by","experience_uid");--> statement-breakpoint
CREATE INDEX "memory_experiences_active_creator_timeline_idx" ON "memory"."experiences" USING btree ("created_by","created_at") WHERE "memory"."experiences"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_experiences_source_id_idx" ON "memory"."experiences" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_relations_creator_uid_unique" ON "memory"."relations" USING btree ("created_by","relation_uid");--> statement-breakpoint
CREATE INDEX "memory_relations_active_creator_timeline_idx" ON "memory"."relations" USING btree ("created_by","created_at") WHERE "memory"."relations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_relations_active_source_idx" ON "memory"."relations" USING btree ("source_type","source_id","created_at") WHERE "memory"."relations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_relations_active_target_idx" ON "memory"."relations" USING btree ("target_type","target_id","created_at") WHERE "memory"."relations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memory_relations_type_idx" ON "memory"."relations" USING btree ("relation_type","created_at");