CREATE TABLE "qp_pulled_back" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_pulled_back_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "qp_pulled_back" ADD CONSTRAINT "qp_pulled_back_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;