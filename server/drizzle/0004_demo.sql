ALTER TABLE "clients" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prices" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "slots" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;