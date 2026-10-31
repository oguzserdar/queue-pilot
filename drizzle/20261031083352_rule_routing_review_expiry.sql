CREATE TABLE "qp_rule_inheritance" (
	"user_id" text PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qp_review_link" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "qp_rule_inheritance" ADD CONSTRAINT "qp_rule_inheritance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;