CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"tracking_company" text,
	"tracking_number" text,
	"tracking_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_shipping_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"title" text NOT NULL,
	"code" text,
	"price_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"gateway" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"external_id" text,
	"error_message" text,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"name" text NOT NULL,
	"additional_details" text,
	"instructions" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"free_above_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "storefront_url" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "next_order_number" integer DEFAULT 1001 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_number" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "financial_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_status" text DEFAULT 'unfulfilled' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_address" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "billing_address" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_gateway" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_instructions" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_shipping_lines" ADD CONSTRAINT "order_shipping_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_transactions" ADD CONSTRAINT "order_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fulfillments_order_idx" ON "fulfillments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_shipping_lines_order_idx" ON "order_shipping_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_transactions_order_idx" ON "order_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_methods_shop_idx" ON "payment_methods" USING btree ("shop_id","position");--> statement-breakpoint
CREATE INDEX "shipping_rates_shop_idx" ON "shipping_rates" USING btree ("shop_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_shop_number_idx" ON "orders" USING btree ("shop_id","order_number");--> statement-breakpoint
-- Backfill: the old single `status` (pending/paid/fulfilled/cancelled) becomes Shopify-style
-- financial + fulfillment status and cancellation. Cancelled unpaid orders are voided, as in Shopify.
UPDATE "orders" SET
	"financial_status" = CASE "status" WHEN 'paid' THEN 'paid' WHEN 'fulfilled' THEN 'paid' WHEN 'cancelled' THEN 'voided' ELSE 'pending' END,
	"fulfillment_status" = CASE "status" WHEN 'fulfilled' THEN 'fulfilled' ELSE 'unfulfilled' END,
	"cancelled_at" = CASE "status" WHEN 'cancelled' THEN "updated_at" END,
	"cancel_reason" = CASE "status" WHEN 'cancelled' THEN 'other' END,
	"payment_gateway" = 'manual';--> statement-breakpoint
-- Number existing orders per shop in creation order: #1001, #1002…
UPDATE "orders" o SET "order_number" = n.num
FROM (SELECT "id", 1000 + row_number() OVER (PARTITION BY "shop_id" ORDER BY "created_at", "id") AS num FROM "orders") n
WHERE o."id" = n."id";--> statement-breakpoint
UPDATE "shops" s SET "next_order_number" = COALESCE((SELECT max("order_number") + 1 FROM "orders" WHERE "shop_id" = s."id"), 1001);--> statement-breakpoint
-- History for orders that were already paid / fulfilled
INSERT INTO "order_transactions" ("order_id", "kind", "status", "gateway", "amount_cents", "currency", "processed_at")
SELECT "id", 'sale', 'success', 'manual', "total_cents", "currency", "updated_at" FROM "orders" WHERE "status" IN ('paid', 'fulfilled');--> statement-breakpoint
INSERT INTO "fulfillments" ("order_id", "status", "created_at")
SELECT "id", 'success', "updated_at" FROM "orders" WHERE "status" = 'fulfilled';
