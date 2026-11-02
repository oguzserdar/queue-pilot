CREATE TABLE "qp_draft_evidence" (
	"user_id" text NOT NULL,
	"buffer_post_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"claim" text NOT NULL,
	"quote" text,
	"locator" text,
	"draft_text" text NOT NULL,
	"judgment" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_draft_evidence_user_id_buffer_post_id_snapshot_id_claim_pk" PRIMARY KEY("user_id","buffer_post_id","snapshot_id","claim")
);
--> statement-breakpoint
CREATE TABLE "qp_source_job" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"token" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "qp_source_job_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "qp_source_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_key" text NOT NULL,
	"uri" text NOT NULL,
	"content_hash" text NOT NULL,
	"text" text NOT NULL,
	"title" text,
	"checked_by" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qp_draft_evidence" ADD CONSTRAINT "qp_draft_evidence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_draft_evidence" ADD CONSTRAINT "qp_draft_evidence_snapshot_id_qp_source_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."qp_source_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_source_job" ADD CONSTRAINT "qp_source_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_source_snapshot" ADD CONSTRAINT "qp_source_snapshot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_source_snapshot_latest" ON "qp_source_snapshot" USING btree ("user_id","source_key","fetched_at");