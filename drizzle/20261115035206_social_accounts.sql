ALTER TYPE "public"."qp_echo_kind" ADD VALUE 'mastodon';--> statement-breakpoint
ALTER TYPE "public"."qp_echo_kind" ADD VALUE 'bluesky';--> statement-breakpoint
CREATE TABLE "qp_social_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network" "qp_echo_kind" NOT NULL,
	"account_id" text NOT NULL,
	"handle" text NOT NULL,
	"server" text NOT NULL,
	"credentials" text NOT NULL,
	"scopes" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broken_at" timestamp with time zone,
	CONSTRAINT "qp_social_account_user_network_account" UNIQUE("user_id","network","account_id")
);
--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD CONSTRAINT "qp_social_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_social_account_user_idx" ON "qp_social_account" USING btree ("user_id");