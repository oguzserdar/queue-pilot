CREATE TABLE "qp_material" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qp_material_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "qp_material" ADD CONSTRAINT "qp_material_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;