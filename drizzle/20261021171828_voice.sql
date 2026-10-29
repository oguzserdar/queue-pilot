CREATE TABLE "qp_voice_example" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"channel" text NOT NULL,
	"text" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_voice_example_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "qp_voice_note" (
	"user_id" text PRIMARY KEY NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
