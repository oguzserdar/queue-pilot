CREATE TABLE "qp_mastodon_app" (
	"origin" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"scopes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_mastodon_app_origin_redirect_uri_pk" PRIMARY KEY("origin","redirect_uri")
);
