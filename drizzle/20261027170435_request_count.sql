CREATE TABLE "qp_request_count" (
	"key" text NOT NULL,
	"action" text NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "qp_request_count_key_action_bucket_pk" PRIMARY KEY("key","action","bucket")
);
--> statement-breakpoint
CREATE INDEX "qp_request_count_bucket_idx" ON "qp_request_count" USING btree ("bucket");