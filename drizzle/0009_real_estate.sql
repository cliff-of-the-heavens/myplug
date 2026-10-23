ALTER TYPE "public"."product_kind" ADD VALUE 'property';--> statement-breakpoint
CREATE TABLE "property_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "archive_when_sold_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "listing_type" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_type" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reserve_price_cents" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bidding_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bidding_notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "title_deed" boolean;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "property_features" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "property_offers" ADD CONSTRAINT "property_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_offers" ADD CONSTRAINT "property_offers_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_offers_product_customer_idx" ON "property_offers" USING btree ("product_id","customer_id");--> statement-breakpoint
CREATE INDEX "property_offers_product_idx" ON "property_offers" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "products_archived_idx" ON "products" USING btree ("archived_at") WHERE "archived_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "categories" ("name", "slug", "icon", "kind") VALUES
  ('Land for sale', 'land-for-sale', 'land', 'property'),
  ('Houses for sale', 'houses-for-sale', 'house', 'property'),
  ('Houses to rent', 'houses-to-rent', 'key', 'property'),
  ('Commercial property', 'commercial-property', 'building', 'property')
ON CONFLICT ("slug") DO NOTHING;
