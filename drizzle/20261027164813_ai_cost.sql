ALTER TABLE "qp_ai_usage" ADD COLUMN "cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "qp_ai_usage_total" ADD COLUMN "cost_micros" bigint DEFAULT 0 NOT NULL;