// Discount codes and tax rates. Modeled on Shopify's basic code discounts (amount off the order,
// or free shipping) and manual tax rates per country / province.
import { sql } from 'drizzle-orm'
import { boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { customers } from './customers'
import { orders } from './orders'
import { shops } from './tenancy'

// percentage: `value` is a whole percent (1–100) off the subtotal; fixed_amount: `value` minor units off
// the subtotal; free_shipping: shipping costs nothing (`value` unused, 0)
export const DISCOUNT_TYPES = ['percentage', 'fixed_amount', 'free_shipping'] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]

export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    // What buyers type at checkout; matched case-insensitively
    code: text('code').notNull(),
    type: text('type').$type<DiscountType>().notNull(),
    value: integer('value').notNull().default(0),
    // Only applies when the order subtotal is at least this. Null = any subtotal.
    minSubtotalCents: integer('min_subtotal_cents'),
    // Total number of orders that can use it. Null = unlimited.
    usageLimit: integer('usage_limit'),
    usageCount: integer('usage_count').notNull().default(0),
    oncePerCustomer: boolean('once_per_customer').notNull().default(false),
    active: boolean('active').notNull().default(true),
    // Null = no start / end date
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('discounts_shop_code_idx').on(t.shopId, sql`lower(${t.code})`)],
)

// One row per order that used a discount (usage counts, "once per customer")
export const discountRedemptions = pgTable(
  'discount_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discountId: uuid('discount_id')
      .notNull()
      .references(() => discounts.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('discount_redemptions_discount_customer_idx').on(t.discountId, t.customerId)],
)

// The rate for the buyer's shipping address: a province-specific rate wins over the country-wide one
// (enter combined rates, e.g. 13% HST, as one rate).
export const taxRates = pgTable(
  'tax_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    /** ISO 3166-1 alpha-2, e.g. "DE" */
    countryCode: text('country_code').notNull(),
    // Free text matched case-insensitively against the address's province. Null = the whole country.
    province: text('province'),
    // Shown to buyers and on orders, e.g. "VAT"
    name: text('name').notNull(),
    // Percent, e.g. 8.875
    ratePercent: numeric('rate_percent', { precision: 7, scale: 4, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tax_rates_shop_region_idx').on(t.shopId, t.countryCode, sql`coalesce(lower(${t.province}), '')`),
  ],
)

export type Discount = typeof discounts.$inferSelect
export type NewDiscount = typeof discounts.$inferInsert
export type TaxRate = typeof taxRates.$inferSelect
