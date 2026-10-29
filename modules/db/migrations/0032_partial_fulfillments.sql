CREATE TABLE "fulfillment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfillments" ADD COLUMN "shipment_status" text;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_fulfillment_id_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_items" ADD CONSTRAINT "fulfillment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fulfillment_items_fulfillment_idx" ON "fulfillment_items" USING btree ("fulfillment_id");--> statement-breakpoint
CREATE INDEX "fulfillment_items_order_item_idx" ON "fulfillment_items" USING btree ("order_item_id");--> statement-breakpoint
-- Until now a fulfillment shipped every item of its order: record that as its line items
INSERT INTO "fulfillment_items" ("fulfillment_id", "order_item_id", "quantity")
SELECT f."id", i."id", i."quantity"
FROM "fulfillments" f
JOIN "order_items" i ON i."order_id" = f."order_id"
WHERE f."status" = 'success';--> statement-breakpoint
UPDATE "fulfillments" SET "updated_at" = "created_at";
