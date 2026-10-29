CREATE TABLE "qp_written" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"network" text NOT NULL,
	"text" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_written_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "qp_written" ADD CONSTRAINT "qp_written_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;