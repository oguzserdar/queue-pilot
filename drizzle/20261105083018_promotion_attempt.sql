CREATE TABLE "qp_promotion_attempt" (
	"user_id" text NOT NULL,
	"content_item_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone,
	CONSTRAINT "qp_promotion_attempt_user_id_content_item_id_pk" PRIMARY KEY("user_id","content_item_id")
);
--> statement-breakpoint
ALTER TABLE "qp_promotion_attempt" ADD CONSTRAINT "qp_promotion_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;