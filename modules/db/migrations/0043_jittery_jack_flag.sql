CREATE TABLE "shop_integrations" (
	"shop_id" text NOT NULL,
	"provider" text NOT NULL,
	"secret" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_integrations_shop_id_provider_pk" PRIMARY KEY("shop_id","provider")
);
--> statement-breakpoint
ALTER TABLE "carrier_services" ALTER COLUMN "app_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "carrier_services" ALTER COLUMN "rates_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_sessions" ALTER COLUMN "app_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "carrier_services" ADD COLUMN "provider" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_integrations" ADD CONSTRAINT "shop_integrations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_services_shop_provider_idx" ON "carrier_services" USING btree ("shop_id","provider") WHERE app_id is null;