// The tables of this module that it owns. `pnpm db:generate` finds them through modules/*/src/*.schema.ts; the other
// order tables are still in modules/db and move here later. The migrations stay one history in modules/db/migrations.
import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { customers, discounts, orders } from '@shopnex/db/schema'

// One row per order that used a discount (usage counts, "once per customer"). It is orders' table: it points at the order and
// the customer, and at the discount, which @shopnex/pricing owns (orders depends on pricing, never the other way round).
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
