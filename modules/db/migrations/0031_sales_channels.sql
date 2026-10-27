CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'headless' NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_publications" (
	"shop_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_publications_channel_id_resource_type_resource_id_pk" PRIMARY KEY("channel_id","resource_type","resource_id")
);
--> statement-breakpoint
ALTER TABLE "storefront_keys" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_publications" ADD CONSTRAINT "resource_publications_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_publications" ADD CONSTRAINT "resource_publications_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_shop_handle_idx" ON "channels" USING btree ("shop_id","handle");--> statement-breakpoint
-- Existing shops get the Online Store channel; everything they have so far belongs to it and stays published there
INSERT INTO "channels" ("shop_id", "handle", "name", "type", "auto_publish") SELECT "id", 'online-store', 'Online Store', 'online_store', true FROM "shops";--> statement-breakpoint
UPDATE "storefront_keys" SET "channel_id" = (SELECT "c"."id" FROM "channels" "c" WHERE "c"."shop_id" = "storefront_keys"."shop_id" AND "c"."handle" = 'online-store');--> statement-breakpoint
UPDATE "orders" SET "channel_id" = (SELECT "c"."id" FROM "channels" "c" WHERE "c"."shop_id" = "orders"."shop_id" AND "c"."handle" = 'online-store');--> statement-breakpoint
UPDATE "carts" SET "channel_id" = (SELECT "c"."id" FROM "channels" "c" WHERE "c"."shop_id" = "carts"."shop_id" AND "c"."handle" = 'online-store');--> statement-breakpoint
INSERT INTO "resource_publications" ("shop_id", "channel_id", "resource_type", "resource_id", "published_at") SELECT "p"."shop_id", "c"."id", 'product', "p"."id", "p"."created_at" FROM "products" "p" JOIN "channels" "c" ON "c"."shop_id" = "p"."shop_id" AND "c"."handle" = 'online-store';--> statement-breakpoint
INSERT INTO "resource_publications" ("shop_id", "channel_id", "resource_type", "resource_id", "published_at") SELECT "k"."shop_id", "c"."id", 'collection', "k"."id", "k"."created_at" FROM "collections" "k" JOIN "channels" "c" ON "c"."shop_id" = "k"."shop_id" AND "c"."handle" = 'online-store';--> statement-breakpoint
ALTER TABLE "storefront_keys" ALTER COLUMN "channel_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "channel_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" ALTER COLUMN "channel_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "resource_publications_resource_idx" ON "resource_publications" USING btree ("resource_type","resource_id");--> statement-breakpoint
ALTER TABLE "storefront_keys" ADD CONSTRAINT "storefront_keys_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;