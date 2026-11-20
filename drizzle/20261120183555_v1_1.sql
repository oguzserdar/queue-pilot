CREATE TABLE "qp_admin_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qp_admin_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"via" text NOT NULL,
	"operation" text NOT NULL,
	"input" jsonb,
	"result" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qp_app_admin_grant" (
	"user_id" text NOT NULL,
	"consent_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text NOT NULL,
	CONSTRAINT "qp_app_admin_grant_user_id_consent_id_pk" PRIMARY KEY("user_id","consent_id")
);
--> statement-breakpoint
ALTER TABLE "qp_app_admin_grant" ADD CONSTRAINT "qp_app_admin_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_app_admin_grant" ADD CONSTRAINT "qp_app_admin_grant_consent_id_oauth_consent_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."oauth_consent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_admin_audit_at_idx" ON "qp_admin_audit" USING btree ("at");
--> statement-breakpoint
ALTER TYPE "public"."qp_echo_kind" ADD VALUE 'mastodon';--> statement-breakpoint
ALTER TYPE "public"."qp_echo_kind" ADD VALUE 'bluesky';--> statement-breakpoint
CREATE TABLE "qp_social_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network" "qp_echo_kind" NOT NULL,
	"account_id" text NOT NULL,
	"handle" text NOT NULL,
	"server" text NOT NULL,
	"credentials" text NOT NULL,
	"scopes" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broken_at" timestamp with time zone,
	CONSTRAINT "qp_social_account_user_network_account" UNIQUE("user_id","network","account_id")
);
--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD CONSTRAINT "qp_social_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_social_account_user_idx" ON "qp_social_account" USING btree ("user_id");
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "qp_reply_cursor" (
	"account_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"primed_at" timestamp with time zone,
	"cursor" text,
	"seen_uri" text,
	"seen_at" timestamp with time zone,
	"polled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "replies_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qp_reply_cursor" ADD CONSTRAINT "qp_reply_cursor_account_id_qp_social_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."qp_social_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_reply_cursor" ADD CONSTRAINT "qp_reply_cursor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "qp_agent_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"content_key" text NOT NULL,
	"copied_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_agent_artifact_content" UNIQUE("registration_id","kind","content_key"),
	CONSTRAINT "qp_agent_artifact_kind" CHECK ("qp_agent_artifact"."kind" in ('material', 'draft'))
);
--> statement-breakpoint
CREATE TABLE "qp_agent_grant" (
	"registration_id" text NOT NULL,
	"capability" text NOT NULL,
	"source" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text,
	CONSTRAINT "qp_agent_grant_registration_id_capability_pk" PRIMARY KEY("registration_id","capability"),
	CONSTRAINT "qp_agent_grant_capability" CHECK ("qp_agent_grant"."capability" in ('save_material', 'save_drafts')),
	CONSTRAINT "qp_agent_grant_source" CHECK ("qp_agent_grant"."source" in ('register', 'claim'))
);
--> statement-breakpoint
CREATE TABLE "qp_agent_registration" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"tool" text,
	"label" text,
	"source" text,
	"owner_email_hint" text,
	"assertion_jti" text NOT NULL,
	"assertion_expires_at" timestamp with time zone NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "qp_claim_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
	"route" text NOT NULL,
	"state" text DEFAULT 'live' NOT NULL,
	"code_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"address_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"claimed_by" text,
	"last_polled_at" timestamp with time zone,
	CONSTRAINT "qp_claim_ticket_route" CHECK ("qp_claim_ticket"."route" in ('link', 'computer', 'email', 'sign_in')),
	CONSTRAINT "qp_claim_ticket_state" CHECK ("qp_claim_ticket"."state" in ('live', 'used', 'expired', 'cancelled', 'blocked', 'dismissed', 'void'))
);
--> statement-breakpoint
ALTER TABLE "qp_agent_artifact" ADD CONSTRAINT "qp_agent_artifact_registration_id_qp_agent_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."qp_agent_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_agent_grant" ADD CONSTRAINT "qp_agent_grant_registration_id_qp_agent_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."qp_agent_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_agent_grant" ADD CONSTRAINT "qp_agent_grant_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_agent_registration" ADD CONSTRAINT "qp_agent_registration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_claim_ticket" ADD CONSTRAINT "qp_claim_ticket_registration_id_qp_agent_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."qp_agent_registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_claim_ticket" ADD CONSTRAINT "qp_claim_ticket_claimed_by_user_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_agent_artifact_list_idx" ON "qp_agent_artifact" USING btree ("registration_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "qp_agent_registration_user_idx" ON "qp_agent_registration" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "qp_agent_registration_created_idx" ON "qp_agent_registration" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "qp_claim_ticket_registration_idx" ON "qp_claim_ticket" USING btree ("registration_id","state");
--> statement-breakpoint
CREATE TABLE "qp_mastodon_app" (
	"origin" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"scopes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_mastodon_app_origin_redirect_uri_pk" PRIMARY KEY("origin","redirect_uri")
);
--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "session" text;
--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "replies_since" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "qp_social_account_replies_once" ON "qp_social_account" USING btree ("network","account_id") WHERE replies_on;
--> statement-breakpoint
ALTER TABLE "qp_message" ADD COLUMN "meta" jsonb;
--> statement-breakpoint
ALTER TYPE "public"."qp_echo_kind" ADD VALUE 'instagram';
--> statement-breakpoint
ALTER TABLE "qp_social_account" DROP CONSTRAINT "qp_social_account_user_network_account";--> statement-breakpoint
DROP INDEX "qp_social_account_replies_once";--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "replies_owner" text;--> statement-breakpoint
CREATE UNIQUE INDEX "qp_social_account_replies_owner" ON "qp_social_account" USING btree ("replies_owner");--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD CONSTRAINT "qp_social_account_user_network_server_account" UNIQUE("user_id","network","server","account_id");
--> statement-breakpoint
CREATE TABLE "qp_reply_automation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"post_scope" text DEFAULT 'any' NOT NULL,
	"post_external_id" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"reply_mode" text DEFAULT 'voice' NOT NULL,
	"reply_texts" text[] DEFAULT '{}'::text[] NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_reply_automation_scope" CHECK (("qp_reply_automation"."post_scope" = 'any' and "qp_reply_automation"."post_external_id" is null) or ("qp_reply_automation"."post_scope" = 'post' and "qp_reply_automation"."post_external_id" is not null)),
	CONSTRAINT "qp_reply_automation_mode" CHECK (("qp_reply_automation"."reply_mode" = 'voice') or ("qp_reply_automation"."reply_mode" = 'fixed' and cardinality("qp_reply_automation"."reply_texts") between 1 and 10)),
	CONSTRAINT "qp_reply_automation_keywords" CHECK (cardinality("qp_reply_automation"."keywords") <= 20)
);
--> statement-breakpoint
ALTER TABLE "qp_message" ADD COLUMN "automation_id" text;--> statement-breakpoint
ALTER TABLE "qp_reply_automation" ADD CONSTRAINT "qp_reply_automation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qp_reply_automation" ADD CONSTRAINT "qp_reply_automation_account_id_qp_social_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."qp_social_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_reply_automation_account_idx" ON "qp_reply_automation" USING btree ("user_id","account_id");
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "qp_pulled_back" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_pulled_back_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "qp_pulled_back" ADD CONSTRAINT "qp_pulled_back_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qp_announcement_send" DROP CONSTRAINT "qp_announcement_send_announcement_id_kind_pk";--> statement-breakpoint
ALTER TABLE "qp_announcement_send" ADD CONSTRAINT "qp_announcement_send_announcement_id_kind_target_pk" PRIMARY KEY("announcement_id","kind","target");--> statement-breakpoint
CREATE UNIQUE INDEX "qp_announcement_send_one_bot_place" ON "qp_announcement_send" USING btree ("announcement_id","kind") WHERE "qp_announcement_send"."kind" in ('telegram', 'discord');
--> statement-breakpoint
ALTER TABLE "qp_announcement_send" ADD COLUMN "waits" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "qp_cooldown" (
	"key" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "posting_schedule" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "time_zone" text;
