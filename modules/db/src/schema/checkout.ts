// What a shop offers at checkout. Modeled on Shopify's delivery method definitions (one zone for now:
// rates apply to every address) and carrier apps; payment methods belong to @shopnex/payments.
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { apps } from './apps'
import { shops } from './tenancy'

export const shippingRates = pgTable(
  'shipping_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // Shown at checkout, e.g. "Standard shipping"
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull(),
    // Free when the order subtotal is at least this (Shopify: rate condition on order price). Null = never free.
    freeAboveCents: integer('free_above_cents'),
    active: boolean('active').notNull().default(true),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('shipping_rates_shop_idx').on(t.shopId, t.position)],
)

// Apps that quote shipping rates at checkout (Shopify CarrierService). One per app and shop; uninstalling the
// app removes it. Staff switch it off with `active`; the app with `ready`.
export const carrierServices = pgTable(
  'carrier_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    // Shown at checkout next to the rates it quotes, e.g. "CJ Dropshipping"
    name: text('name').notNull(),
    ratesUrl: text('rates_url').notNull(),
    active: boolean('active').notNull().default(true),
    ready: boolean('ready').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('carrier_services_shop_app_idx').on(t.shopId, t.appId)],
)

export type ShippingRate = typeof shippingRates.$inferSelect
export type CarrierService = typeof carrierServices.$inferSelect
