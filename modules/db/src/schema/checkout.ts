// What a shop offers at checkout. Modeled on Shopify's delivery method definitions (one zone for now:
// rates apply to every address), manual payment methods and payments apps.
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

// 'manual': paid outside Shopnex (bank transfer, cash on delivery…) and marked as paid by staff.
// 'app': a payments app (Stripe…) takes the payment; it registers the method itself (Shopify paymentsAppConfigure)
// and resolves payment sessions through the Admin API.
export const PAYMENT_PROVIDERS = ['manual', 'app'] as const
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number]

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<PaymentProvider>().notNull().default('manual'),
    // Shown at checkout, e.g. "Bank transfer"
    name: text('name').notNull(),
    // Shopify "additional details": shown when the buyer picks this method at checkout
    additionalDetails: text('additional_details'),
    // Shopify "payment instructions": shown after the order is placed (and copied onto the order)
    instructions: text('instructions'),
    active: boolean('active').notNull().default(true),
    position: integer('position').notNull().default(0),
    // Payments apps only: the app, its gateway name (snapshotted on orders as paymentGateway, e.g. "stripe")
    // and where payment / refund sessions are sent
    appId: uuid('app_id').references(() => apps.id, { onDelete: 'cascade' }),
    gateway: text('gateway'),
    // Set by the app (e.g. false until the merchant enters provider keys); checkout needs active and ready
    ready: boolean('ready').notNull().default(true),
    paymentSessionUrl: text('payment_session_url'),
    refundSessionUrl: text('refund_session_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('payment_methods_shop_idx').on(t.shopId, t.position),
    // One method per payments app and shop
    uniqueIndex('payment_methods_shop_app_idx').on(t.shopId, t.appId),
  ],
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
export type PaymentMethod = typeof paymentMethods.$inferSelect
