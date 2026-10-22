ALTER TABLE "shop_themes" ADD COLUMN "files" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_themes" ADD COLUMN "files_version" integer DEFAULT 0 NOT NULL;