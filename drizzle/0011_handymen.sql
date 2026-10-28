CREATE TABLE "store_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"comment" text,
	"status" "review_visibility" DEFAULT 'visible' NOT NULL,
	"flag_reason" text,
	"flagged_at" timestamp with time zone,
	"reply" text,
	"admin_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "category_group" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "is_tradesperson" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "trades" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "service_area" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "work_references" text;--> statement-breakpoint
ALTER TABLE "store_votes" ADD CONSTRAINT "store_votes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_votes" ADD CONSTRAINT "store_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_votes_store_user_idx" ON "store_votes" USING btree ("store_id","user_id");--> statement-breakpoint
CREATE INDEX "store_votes_status_idx" ON "store_votes" USING btree ("status");--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Handyman trades: service categories with their own "Handymen" main menu tab
INSERT INTO "categories" ("name", "slug", "icon", "kind", "category_group") VALUES
  ('Electronics repair', 'electronics-repair', 'cpu', 'service', 'handyman'),
  ('Carpentry & furniture', 'carpentry', 'hammer', 'service', 'handyman'),
  ('Metal work & welding', 'metal-work', 'anvil', 'service', 'handyman'),
  ('Mechanics', 'mechanics', 'wrench', 'service', 'handyman'),
  ('Plumbing', 'plumbing', 'shower', 'service', 'handyman'),
  ('Electrical wiring', 'electrical', 'zap', 'service', 'handyman'),
  ('Gardening & landscaping', 'gardening', 'shovel', 'service', 'handyman'),
  ('Cleaning', 'cleaning', 'spray', 'service', 'handyman')
ON CONFLICT ("slug") DO NOTHING;
