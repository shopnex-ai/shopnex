ALTER TABLE "shops" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "language_code" text;