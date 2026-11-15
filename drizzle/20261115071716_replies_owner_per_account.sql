ALTER TABLE "qp_social_account" DROP CONSTRAINT "qp_social_account_user_network_account";--> statement-breakpoint
DROP INDEX "qp_social_account_replies_once";--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD COLUMN "replies_owner" text;--> statement-breakpoint
CREATE UNIQUE INDEX "qp_social_account_replies_owner" ON "qp_social_account" USING btree ("replies_owner");--> statement-breakpoint
ALTER TABLE "qp_social_account" ADD CONSTRAINT "qp_social_account_user_network_server_account" UNIQUE("user_id","network","server","account_id");