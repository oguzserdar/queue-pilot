CREATE TABLE "qp_ai_app_use" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"first_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"calls" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "qp_ai_app_use_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "qp_ai_app_use" ADD CONSTRAINT "qp_ai_app_use_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;