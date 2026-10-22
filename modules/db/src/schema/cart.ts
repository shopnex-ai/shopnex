import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { productVariants } from './catalog'
import { customers } from './customers'
import { orders } from './orders'
import { shops } from './tenancy'

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
  (t) => [index('carts_shop_idx').on(t.shopId)],
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
