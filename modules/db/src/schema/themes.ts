// The shop's theme library (Online store → Themes). Each row is one copy of a theme the merchant can
// customize: the editor saves the draft, publishing copies it to `published` and makes the copy the live
// one, which is what storefronts render. A shop has at most one live copy; the rest are unpublished. The document format belongs to
// the Storefront API (ThemeDocument in @shopnex/storefront-sdk/theme); it's validated there, not here.
// `files` are the copy's code edits (Online store → Themes → Edit code): Liquid files that replace the
// theme's own or add snippets. Unlike the document they have no draft: a save applies to the copy right away.
import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from './tenancy'

export type ThemeRole = 'live' | 'unpublished'

type ThemeSettings = Record<string, string | number | boolean | null>
export type StoredThemeDocument = {
  preset?: string
  settings: ThemeSettings
  pages: Record<string, { sections: { id: string; type: string; disabled?: boolean; settings: ThemeSettings }[] }>
}

export const shopThemes = pgTable(
  'shop_themes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // The theme's own id (ThemeDefinition.id, e.g. "maison"); several copies can share it
    themeId: text('theme_id').notNull(),
    // The merchant's name for this copy
    name: text('name').notNull(),
    // Added from the Theme Store: the marketplace theme style it started from (no FK: the copy stays when the
    // style is delisted)
    marketplaceThemeId: uuid('marketplace_theme_id'),
    role: text('role').$type<ThemeRole>().notNull().default('unpublished'),
    draft: jsonb('draft').$type<StoredThemeDocument>().notNull(),
    // Null until first published (a live copy then shows the theme's defaults)
    published: jsonb('published').$type<StoredThemeDocument>(),
    publishedAt: timestamp('published_at'),
    // Edited Liquid by path in the theme ("snippets/header.liquid" → source)
    files: jsonb('files').$type<Record<string, string>>().notNull().default({}),
    // Published Liquid overrides; storefront buyers always read this set
    filesVersion: integer('files_version').notNull().default(0),
    // Autosaved code draft; editor previews read this set until the theme is published
    draftFiles: jsonb('draft_files').$type<Record<string, string>>().notNull().default({}),
    draftFilesVersion: integer('draft_files_version').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('shop_themes_shop_idx').on(t.shopId),
    uniqueIndex('shop_themes_live_idx')
      .on(t.shopId)
      .where(sql`${t.role} = 'live'`),
  ],
)

export type ShopTheme = typeof shopThemes.$inferSelect

// The Theme Store: theme styles synced from the connected marketplace (CatalogTheme in
// @shopnex/marketplace-sdk), for every shop. A style is a document for a theme storefronts include; adding one
// creates a shop_themes copy. Read-only here (the vendor edits it on the marketplace); styles gone from the
// catalog are deleted.
export const marketplaceThemes = pgTable('marketplace_themes', {
  // The style's id on the marketplace
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),
  description: text('description'),
  developerName: text('developer_name').notNull(),
  // The theme it styles (ThemeDefinition.id)
  baseThemeId: text('base_theme_id').notNull(),
  screenshotUrl: text('screenshot_url'),
  // Validated at sync; `code` settings are dropped when a shop adds it
  document: jsonb('document').$type<StoredThemeDocument>().notNull(),
  listingUrl: text('listing_url').notNull(),
  // The marketplace's last change
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
})

export type MarketplaceTheme = typeof marketplaceThemes.$inferSelect
