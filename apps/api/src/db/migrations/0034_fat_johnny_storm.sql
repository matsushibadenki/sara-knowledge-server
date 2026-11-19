CREATE TABLE "dataset"."dataset_snapshot_assets" (
	"snapshot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "dataset_snapshot_assets_snapshot_id_asset_id_pk" PRIMARY KEY("snapshot_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "dataset"."dataset_snapshot_assets" ADD CONSTRAINT "dataset_snapshot_assets_snapshot_id_dataset_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "dataset"."dataset_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset"."dataset_snapshot_assets" ADD CONSTRAINT "dataset_snapshot_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "dataset"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_snapshot_assets_asset_idx" ON "dataset"."dataset_snapshot_assets" USING btree ("asset_id");