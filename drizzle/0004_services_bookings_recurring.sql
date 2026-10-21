CREATE TYPE "public"."payment_timing" AS ENUM('on_delivery', 'prepaid');--> statement-breakpoint
CREATE TYPE "public"."plan_frequency" AS ENUM('daily', 'weekdays', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'paused', 'cancelled', 'ended');--> statement-breakpoint
CREATE TYPE "public"."prepayment_status" AS ENUM('submitted', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."product_kind" AS ENUM('product', 'service');--> statement-breakpoint
ALTER TYPE "public"."store_status" ADD VALUE 'archived';--> statement-breakpoint
CREATE TABLE "plan_prepayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reference" text,
	"proof_url" text,
	"status" "prepayment_status" DEFAULT 'submitted' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"frequency" "plan_frequency" NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date,
	"next_run_on" date,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"payment_timing" "payment_timing" DEFAULT 'on_delivery' NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'MWK' NOT NULL,
	"shipping_address" text NOT NULL,
	"notes" text,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_plans_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "stock_alert_items" (
	"alert_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stock_alert_items_alert_id_product_id_pk" PRIMARY KEY("alert_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "stock_alerts" DROP CONSTRAINT "stock_alerts_product_id_products_id_fk";
--> statement-breakpoint
DROP INDEX "stock_alerts_product_idx";--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "submitted_reference" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "proof_url" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "kind" "product_kind" DEFAULT 'product' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_timing" "payment_timing" DEFAULT 'on_delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "booking_date" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kind" "product_kind" DEFAULT 'product' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "daily_capacity" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "references" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "deletion_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_prepayments" ADD CONSTRAINT "plan_prepayments_plan_id_recurring_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."recurring_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_plans" ADD CONSTRAINT "recurring_plans_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_plans" ADD CONSTRAINT "recurring_plans_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_plans" ADD CONSTRAINT "recurring_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alert_items" ADD CONSTRAINT "stock_alert_items_alert_id_stock_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."stock_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alert_items" ADD CONSTRAINT "stock_alert_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "recurring_plans_due_idx" ON "recurring_plans" USING btree ("status","next_run_on");--> statement-breakpoint
CREATE INDEX "recurring_plans_store_idx" ON "recurring_plans" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "stock_alert_items_product_idx" ON "stock_alert_items" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_recurring_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."recurring_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_booking_idx" ON "orders" USING btree ("store_id","booking_date");--> statement-breakpoint
CREATE INDEX "orders_plan_idx" ON "orders" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "products_kind_idx" ON "products" USING btree ("kind","is_active");--> statement-breakpoint
-- Existing single-product alerts become one-item alerts before the old column goes.
INSERT INTO "stock_alert_items" ("alert_id", "product_id", "position") SELECT "id", "product_id", 0 FROM "stock_alerts";--> statement-breakpoint
ALTER TABLE "stock_alerts" DROP COLUMN "product_id";--> statement-breakpoint
-- Service categories (bookable providers)
INSERT INTO "categories" ("name", "slug", "icon", "kind") VALUES
	('DJs & Music', 'djs-music', 'music', 'service'),
	('Decor & Events', 'decor-events', 'party', 'service'),
	('Cakes & Baking', 'cakes-baking', 'cake', 'service'),
	('Photography & Video', 'photography', 'camera', 'service'),
	('Catering', 'catering', 'chef', 'service'),
	('Hair & Makeup', 'hair-makeup', 'sparkles', 'service')
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
-- Admin-adjustable retention: archive inactive stores, then delete the accounts
INSERT INTO "settings" ("key", "value") VALUES
	('retention_enabled', 'true'),
	('retention_archive_months', '6'),
	('retention_delete_months', '12'),
	('retention_warning_days', '30'),
	('storage_backend', 'auto')
ON CONFLICT DO NOTHING;
