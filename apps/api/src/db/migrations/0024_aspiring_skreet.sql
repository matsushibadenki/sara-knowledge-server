ALTER TABLE "memory"."concepts" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."entities" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."entity_aliases" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."events" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."experiences" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."relations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."verification_decisions" ADD COLUMN "target_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."verification_decisions" ADD COLUMN "target_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "memory"."concepts" ADD CONSTRAINT "memory_concepts_revision_check" CHECK ("memory"."concepts"."revision" > 0);--> statement-breakpoint
ALTER TABLE "memory"."entities" ADD CONSTRAINT "memory_entities_revision_check" CHECK ("memory"."entities"."revision" > 0);--> statement-breakpoint
ALTER TABLE "memory"."entity_aliases" ADD CONSTRAINT "memory_entity_aliases_revision_check" CHECK ("memory"."entity_aliases"."revision" > 0);--> statement-breakpoint
ALTER TABLE "memory"."events" ADD CONSTRAINT "memory_events_revision_check" CHECK ("memory"."events"."revision" > 0);--> statement-breakpoint
ALTER TABLE "memory"."experiences" ADD CONSTRAINT "memory_experiences_revision_check" CHECK ("memory"."experiences"."revision" > 0);--> statement-breakpoint
ALTER TABLE "memory"."relations" ADD CONSTRAINT "memory_relations_revision_check" CHECK ("memory"."relations"."revision" > 0);--> statement-breakpoint
ALTER TABLE "memory"."verification_decisions" ADD CONSTRAINT "memory_verification_target_revision_check" CHECK ("memory"."verification_decisions"."target_revision" > 0);