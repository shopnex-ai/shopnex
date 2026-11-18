// The tables of this module. `pnpm db:generate` finds them through modules/*/src/*.schema.ts; the migrations stay one
// history in modules/db/migrations.
// Payment methods (what a shop offers at checkout: manual ones and the one each payments app registers) and the
// payment and refund sessions for payments apps (Shopify Payments Apps API). ShopNex creates a session for an
// amount it decides, sends it to the app, and the app resolves or rejects it through the Admin API. Only
// ShopNex changes the order: an app can say "paid" for a session, never for an arbitrary order or amount.
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { apps, shops } from '@shopnex/core/schema'
import { orders, orderTransactions } from '@shopnex/orders/schema'

// 'manual': paid outside ShopNex (bank transfer, cash on delivery…) and marked as paid by staff.
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

export const PAYMENT_SESSION_KINDS = ['payment', 'refund'] as const
export type PaymentSessionKind = (typeof PAYMENT_SESSION_KINDS)[number]

// pending → resolved | rejected | expired (ShopNex gives up waiting after expiresAt)
export const PAYMENT_SESSION_STATUSES = ['pending', 'resolved', 'rejected', 'expired'] as const
export type PaymentSessionStatus = (typeof PAYMENT_SESSION_STATUSES)[number]

// timestamptz: the expiry sweep compares these with JS dates
export const paymentSessions = pgTable(
  'payment_sessions',
  {
    // Sent to the app as the session id; it passes it back to resolve / reject
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    // The method the buyer chose (retrying a payment sends it to the same app)
    paymentMethodId: uuid('payment_method_id').references(() => paymentMethods.id, { onDelete: 'set null' }),
    kind: text('kind').$type<PaymentSessionKind>().notNull(),
    status: text('status').$type<PaymentSessionStatus>().notNull().default('pending'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    // Payment: where the app sends the buyer to pay (from the app's response)
    redirectUrl: text('redirect_url'),
    // The provider's reference, given on resolve (payment intent, refund id…)
    externalId: text('external_id'),
    // Why it was rejected / expired, shown to staff
    errorMessage: text('error_message'),
    // Refund: the pending refund transaction it settles. Payment: the sale recorded when it resolved.
    transactionId: uuid('transaction_id').references(() => orderTransactions.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payment_sessions_order_idx').on(t.orderId, t.createdAt),
    index('payment_sessions_pending_idx').on(t.status, t.expiresAt),
  ],
)

export type PaymentSession = typeof paymentSessions.$inferSelect

export type PaymentMethod = typeof paymentMethods.$inferSelect
