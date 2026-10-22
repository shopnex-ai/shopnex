CREATE TABLE "marketplace_connection" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"marketplace_url" text NOT NULL,
	"public_url" text NOT NULL,
	"pending_challenge" text,
	"instance_id" uuid,
	"instance_key" text,
	"connected_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "source" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "marketplace_app_id" uuid;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "developer_name" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "listing_url" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "delisted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_marketplace_app_id_unique" UNIQUE("marketplace_app_id");