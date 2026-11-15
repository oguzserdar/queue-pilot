CREATE TABLE "qp_reply_automation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"post_scope" text DEFAULT 'any' NOT NULL,
	"post_external_id" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"reply_mode" text DEFAULT 'voice' NOT NULL,
	"reply_texts" text[] DEFAULT '{}'::text[] NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_reply_automation_scope" CHECK (("qp_reply_automation"."post_scope" = 'any' and "qp_reply_automation"."post_external_id" is null) or ("qp_reply_automation"."post_scope" = 'post' and "qp_reply_automation"."post_external_id" is not null)),
	CONSTRAINT "qp_reply_automation_mode" CHECK (("qp_reply_automation"."reply_mode" = 'voice') or ("qp_reply_automation"."reply_mode" = 'fixed' and cardinality("qp_reply_automation"."reply_texts") between 1 and 10)),
	CONSTRAINT "qp_reply_automation_keywords" CHECK (cardinality("qp_reply_automation"."keywords") <= 20)
);
--> statement-breakpoint
ALTER TABLE "qp_message" ADD COLUMN "automation_id" text;--> statement-breakpoint
ALTER TABLE "qp_reply_automation" ADD CONSTRAINT "qp_reply_automation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_reply_automation" ADD CONSTRAINT "qp_reply_automation_account_id_qp_social_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."qp_social_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_reply_automation_account_idx" ON "qp_reply_automation" USING btree ("user_id","account_id");