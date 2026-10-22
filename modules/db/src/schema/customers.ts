import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { shops } from './tenancy'

// Shop-scoped customer records. userId links a storefront login when there is one;
// guests (checkout without an account) have none.
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    name: text('name'),
    phone: text('phone'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customers_shop_email_idx').on(t.shopId, t.email)],
)

export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
