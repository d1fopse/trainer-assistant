CREATE TYPE "public"."booking_status" AS ENUM('BOOKED', 'ATTENDED', 'NO_SHOW', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('OPEN', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."slot_type" AS ENUM('INDIVIDUAL', 'GROUP');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"slot_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"status" "booking_status" DEFAULT 'BOOKED' NOT NULL,
	"is_trial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"weekdays" integer[] NOT NULL,
	"start_time" text NOT NULL,
	"duration_min" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"type" "slot_type" NOT NULL,
	"capacity" integer NOT NULL,
	"status" "slot_status" DEFAULT 'OPEN' NOT NULL,
	"series_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_active_unique" ON "bookings" USING btree ("slot_id","client_id") WHERE "bookings"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_trial" ON "bookings" USING btree ("client_id") WHERE "bookings"."is_trial" and "bookings"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX "bookings_client_idx" ON "bookings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "slots_starts_at_idx" ON "slots" USING btree ("starts_at");