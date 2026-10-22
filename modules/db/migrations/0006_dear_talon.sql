CREATE TABLE "product_option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_id" uuid NOT NULL,
	"value" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"options_key" text NOT NULL,
	"title" text NOT NULL,
	"sku" text,
	"price_cents" integer NOT NULL,
	"compare_at_price_cents" integer,
	"inventory_quantity" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_option_values" (
	"variant_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL,
	CONSTRAINT "variant_option_values_variant_id_option_value_id_pk" PRIMARY KEY("variant_id","option_value_id")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_title" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_product_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_option_value_id_product_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."product_option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_values_option_value_idx" ON "product_option_values" USING btree ("option_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "product_options_product_name_idx" ON "product_options" USING btree ("product_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_options_idx" ON "product_variants" USING btree ("product_id","options_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_shop_sku_idx" ON "product_variants" USING btree ("shop_id","sku") WHERE "product_variants"."sku" is not null;--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id","position");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-edited: every existing product gets its default variant at its current price
INSERT INTO "product_variants" ("shop_id", "product_id", "options_key", "title", "price_cents", "position", "created_at")
SELECT "shop_id", "id", '', 'Default', "price_cents", 0, "created_at" FROM "products";--> statement-breakpoint
-- Hand-edited: link existing order lines to their product's default variant
-- (variant_title/sku stay NULL: those orders predate variants)
UPDATE "order_items" oi SET "variant_id" = v."id"
FROM "product_variants" v
WHERE v."product_id" = oi."product_id" AND v."options_key" = '';
