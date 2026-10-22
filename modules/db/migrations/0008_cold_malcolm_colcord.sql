ALTER TABLE "collections" ADD COLUMN "description_html" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "seo_description" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description_html" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "vendor" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seo_title" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "seo_description" text;--> statement-breakpoint
CREATE INDEX "products_shop_status_idx" ON "products" USING btree ("shop_id","status");--> statement-breakpoint
-- Hand-edited: Shopify's convention for the hidden default variant (themes check for it)
UPDATE "product_variants" SET "title" = 'Default Title' WHERE "options_key" = '';
