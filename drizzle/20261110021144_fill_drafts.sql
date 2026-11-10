CREATE TABLE "qp_fill_draft" (
	"user_id" text NOT NULL,
	"run_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"text" text NOT NULL,
	"source_key" text,
	"snapshot_id" text,
	"evidence" jsonb,
	"status" text DEFAULT 'written' NOT NULL,
	"reason" text,
	"post_id" text,
	"call_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_fill_draft_user_id_run_id_slot_id_pk" PRIMARY KEY("user_id","run_id","slot_id")
);
--> statement-breakpoint
ALTER TABLE "qp_fill_draft" ADD CONSTRAINT "qp_fill_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_fill_draft_open" ON "qp_fill_draft" USING btree ("user_id","status");