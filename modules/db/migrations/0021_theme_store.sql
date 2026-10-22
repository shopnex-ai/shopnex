CREATE TABLE "marketplace_themes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"description" text,
	"developer_name" text NOT NULL,
	"base_theme_id" text NOT NULL,
	"screenshot_url" text,
	"document" jsonb NOT NULL,
	"listing_url" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_themes" ADD COLUMN "marketplace_theme_id" uuid;