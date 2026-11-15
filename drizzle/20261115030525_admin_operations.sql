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