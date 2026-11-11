// The app's tables, in its own Postgres schema. Change them here, then `pnpm generate` writes the migration into
// ./drizzle; the app applies it on start.
import { bigint, boolean, integer, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const SCHEMA = 'app_cj'
const cj = pgSchema(SCHEMA)

export const variants = cj.table(
  'cj_variants',
  {
    instance: text().notNull(),
    shopId: text('shop_id').notNull(),
    sku: text().notNull(),
    pid: text().notNull(),
    vid: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.instance, t.shopId, t.sku] })],
)

export const productStatus = cj.table(
  'cj_product_status',
  {
    instance: text().notNull(),
    shopId: text('shop_id').notNull(),
    pid: text().notNull(),
    available: boolean().notNull(),
    checkedAt: bigint('checked_at', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.instance, t.shopId, t.pid] })],
)

export const orders = cj.table(
  'cj_orders',
  {
    instance: text().notNull(),
    shopId: text('shop_id').notNull(),
    orderId: text('order_id').notNull(),
    orderNumber: integer('order_number').notNull(),
    cjOrderId: text('cj_order_id'),
    status: text().notNull(),
    error: text(),
    trackingNumber: text('tracking_number'),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.instance, t.shopId, t.orderId] })],
)
