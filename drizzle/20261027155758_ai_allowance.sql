CREATE TABLE "qp_ai_usage" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"actions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "qp_ai_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "qp_ai_usage_total" (
	"day" date PRIMARY KEY NOT NULL,
	"actions" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qp_ai_usage" ADD CONSTRAINT "qp_ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;