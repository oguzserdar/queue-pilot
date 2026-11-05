ALTER TABLE "qp_ai_app_label" ALTER COLUMN "label" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "qp_ai_app_label" ADD COLUMN "app" text;