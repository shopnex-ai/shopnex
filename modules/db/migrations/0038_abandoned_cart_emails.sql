CREATE TABLE "abandoned_cart_settings" (
	"shop_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"delay_minutes" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"shop_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_shop_id_email_pk" PRIMARY KEY("shop_id","email")
);
--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "reminder_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "cart_id" uuid;--> statement-breakpoint
ALTER TABLE "abandoned_cart_settings" ADD CONSTRAINT "abandoned_cart_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_status_updated_idx" ON "carts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_cart_once_idx" ON "email_deliveries" USING btree ("cart_id","notification") WHERE "email_deliveries"."cart_id" is not null;