CREATE TABLE "app_storefront_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"app_id" uuid NOT NULL,
	"src" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_storefront_scripts" ADD CONSTRAINT "app_storefront_scripts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_storefront_scripts" ADD CONSTRAINT "app_storefront_scripts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_storefront_scripts_shop_app_src_idx" ON "app_storefront_scripts" USING btree ("shop_id","app_id","src");