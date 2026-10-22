DROP INDEX "shop_themes_shop_theme_idx";--> statement-breakpoint
ALTER TABLE "shop_themes" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "shop_themes" ADD COLUMN "role" text DEFAULT 'unpublished' NOT NULL;--> statement-breakpoint
-- Existing customizations: named after their theme id ("maison" → "Maison"). Each shop's live theme is
-- the one edited last: the editor only opened the theme the storefront ran, so that's most likely it.
UPDATE "shop_themes" SET "name" = initcap(replace(replace("theme_id", '-', ' '), '_', ' '));--> statement-breakpoint
UPDATE "shop_themes" SET "role" = 'live' WHERE "id" IN (
	SELECT DISTINCT ON ("shop_id") "id" FROM "shop_themes" ORDER BY "shop_id", "updated_at" DESC
);--> statement-breakpoint
ALTER TABLE "shop_themes" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "shop_themes_shop_idx" ON "shop_themes" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_themes_live_idx" ON "shop_themes" USING btree ("shop_id") WHERE "shop_themes"."role" = 'live';
