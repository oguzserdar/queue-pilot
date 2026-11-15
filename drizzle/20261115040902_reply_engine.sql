CREATE TABLE "qp_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qp_contact_identifier" (
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"channel_instance" text NOT NULL,
	"value" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_contact_identifier_user_id_channel_channel_instance_value_pk" PRIMARY KEY("user_id","channel","channel_instance","value")
);
--> statement-breakpoint
CREATE TABLE "qp_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"channel" text NOT NULL,
	"channel_instance" text NOT NULL,
	"channel_thread_key" text NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_conversation_thread" UNIQUE("user_id","channel","channel_instance","channel_thread_key","contact_id")
);
--> statement-breakpoint
CREATE TABLE "qp_message" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"channel" text NOT NULL,
	"channel_instance" text NOT NULL,
	"external_id" text,
	"post_external_id" text,
	"reply_to_id" text,
	"at" timestamp with time zone NOT NULL,
	"decision" text,
	"reason" text,
	"claim_token" text,
	"claimed_until" timestamp with time zone,
	"call_started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_message_external" UNIQUE("user_id","channel","channel_instance","external_id"),
	CONSTRAINT "qp_message_reply_claim" UNIQUE("reply_to_id","kind")
);
--> statement-breakpoint
CREATE TABLE "qp_opt_out" (
	"user_id" text NOT NULL,
	"contact_point" text NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_opt_out_user_id_contact_point_channel_purpose_pk" PRIMARY KEY("user_id","contact_point","channel","purpose")
);
--> statement-breakpoint
CREATE TABLE "qp_reply_once" (
	"user_id" text NOT NULL,
	"channel_instance" text NOT NULL,
	"post_external_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"message_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_reply_once_user_id_channel_instance_post_external_id_contact_id_pk" PRIMARY KEY("user_id","channel_instance","post_external_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "qp_contact" ADD CONSTRAINT "qp_contact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_contact_identifier" ADD CONSTRAINT "qp_contact_identifier_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_contact_identifier" ADD CONSTRAINT "qp_contact_identifier_contact_id_qp_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."qp_contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_conversation" ADD CONSTRAINT "qp_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_conversation" ADD CONSTRAINT "qp_conversation_contact_id_qp_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."qp_contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_message" ADD CONSTRAINT "qp_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_message" ADD CONSTRAINT "qp_message_conversation_id_qp_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."qp_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_opt_out" ADD CONSTRAINT "qp_opt_out_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_reply_once" ADD CONSTRAINT "qp_reply_once_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_reply_once" ADD CONSTRAINT "qp_reply_once_contact_id_qp_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."qp_contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_contact_user_idx" ON "qp_contact" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "qp_contact_identifier_contact_idx" ON "qp_contact_identifier" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "qp_message_conversation_idx" ON "qp_message" USING btree ("conversation_id","at");--> statement-breakpoint
CREATE INDEX "qp_message_inbox_idx" ON "qp_message" USING btree ("user_id","decision");