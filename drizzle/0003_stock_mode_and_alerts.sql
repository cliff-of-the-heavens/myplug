CREATE TYPE "public"."alert_type" AS ENUM('new_product', 'restock', 'discount');--> statement-breakpoint
CREATE TYPE "public"."alert_delivery_status" AS ENUM('pending', 'sending', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "alert_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "alert_type" NOT NULL,
	"message" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"new_products" boolean DEFAULT true NOT NULL,
	"restocks" boolean DEFAULT true NOT NULL,
	"discounts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "track_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "alerts_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_id_stock_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."stock_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_deliveries_alert_user_idx" ON "alert_deliveries" USING btree ("alert_id","user_id");--> statement-breakpoint
CREATE INDEX "alert_deliveries_status_idx" ON "alert_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stock_alerts_store_idx" ON "stock_alerts" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_alerts_product_idx" ON "stock_alerts" USING btree ("product_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "store_subscriptions_user_store_idx" ON "store_subscriptions" USING btree ("user_id","store_id");--> statement-breakpoint
CREATE INDEX "store_subscriptions_store_idx" ON "store_subscriptions" USING btree ("store_id");--> statement-breakpoint
-- Admin limits for merchant-triggered alerts (editable under Admin > Email alerts)
INSERT INTO "settings" ("key", "value") VALUES
	('alerts_enabled', 'true'),
	('alerts_weekly_limit', '3'),
	('alerts_cooldown_days', '7'),
	('alerts_min_discount_pct', '10')
ON CONFLICT DO NOTHING;
