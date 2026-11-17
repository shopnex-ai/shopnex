// The sales channels. The table stays here, with the foundation tables, while orders and carts (still in this package) point
// at it: a table in this package cannot import from a module that imports this package. It moves to @shopnex/channels once
// orders and cart are modules. What a channel shows (resource_publications) and its storefront keys are @shopnex/channels'.
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
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
