CREATE TYPE "public"."qp_echo_kind" AS ENUM('telegram', 'discord');--> statement-breakpoint
CREATE TYPE "public"."qp_echo_status" AS ENUM('sent', 'failed');--> statement-breakpoint
ALTER TABLE "qp_echo" ALTER COLUMN "status" SET DATA TYPE "public"."qp_echo_status" USING "status"::"public"."qp_echo_status";--> statement-breakpoint
ALTER TABLE "qp_echo_destination" ALTER COLUMN "kind" SET DATA TYPE "public"."qp_echo_kind" USING "kind"::"public"."qp_echo_kind";