CREATE TABLE "dataset"."record_search_chunks" (
	"record_version_id" uuid NOT NULL,
	"encoder" text NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(256) NOT NULL,
	CONSTRAINT "record_search_chunks_record_version_id_encoder_ordinal_pk" PRIMARY KEY("record_version_id","encoder","ordinal")
);
--> statement-breakpoint
ALTER TABLE "dataset"."record_search_chunks" ADD CONSTRAINT "record_search_chunks_record_version_id_record_versions_id_fk" FOREIGN KEY ("record_version_id") REFERENCES "dataset"."record_versions"("id") ON DELETE cascade ON UPDATE no action;