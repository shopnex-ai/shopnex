// The tables of this module. `pnpm db:generate` finds them through modules/*/src/*.schema.ts; the migrations stay one
// history in modules/db/migrations.
import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops } from '@shopnex/core/schema'

// Where a shop sells (Shopify: sales channels): the Online Store, a headless storefront, later POS and the like.
// What a channel shows is decided by resource_publications; storefront keys, carts and orders belong to one.
export const CHANNEL_TYPES = ['online_store', 'headless'] as const
export type ChannelType = (typeof CHANNEL_TYPES)[number]

// Every shop has this channel (created lazily, and by the migration for existing shops); it can't be deleted
export const DEFAULT_CHANNEL_HANDLE = 'online-store'

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // Unique per shop
    handle: text('handle').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<ChannelType>().notNull().default('headless'),
    // New products and collections are published here when they're created (as the Online Store does in Shopify)
    autoPublish: boolean('auto_publish').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('channels_shop_handle_idx').on(t.shopId, t.handle)],
)

export type Channel = typeof channels.$inferSelect

// Which resources each channel shows (Shopify: ResourcePublication). A resource is on a channel when it has a
// row here with published_at in the past (a future date schedules it); products also need status "active".
// Polymorphic like entity_drafts: resource_type says which table resource_id is in, so collections now and
// pages, menus or anything else later need no new table. There's no FK to the resource: the module that
// deletes it deletes its publications (publicationService.removeFor).
export const PUBLISHABLE_TYPES = ['product', 'collection'] as const
export type PublishableType = (typeof PUBLISHABLE_TYPES)[number]

export const resourcePublications = pgTable(
  'resource_publications',
  {
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').$type<PublishableType>().notNull(),
    resourceId: uuid('resource_id').notNull(),
    // With time zone: it's compared with now(), and JS dates and the database's clock must agree
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.resourceType, t.resourceId] }),
    index('resource_publications_resource_idx').on(t.resourceType, t.resourceId),
  ],
)

export type ResourcePublication = typeof resourcePublications.$inferSelect

// Publishable keys identify a shop for external storefronts (sent as x-shopnex-key).
// They are public (shipped in browser code): they select a shop, they don't grant extra access.
export const storefrontKeys = pgTable('storefront_keys', {
  id: text('id').primaryKey(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  token: text('token').notNull().unique(),
  // The channel this key reads: storefronts using it see what's published there
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
})

export type StorefrontKey = typeof storefrontKeys.$inferSelect
