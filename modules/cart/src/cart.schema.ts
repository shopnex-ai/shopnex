// What a buyer is putting in, and what a shop offers at checkout. Carts point at orders, customers, channels and variants, which are
// still tables in @shopnex/db until their modules move; shipping rates and carrier services point at nothing but the shop and the app.
// email_deliveries (in @shopnex/email) points at carts, so email sits above this module.
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { channels, productVariants } from '@shopnex/db/schema'
import { apps, shops } from '@shopnex/core/schema'
import { orders } from '@shopnex/orders/schema'
import { customers } from '@shopnex/customers/schema'

export const CART_STATUSES = ['active', 'completed'] as const
export type CartStatus = (typeof CART_STATUSES)[number]

// Server-side cart. Storefronts hold only the token (an unguessable bearer value).
// Lines store variant + quantity only: prices are always read live from variants
// and snapshotted onto the order at checkout.
export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // The channel the buyer shops on: only what's published there can be added, and the order belongs to it
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    status: text('status').$type<CartStatus>().notNull().default('active'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    email: text('email'),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    // Entered by the buyer; may not be applicable (checked when the cart is shown and at checkout)
    discountCode: text('discount_code'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('carts_shop_idx').on(t.shopId), index('carts_status_updated_idx').on(t.status, t.updatedAt)],
)

export const cartLines = pgTable(
  'cart_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    // A variant deleted from the catalog disappears from carts
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cart_lines_cart_variant_idx').on(t.cartId, t.variantId)],
)

export type Cart = typeof carts.$inferSelect
export type CartLine = typeof cartLines.$inferSelect

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
