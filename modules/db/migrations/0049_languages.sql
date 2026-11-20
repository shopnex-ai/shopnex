CREATE TABLE "shop_languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"field" text NOT NULL,
	"language" text NOT NULL,
	"value" text NOT NULL,
	"source_digest" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_languages" ADD CONSTRAINT "shop_languages_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_languages_code_idx" ON "shop_languages" USING btree ("shop_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "translations_field_idx" ON "translations" USING btree ("shop_id","resource","resource_id","field","language");--> statement-breakpoint
CREATE INDEX "translations_lookup_idx" ON "translations" USING btree ("shop_id","resource","language");