-- Видаляємо таблиці від попереднього варіанту на Prisma (етап 1, лише тестові дані).
DROP TABLE IF EXISTS "Client" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "User" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "Setting" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "_prisma_migrations" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "Role";--> statement-breakpoint
DROP TYPE IF EXISTS "Language";--> statement-breakpoint
DROP TYPE IF EXISTS "ClientStatus";--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('GUEST', 'ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('uk', 'ru');--> statement-breakpoint
CREATE TYPE "public"."price_kind" AS ENUM('SINGLE', 'PASS');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"phone" text,
	"status" "client_status" DEFAULT 'GUEST' NOT NULL,
	"goal" text,
	"experience" text,
	"health" text,
	"injuries" text,
	"consent_at" timestamp with time zone,
	"trainer_notes" text,
	"referred_by_client_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "price_kind" NOT NULL,
	"title_uk" text NOT NULL,
	"title_ru" text,
	"description_uk" text,
	"description_ru" text,
	"price_uah" integer NOT NULL,
	"sessions_count" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"language" "language" DEFAULT 'uk' NOT NULL,
	"first_name" text,
	"username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_referred_by_client_id_clients_id_fk" FOREIGN KEY ("referred_by_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;