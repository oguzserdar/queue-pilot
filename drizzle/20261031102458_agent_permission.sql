CREATE TABLE "qp_agent_permission" (
	"user_id" text PRIMARY KEY NOT NULL,
	"approve" text DEFAULT 'ask' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qp_agent_permission" ADD CONSTRAINT "qp_agent_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;