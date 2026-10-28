CREATE TABLE "car_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"car_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"with_driver" boolean DEFAULT false NOT NULL,
	"total_cents" bigint NOT NULL,
	"note" text,
	"contact_phone" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"owner_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "car_bookings_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "hire_cars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courier_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"seats" integer DEFAULT 5 NOT NULL,
	"transmission" text,
	"daily_cents" bigint NOT NULL,
	"self_drive" boolean DEFAULT true NOT NULL,
	"driver_daily_cents" bigint,
	"location" text NOT NULL,
	"image_url" text,
	"images" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" text NOT NULL,
	"pickup" text NOT NULL,
	"dropoff" text,
	"when" timestamp with time zone,
	"until_date" date,
	"passengers" integer,
	"details" text DEFAULT '' NOT NULL,
	"image_url" text,
	"budget_cents" bigint,
	"contact_phone" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"courier_id" uuid,
	"price_cents" bigint,
	"booked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_jobs_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "transport_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"courier_id" uuid NOT NULL,
	"price_cents" bigint NOT NULL,
	"note" text,
	"status" text DEFAULT 'offered' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "couriers" ADD COLUMN "services" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "couriers" ADD COLUMN "vehicle_type" text;--> statement-breakpoint
ALTER TABLE "couriers" ADD COLUMN "capacity" text;--> statement-breakpoint
ALTER TABLE "car_bookings" ADD CONSTRAINT "car_bookings_car_id_hire_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."hire_cars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_bookings" ADD CONSTRAINT "car_bookings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_cars" ADD CONSTRAINT "hire_cars_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_jobs" ADD CONSTRAINT "transport_jobs_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_jobs" ADD CONSTRAINT "transport_jobs_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_offers" ADD CONSTRAINT "transport_offers_job_id_transport_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."transport_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_offers" ADD CONSTRAINT "transport_offers_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "car_bookings_car_idx" ON "car_bookings" USING btree ("car_id","start_date");--> statement-breakpoint
CREATE INDEX "car_bookings_customer_idx" ON "car_bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "hire_cars_courier_idx" ON "hire_cars" USING btree ("courier_id");--> statement-breakpoint
CREATE INDEX "transport_jobs_status_idx" ON "transport_jobs" USING btree ("status","type");--> statement-breakpoint
CREATE INDEX "transport_jobs_customer_idx" ON "transport_jobs" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_offers_job_courier_idx" ON "transport_offers" USING btree ("job_id","courier_id");