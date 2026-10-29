CREATE TABLE "carrier_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"app_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rates_url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"ready" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carrier_services" ADD CONSTRAINT "carrier_services_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_services" ADD CONSTRAINT "carrier_services_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_services_shop_app_idx" ON "carrier_services" USING btree ("shop_id","app_id");