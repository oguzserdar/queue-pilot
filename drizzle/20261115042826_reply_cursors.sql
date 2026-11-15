CREATE TABLE "qp_reply_cursor" (
	"account_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"primed_at" timestamp with time zone,
	"cursor" text,
	"seen_uri" text,
	"seen_at" timestamp with time zone,
	"polled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "replies_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qp_reply_cursor" ADD CONSTRAINT "qp_reply_cursor_account_id_qp_social_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."qp_social_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_reply_cursor" ADD CONSTRAINT "qp_reply_cursor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;