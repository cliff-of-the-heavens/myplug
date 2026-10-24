CREATE TABLE "analytics_daily" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"ms" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_daily_day_metric_subject_pk" PRIMARY KEY("day","metric","subject")
);
--> statement-breakpoint
CREATE TABLE "analytics_monthly" (
	"month" date NOT NULL,
	"metric" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"ms" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_monthly_month_metric_subject_pk" PRIMARY KEY("month","metric","subject")
);
--> statement-breakpoint
CREATE TABLE "analytics_visitors" (
	"day" date NOT NULL,
	"visitor_id" text NOT NULL,
	CONSTRAINT "analytics_visitors_day_visitor_id_pk" PRIMARY KEY("day","visitor_id")
);
--> statement-breakpoint
CREATE TABLE "band_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"store_id" uuid NOT NULL,
	"band_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"payment_reference" text,
	"proof_url" text,
	"admin_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "band_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "listing_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"max_items" integer,
	"monthly_cents" bigint DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_store_monthly" (
	"month" date NOT NULL,
	"visitor_key" text NOT NULL,
	"user_id" uuid,
	"store_id" uuid NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visitor_store_monthly_month_visitor_key_store_id_pk" PRIMARY KEY("month","visitor_key","store_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "auto_details" jsonb;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "listing_band_id" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "band_paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "band_requests" ADD CONSTRAINT "band_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_requests" ADD CONSTRAINT "band_requests_band_id_listing_bands_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."listing_bands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_store_monthly" ADD CONSTRAINT "visitor_store_monthly_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_store_monthly" ADD CONSTRAINT "visitor_store_monthly_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "band_requests_store_idx" ON "band_requests" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "visitor_store_monthly_store_idx" ON "visitor_store_monthly" USING btree ("store_id","month");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_listing_band_id_listing_bands_id_fk" FOREIGN KEY ("listing_band_id") REFERENCES "public"."listing_bands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "listing_bands" ("name", "max_items", "monthly_cents", "is_default", "position") VALUES
  ('Starter', 25, 0, true, 0),
  ('Growth', 150, 1500000, false, 1),
  ('Business', 1000, 4000000, false, 2),
  ('Unlimited', NULL, 9000000, false, 3);
