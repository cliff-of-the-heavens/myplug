ALTER TABLE "bills" ALTER COLUMN "amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "unit_price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "total_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "compare_at_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "amount_paid_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "budget_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "currency" text DEFAULT 'MWK' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "currency" text DEFAULT 'MWK' NOT NULL;