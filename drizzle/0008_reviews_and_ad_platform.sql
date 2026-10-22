CREATE TYPE "public"."ad_campaign_status" AS ENUM('requested', 'awaiting_payment', 'payment_submitted', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pass_status" AS ENUM('requested', 'payment_submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_target" AS ENUM('product', 'store', 'courier');--> statement-breakpoint
CREATE TYPE "public"."review_visibility" AS ENUM('visible', 'flagged', 'hidden');--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"placement_key" text NOT NULL,
	"advertiser_id" uuid,
	"advertiser_name" text NOT NULL,
	"advertiser_email" text NOT NULL,
	"advertiser_phone" text,
	"company" text,
	"title" text NOT NULL,
	"headline" text,
	"link_url" text,
	"creative_url" text,
	"creative_width" integer,
	"creative_height" integer,
	"weeks" integer NOT NULL,
	"requested_start" date,
	"notes" text,
	"status" "ad_campaign_status" DEFAULT 'requested' NOT NULL,
	"amount_cents" bigint,
	"payment_reference" text,
	"proof_url" text,
	"payment_submitted_at" timestamp with time zone,
	"admin_note" text,
	"reviewed_by_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_campaigns_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "ad_free_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"days" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "pass_status" DEFAULT 'requested' NOT NULL,
	"payment_reference" text,
	"proof_url" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_free_passes_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "ad_placements" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"max_kb" integer NOT NULL,
	"formats" text DEFAULT 'jpg,png,webp' NOT NULL,
	"weekly_cents" bigint NOT NULL,
	"max_active" integer DEFAULT 3 NOT NULL,
	"hideable_with_pass" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_upload_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"passcode_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_upload_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" "review_target" NOT NULL,
	"target_key" text NOT NULL,
	"product_id" uuid,
	"store_id" uuid,
	"courier_id" uuid,
	"customer_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"status" "review_visibility" DEFAULT 'visible' NOT NULL,
	"flag_reason" text,
	"flagged_by_id" uuid,
	"flagged_at" timestamp with time zone,
	"reply" text,
	"admin_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ad_free_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_placement_key_ad_placements_key_fk" FOREIGN KEY ("placement_key") REFERENCES "public"."ad_placements"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_advertiser_id_users_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_free_passes" ADD CONSTRAINT "ad_free_passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_upload_links" ADD CONSTRAINT "ad_upload_links_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_flagged_by_id_users_id_fk" FOREIGN KEY ("flagged_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_campaigns_live_idx" ON "ad_campaigns" USING btree ("placement_key","status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "ad_campaigns_advertiser_idx" ON "ad_campaigns" USING btree ("advertiser_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_target_idx" ON "reviews" USING btree ("order_id","target_key");--> statement-breakpoint
CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "reviews_store_idx" ON "reviews" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "reviews_courier_idx" ON "reviews" USING btree ("courier_id","status");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status");--> statement-breakpoint
INSERT INTO "ad_placements" ("key", "name", "description", "width", "height", "max_kb", "formats", "weekly_cents", "max_active", "hideable_with_pass", "position") VALUES
  ('hero', 'Home page hero', 'The big slide at the top of the home page, rotating with MyPlug''s own welcome slide. The most-seen spot on the site.', 1600, 640, 600, 'jpg,png,webp', 15000000, 3, false, 0),
  ('home_banner', 'Home page banner', 'A full-width strip between sections on the home page, shown once per visit.', 1600, 300, 400, 'jpg,png,webp', 6000000, 4, true, 1),
  ('category_top', 'Search & category banner', 'A slim banner above search and category results, matched to shoppers who are actively looking.', 1200, 200, 300, 'jpg,png,webp', 5000000, 4, true, 2),
  ('sidebar', 'Side banner', 'A tall banner beside search results and product pages on computers and tablets (not shown on phones).', 300, 600, 300, 'jpg,png,webp', 4000000, 4, true, 3)
ON CONFLICT ("key") DO NOTHING;
