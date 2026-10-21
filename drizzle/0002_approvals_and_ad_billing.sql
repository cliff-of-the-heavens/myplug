CREATE TYPE "public"."promotion_status" AS ENUM('pending_quote', 'awaiting_payment', 'payment_submitted', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TABLE "ad_bands" (
	"tier" "promotion_tier" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"weekly_cents" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "tier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "amount_paid_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "starts_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "starts_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "ends_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "is_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "days" integer;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "status" "promotion_status" DEFAULT 'awaiting_payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "request_note" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "admin_note" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "proof_url" text;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "payment_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "status" "store_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
-- Stores and adverts that existed before approvals were introduced stay live.
UPDATE "stores" SET "status" = 'approved', "reviewed_at" = now();--> statement-breakpoint
UPDATE "promotions" SET
	"number" = 'AD-' || upper(substr(replace("id"::text, '-', ''), 1, 6)),
	"days" = greatest(1, ceil(extract(epoch from ("ends_at" - "starts_at")) / 86400))::int,
	"status" = 'approved',
	"approved_at" = "starts_at";--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "days" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promotions_status_idx" ON "promotions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_number_unique" UNIQUE("number");--> statement-breakpoint
INSERT INTO "ad_bands" ("tier", "name", "description", "weekly_cents") VALUES
	('boost', 'Boost', 'Sponsored badge and a spot in Sponsored picks.', 1000000),
	('featured', 'Featured', 'Everything in Boost, with much higher placement in the feed.', 2500000),
	('premium', 'Premium', 'Everything in Featured, with top priority across the store.', 5000000)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "settings" ("key", "value") VALUES
	('payment_instructions', 'Pay by bank transfer or mobile money and use your advert number (e.g. AD-XXXXXX) as the reference. Then upload your proof of payment below.

Bank: (your bank name) · Account: MyPlug Ltd · Number: 0000000000 · Branch: (branch)
Airtel Money / TNM Mpamba: 099 000 0000 (MyPlug)')
ON CONFLICT DO NOTHING;
