CREATE TABLE "qp_buffer_allowance" (
	"policy" text PRIMARY KEY NOT NULL,
	"remaining" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qp_buffer_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qp_buffer_reservation" ADD CONSTRAINT "qp_buffer_reservation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qp_buffer_reservation_expires_idx" ON "qp_buffer_reservation" USING btree ("expires_at");