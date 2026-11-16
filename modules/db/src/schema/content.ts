// Online store content the merchant manages in the admin: pages (About, Shipping policy…) and navigation
// menus. Storefronts read them through the Storefront API (pages, menu.get), Shopify-style: by handle.
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from './tenancy'

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // URL segment: /pages/{handle} on Shopify-style storefronts
    handle: text('handle').notNull(),
    title: text('title').notNull(),
    // Sanitized on write; storefronts render it as is
    bodyHtml: text('body_html').notNull().default(''),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    // Null = hidden: not on the storefront (Shopify's visibility)
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pages_shop_handle_idx').on(t.shopId, t.handle)],
)

export type Page = typeof pages.$inferSelect

// What a menu item links to (Shopify MenuItemType, lowercase). collection / product / page point at a resource
// by id, so renaming its handle doesn't break the menu; http is any address.
export const MENU_ITEM_TYPES = ['frontpage', 'catalog', 'collection', 'product', 'page', 'search', 'http'] as const
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number]

/** Up to 3 levels (top level, and two below), like Shopify */
export const MENU_MAX_DEPTH = 3

export type StoredMenuItem = {
  /** Stable within the menu (the admin generates it) */
  id: string
  title: string
  type: MenuItemType
  /** collection / product / page */
  resourceId?: string | null
  /** http */
  url?: string | null
  items: StoredMenuItem[]
}

export const menus = pgTable(
  'menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // What storefronts ask for (main-menu, footer…)
    handle: text('handle').notNull(),
    title: text('title').notNull(),
    // Ordered tree; validated by the API layer (menuInput in @shopnex/api/schemas)
    items: jsonb('items').$type<StoredMenuItem[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('menus_shop_handle_idx').on(t.shopId, t.handle)],
)

export type Menu = typeof menus.$inferSelect

// A path that sends visitors somewhere else (Online store → Navigation → URL redirects). Created by the merchant,
// by an import, or when a product, collection or page changes its handle. `fromPath` is a path on the storefront
// ("/products/old"), `toPath` a path or a full URL. The storefront answers 301 when it would otherwise show a 404.
export const redirects = pgTable(
  'redirects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(),
    toPath: text('to_path').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('redirects_shop_from_idx').on(t.shopId, t.fromPath)],
)

export type Redirect = typeof redirects.$inferSelect
