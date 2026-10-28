ALTER TABLE "reviews" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "transport_job_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "car_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_transport_job_id_transport_jobs_id_fk" FOREIGN KEY ("transport_job_id") REFERENCES "public"."transport_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_car_booking_id_car_bookings_id_fk" FOREIGN KEY ("car_booking_id") REFERENCES "public"."car_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_transport_job_idx" ON "reviews" USING btree ("transport_job_id","target_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_car_booking_idx" ON "reviews" USING btree ("car_booking_id","target_key");