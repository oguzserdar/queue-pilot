CREATE TABLE "qp_automation_reply_once" (
	"automation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"post_key" text NOT NULL,
	"message_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_automation_reply_once_automation_id_contact_id_post_key_pk" PRIMARY KEY("automation_id","contact_id","post_key")
);
--> statement-breakpoint
ALTER TABLE "qp_automation_reply_once" ADD CONSTRAINT "qp_automation_reply_once_automation_id_qp_reply_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."qp_reply_automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_automation_reply_once" ADD CONSTRAINT "qp_automation_reply_once_contact_id_qp_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."qp_contact"("id") ON DELETE cascade ON UPDATE no action;