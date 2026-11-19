// The app's tables, in its own Postgres schema next to ShopNex's: review requests (one per fulfilled product, with a
// secret link) and the reviews that come back. Rows are scoped to a shop of an instance: this app serves many ShopNex
// instances. Change them here, then `pnpm generate` writes the migration into ./drizzle; the app applies it on start.
import { bigint, boolean, check, index, integer, pgSchema, text, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const SCHEMA = 'app_reviews'
const reviewsSchema = pgSchema(SCHEMA)

export const reviewRequests = reviewsSchema.table(
  'review_requests',
  {
    token: text().primaryKey(),
    instance: text().notNull(),
    shopId: text('shop_id').notNull(),
    orderId: text('order_id').notNull(),
    productId: text('product_id').notNull(),
    productTitle: text('product_title').notNull(),
    email: text().notNull(),
    sendAfter: bigint('send_after', { mode: 'number' }).notNull(),
    sentAt: bigint('sent_at', { mode: 'number' }),
    usedAt: bigint('used_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    // A webhook retry for the same order makes no second request
    unique('review_requests_order_product_key').on(t.instance, t.shopId, t.orderId, t.productId),
    index('review_requests_due_idx').on(t.sentAt, t.usedAt, t.sendAfter),
  ],
)

export const reviews = reviewsSchema.table(
  'reviews',
  {
    id: text().primaryKey(),
    instance: text().notNull(),
    shopId: text('shop_id').notNull(),
    // One review per link
    token: text().notNull().unique(),
    productId: text('product_id').notNull(),
    productTitle: text('product_title').notNull(),
    rating: integer().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    author: text().notNull(),
    verified: boolean().notNull(),
    status: text().notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    check('reviews_rating_range', sql`${t.rating} between 1 and 5`),
    index('reviews_product_idx').on(t.instance, t.shopId, t.productId, t.status),
  ],
)
