CREATE TABLE "qp_review_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"post_id" text NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"quote" text,
	"start" integer,
	"end" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qp_review_link" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"drafts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "qp_review_comment" ADD CONSTRAINT "qp_review_comment_link_id_qp_review_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."qp_review_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_review_link" ADD CONSTRAINT "qp_review_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_review_comment_link_idx" ON "qp_review_comment" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE INDEX "qp_review_link_user_idx" ON "qp_review_link" USING btree ("user_id","created_at");