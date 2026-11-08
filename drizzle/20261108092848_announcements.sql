CREATE TYPE "public"."qp_announcement_status" AS ENUM('pending', 'sent', 'failed', 'uncertain');--> statement-breakpoint
CREATE TABLE "qp_announcement_send" (
	"announcement_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "qp_echo_kind" NOT NULL,
	"target" text NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"status" "qp_announcement_status" NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"link" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_announcement_send_announcement_id_kind_pk" PRIMARY KEY("announcement_id","kind")
);
--> statement-breakpoint
ALTER TABLE "qp_announcement_send" ADD CONSTRAINT "qp_announcement_send_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_announcement_send_user_created" ON "qp_announcement_send" USING btree ("user_id","created_at");