CREATE TYPE "public"."delivery_method" AS ENUM('merchant', 'merchant_courier', 'courier', 'collection');--> statement-breakpoint
CREATE TYPE "public"."handover_type" AS ENUM('door', 'gate', 'reception', 'in_person', 'delegate');--> statement-breakpoint
CREATE TYPE "public"."license_kind" AS ENUM('primary', 'other');--> statement-breakpoint
CREATE TYPE "public"."license_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('video', 'audio', 'document');--> statement-breakpoint
CREATE TYPE "public"."offer_mode" AS ENUM('download', 'stream');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('invited', 'quoted', 'declined', 'accepted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."second_check" AS ENUM('none', 'phone', 'app');--> statement-breakpoint
CREATE TYPE "public"."store_delivery_mode" AS ENUM('merchant', 'merchant_courier', 'customer');--> statement-breakpoint
CREATE TYPE "public"."verify_method" AS ENUM('code', 'phrase');--> statement-breakpoint
ALTER TYPE "public"."product_kind" ADD VALUE 'digital';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'courier' BEFORE 'admin';--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"line1" text NOT NULL,
	"area" text NOT NULL,
	"city" text NOT NULL,
	"landmark" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" "license_kind" DEFAULT 'other' NOT NULL,
	"name" text NOT NULL,
	"number" text,
	"issuer" text,
	"issued_on" date,
	"expires_on" date,
	"document_key" text,
	"status" "license_status" DEFAULT 'pending' NOT NULL,
	"show_to_customers" boolean DEFAULT false NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"courier_id" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'invited' NOT NULL,
	"direct" boolean DEFAULT false NOT NULL,
	"estimate_cents" bigint,
	"quote_cents" bigint,
	"note" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courier_id" uuid NOT NULL,
	"area" text NOT NULL,
	"estimate_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "couriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"vehicle" text,
	"plate_number" text,
	"national_id_number" text,
	"face_photo_key" text,
	"id_document_key" text,
	"bio" text,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "couriers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digital_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"label" text NOT NULL,
	"mode" "offer_mode" NOT NULL,
	"access_days" integer,
	"max_views" integer,
	"views_used" integer DEFAULT 0 NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"activated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digital_grants_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "digital_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"label" text NOT NULL,
	"mode" "offer_mode" NOT NULL,
	"price_cents" bigint NOT NULL,
	"access_days" integer,
	"max_views" integer,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "kind" SET DATA TYPE text USING "kind"::text;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "kind" SET DEFAULT 'product';--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "method" "delivery_method" DEFAULT 'merchant' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "recipient_phone" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "handover" "handover_type" DEFAULT 'in_person' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "delegate_name" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "delegate_phone" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "courier_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "fee_cents" bigint;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "fee_paid_by" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "pickup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "collector_name" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "collector_phone" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "collector_id_number" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "collector_photo_key" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "verify_method" "verify_method" DEFAULT 'code' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "handover_code" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "phrase_hash" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "verify_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "second_check" "second_check" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "approval_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "approval_denied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "code_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "picked_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "pickup_verified_by_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "media_type" "media_type";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "media_key" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "media_name" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "preview_url" text;--> statement-breakpoint
ALTER TABLE "recurring_plans" ADD COLUMN "delivery_prefs" jsonb;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "delivery_mode" "store_delivery_mode" DEFAULT 'merchant' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "preferred_courier_id" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "pickup_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_licenses" ADD CONSTRAINT "business_licenses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_quotes" ADD CONSTRAINT "courier_quotes_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_quotes" ADD CONSTRAINT "courier_quotes_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_rates" ADD CONSTRAINT "courier_rates_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_grants" ADD CONSTRAINT "digital_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_grants" ADD CONSTRAINT "digital_grants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_grants" ADD CONSTRAINT "digital_grants_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_offers" ADD CONSTRAINT "digital_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_user_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "business_licenses_store_idx" ON "business_licenses" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_quotes_delivery_courier_idx" ON "courier_quotes" USING btree ("delivery_id","courier_id");--> statement-breakpoint
CREATE INDEX "courier_quotes_courier_idx" ON "courier_quotes" USING btree ("courier_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_rates_courier_area_idx" ON "courier_rates" USING btree ("courier_id","area");--> statement-breakpoint
CREATE INDEX "delivery_logs_delivery_idx" ON "delivery_logs" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE INDEX "digital_grants_user_idx" ON "digital_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pickup_verified_by_id_users_id_fk" FOREIGN KEY ("pickup_verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_preferred_courier_id_couriers_id_fk" FOREIGN KEY ("preferred_courier_id") REFERENCES "public"."couriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Digital product categories (category kind is plain text, so this is safe in the same migration as the enum change)
INSERT INTO "categories" ("name", "slug", "icon", "kind") VALUES
	('Videos & Films', 'videos', 'video', 'digital'),
	('Music & Audio', 'music-audio', 'headphones', 'digital'),
	('E-books & Documents', 'ebooks-documents', 'book', 'digital')
ON CONFLICT ("slug") DO NOTHING;
