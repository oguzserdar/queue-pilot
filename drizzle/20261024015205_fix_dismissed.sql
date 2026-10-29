CREATE TABLE "qp_fix_dismissed" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_fix_dismissed_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "qp_fix_dismissed" ADD CONSTRAINT "qp_fix_dismissed_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;