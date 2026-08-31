CREATE TABLE "auth"."api_request_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."api_request_nonces" ADD CONSTRAINT "api_request_nonces_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "auth"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_request_nonces_key_nonce_unique" ON "auth"."api_request_nonces" USING btree ("api_key_id","nonce");--> statement-breakpoint
CREATE INDEX "api_request_nonces_expiry_idx" ON "auth"."api_request_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "api_request_nonces_key_idempotency_idx" ON "auth"."api_request_nonces" USING btree ("api_key_id","idempotency_key","created_at");