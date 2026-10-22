// Modeled on Shopify's Order: separate financial and fulfillment status, cancellation as its own
// fact (cancelledAt), money totals split into subtotal/shipping/tax/discounts, address snapshots,
// shipping lines, payment transactions and fulfillments.
import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { products, productVariants } from './catalog'
import { customers } from './customers'
import { shops } from './tenancy'

// Shopify displayFinancialStatus (lowercase). Manual payments stay `pending` until marked as paid.
export const FINANCIAL_STATUSES = [
  'pending',
  'authorized',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
  'voided',
] as const
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number]

// Shopify displayFulfillmentStatus (subset: no holds/scheduling yet)
export const FULFILLMENT_STATUSES = ['unfulfilled', 'partially_fulfilled', 'fulfilled'] as const
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

// Shopify OrderCancelReason
export const CANCEL_REASONS = ['customer', 'declined', 'fraud', 'inventory', 'staff', 'other'] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

// Shopify MailingAddress. Stored as a snapshot on the order: later edits elsewhere never rewrite it.
export type MailingAddress = {
  firstName: string | null
  lastName: string | null
  company: string | null
  address1: string
  address2: string | null
  city: string
  /** State / province / region, free text */
  province: string | null
  /** ISO 3166-1 alpha-2, e.g. "US" */
  countryCode: string
  zip: string | null
  phone: string | null
}

// Shopify TaxLine, order level (one per rate charged)
export type TaxLine = { title: string; ratePercent: number; amountCents: number }

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // Per-shop sequence starting at 1001 (shops.next_order_number); shown as "#1001"
    orderNumber: integer('order_number').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    // Snapshot of the contact details at order time (customer record may change)
    email: text('email').notNull(),
    phone: text('phone'),
    financialStatus: text('financial_status').$type<FinancialStatus>().notNull().default('pending'),
    fulfillmentStatus: text('fulfillment_status').$type<FulfillmentStatus>().notNull().default('unfulfilled'),
    cancelledAt: timestamp('cancelled_at'),
    cancelReason: text('cancel_reason').$type<CancelReason>(),
    currency: text('currency').notNull().default('USD'),
    // totalCents = subtotal + shipping - discounts + tax (tax only when not already included in prices).
    // discountCents covers line discounts and shipping discounts; shippingCents is before discounts.
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    discountCents: integer('discount_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    // Snapshot of the shop setting: true when taxCents is part of the prices rather than added on top
    taxesIncluded: boolean('taxes_included').notNull().default(false),
    taxLines: jsonb('tax_lines').$type<TaxLine[]>().notNull().default([]),
    discountCodes: text('discount_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    shippingAddress: jsonb('shipping_address').$type<MailingAddress>(),
    billingAddress: jsonb('billing_address').$type<MailingAddress>(),
    // Payment method chosen at checkout, snapshotted (Shopify paymentGatewayNames + manual method details)
    paymentGateway: text('payment_gateway'),
    paymentMethodName: text('payment_method_name'),
    paymentInstructions: text('payment_instructions'),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('orders_shop_created_idx').on(t.shopId, t.createdAt),
    uniqueIndex('orders_shop_number_idx').on(t.shopId, t.orderNumber),
  ],
)

// Title/price are copied at order time so later catalog edits don't rewrite history
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    // Snapshots at order time
    variantTitle: text('variant_title'),
    sku: text('sku'),
    vendor: text('vendor'),
    imageUrl: text('image_url'),
    unitPriceCents: integer('unit_price_cents').notNull(),
    quantity: integer('quantity').notNull(),
    // Shopify LineItem.totalDiscount: this line's share of order discounts (for the whole quantity)
    discountCents: integer('discount_cents').notNull().default(0),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
)

// Shopify ShippingLine: the delivery method chosen at checkout, snapshotted
export const orderShippingLines = pgTable(
  'order_shipping_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // The shipping rate it came from (null once that rate is deleted)
    code: text('code'),
    priceCents: integer('price_cents').notNull(),
    // Free-shipping discount taken off this line
    discountCents: integer('discount_cents').notNull().default(0),
  },
  (t) => [index('order_shipping_lines_order_idx').on(t.orderId)],
)

// Shopify OrderTransaction
export const TRANSACTION_KINDS = ['sale', 'authorization', 'capture', 'refund', 'void'] as const
export type TransactionKind = (typeof TRANSACTION_KINDS)[number]
export const TRANSACTION_STATUSES = ['pending', 'success', 'failure', 'error'] as const
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]

export const orderTransactions = pgTable(
  'order_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TransactionKind>().notNull(),
    status: text('status').$type<TransactionStatus>().notNull(),
    // 'manual' for manual payment methods; provider name (e.g. 'stripe') otherwise
    gateway: text('gateway').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    // Provider's reference (payment intent, charge id…)
    externalId: text('external_id'),
    errorMessage: text('error_message'),
    processedAt: timestamp('processed_at').notNull().defaultNow(),
  },
  (t) => [index('order_transactions_order_idx').on(t.orderId)],
)

// Shopify Fulfillment (all items of the order for now; per-line quantities come with partial fulfillment)
export const FULFILLMENT_RECORD_STATUSES = ['success', 'cancelled'] as const
export type FulfillmentRecordStatus = (typeof FULFILLMENT_RECORD_STATUSES)[number]

export const fulfillments = pgTable(
  'fulfillments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: text('status').$type<FulfillmentRecordStatus>().notNull().default('success'),
    trackingCompany: text('tracking_company'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('fulfillments_order_idx').on(t.orderId)],
)

export type Order = typeof orders.$inferSelect
export type OrderItem = typeof orderItems.$inferSelect
export type OrderShippingLine = typeof orderShippingLines.$inferSelect
export type OrderTransaction = typeof orderTransactions.$inferSelect
export type Fulfillment = typeof fulfillments.$inferSelect
