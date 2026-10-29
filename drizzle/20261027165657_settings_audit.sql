CREATE TABLE "qp_settings_audit" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qp_settings_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"action" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
