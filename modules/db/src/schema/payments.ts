// Payment and refund sessions for payments apps (Shopify Payments Apps API). Shopnex creates a session for an
// amount it decides, sends it to the app, and the app resolves or rejects it through the Admin API. Only
// Shopnex changes the order: an app can say "paid" for a session, never for an arbitrary order or amount.
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { apps } from './apps'
import { paymentMethods } from './checkout'
import { orders, orderTransactions } from './orders'
import { shops } from './tenancy'

export const PAYMENT_SESSION_KINDS = ['payment', 'refund'] as const
export type PaymentSessionKind = (typeof PAYMENT_SESSION_KINDS)[number]

// pending → resolved | rejected | expired (Shopnex gives up waiting after expiresAt)
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
