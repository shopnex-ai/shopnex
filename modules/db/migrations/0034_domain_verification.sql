ALTER TABLE "shop_domains" ADD COLUMN "verification_token" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_domains" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
-- Domains added before verification existed were set up by the operator by hand: keep them working
UPDATE "shop_domains" SET "verified_at" = now() WHERE "verified_at" IS NULL;
