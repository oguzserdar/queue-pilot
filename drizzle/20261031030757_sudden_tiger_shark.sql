CREATE TABLE "qp_fix_verdict" (
	"user_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"verdicts" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "qp_fix_verdict_user_id_input_hash_pk" PRIMARY KEY("user_id","input_hash")
);
--> statement-breakpoint
ALTER TABLE "qp_fix_verdict" ADD CONSTRAINT "qp_fix_verdict_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;