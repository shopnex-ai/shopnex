ALTER TABLE "shop_themes" ADD COLUMN "draft_files" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_themes" ADD COLUMN "draft_files_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "shop_themes" SET "draft_files" = "files", "draft_files_version" = "files_version";
