// Shop-scoped customers. Orders and carts point at this table, so it is the first of the commerce tables to be reached.
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { shops, user } from '@shopnex/core/schema'
import { type CustomFieldValues } from '@shopnex/custom-fields/schema'

// Shop-scoped customer records. A guest (checkout without an account) and a customer who signs in are the same row:
// signing in proves the mailbox (customer_login_codes) and starts a customer_sessions row. `userId` is left over from
// when customers were staff-table users (GHSA-w9q2-8c32-gmhm): nothing writes it any more, and the migration clears it.
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
    // Values of the shop's custom fields (custom_field_definitions), by key
    customFields: jsonb('custom_fields').$type<CustomFieldValues>().notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customers_shop_email_idx').on(t.shopId, t.email)],
)

export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert

// One emailed sign-in code per shop and address: asking again replaces it. The shop is part of the key, so a code issued
// by one shop is worthless in another. Only a hash is stored.
export const customerLoginCodes = pgTable(
  'customer_login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_login_codes_shop_email_idx').on(t.shopId, t.email)],
)

// A signed-in customer of one shop. Not a Better Auth session: it never opens the admin or the /api/auth endpoints.
// The token is shown once to the storefront; only its hash is stored.
export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('customer_sessions_token_idx').on(t.tokenHash),
    index('customer_sessions_customer_idx').on(t.customerId),
  ],
)
