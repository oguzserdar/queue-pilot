ALTER TYPE "public"."qp_announcement_status" ADD VALUE 'scheduled';--> statement-breakpoint
ALTER TYPE "public"."qp_announcement_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "qp_announcement_send" ADD COLUMN "guild_id" text;--> statement-breakpoint
ALTER TABLE "qp_announcement_send" ADD COLUMN "send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qp_announcement_send" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "qp_announcement_send" ADD COLUMN "claimed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qp_announcement_send" ADD COLUMN "call_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "qp_announcement_send_due" ON "qp_announcement_send" USING btree ("status","send_at");