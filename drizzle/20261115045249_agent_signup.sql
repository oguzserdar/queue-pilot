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