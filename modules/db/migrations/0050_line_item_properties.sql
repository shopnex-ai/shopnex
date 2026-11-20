DROP INDEX "cart_lines_cart_variant_idx";--> statement-breakpoint
ALTER TABLE "cart_lines" ADD COLUMN "properties" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_lines" ADD COLUMN "properties_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "properties" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_lines_cart_variant_props_idx" ON "cart_lines" USING btree ("cart_id","variant_id","properties_key");