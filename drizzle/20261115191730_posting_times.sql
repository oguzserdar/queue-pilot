ALTER TABLE "qp_social_account" ADD COLUMN "posting_schedule" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "time_zone" text;