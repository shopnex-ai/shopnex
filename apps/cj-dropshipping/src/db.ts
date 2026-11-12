// What the app remembers beyond per-shop settings: which ShopNex variant is which CJ variant, and what happened
// to each order it forwarded. Lives in the app's Postgres schema (shop data is capped at 100 keys); the tables are
// in schema.ts.
import { and, desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ShopContext } from '@shopnex/app'
import { orders, productStatus, variants } from './schema'

export type OrderStatus = 'pending' | 'created' | 'fulfilled' | 'failed'

export type ForwardedOrder = {
  orderId: string
  orderNumber: number
  cjOrderId: string | null
  status: OrderStatus
  error: string | null
  trackingNumber: string | null
  createdAt: string
}

export function openTables(db: NodePgDatabase) {
  const ofOrder = (s: ShopContext, orderId: string) =>
    and(eq(orders.instance, s.instance), eq(orders.shopId, s.shopId), eq(orders.orderId, orderId))

  return {
    saveVariant: async (s: ShopContext, sku: string, pid: string, vid: string) => {
      await db
        .insert(variants)
        .values({ instance: s.instance, shopId: s.shopId, sku, pid, vid })
        .onConflictDoUpdate({ target: [variants.instance, variants.shopId, variants.sku], set: { pid, vid } })
    },
    findVariant: async (s: ShopContext, sku: string) => {
      const [row] = await db
        .select({ pid: variants.pid, vid: variants.vid })
        .from(variants)
        .where(and(eq(variants.instance, s.instance), eq(variants.shopId, s.shopId), eq(variants.sku, sku)))
      return row as { pid: string; vid: string } | undefined
    },
    /** The shop SKUs the app has tied to each CJ product (imported or linked) */
    linkedSkus: async (s: ShopContext) => {
      const byPid = new Map<string, string[]>()
      const rows = await db
        .select({ pid: variants.pid, sku: variants.sku })
        .from(variants)
        .where(and(eq(variants.instance, s.instance), eq(variants.shopId, s.shopId)))
      for (const r of rows) byPid.set(r.pid, [...(byPid.get(r.pid) ?? []), r.sku])
      return byPid
    },
    /** Whether CJ still sells a product (checked when listing, or learned when an import fails) */
    setAvailable: async (s: ShopContext, pid: string, available: boolean) => {
      const checkedAt = Date.now()
      await db
        .insert(productStatus)
        .values({ instance: s.instance, shopId: s.shopId, pid, available, checkedAt })
        .onConflictDoUpdate({
          target: [productStatus.instance, productStatus.shopId, productStatus.pid],
          set: { available, checkedAt },
        })
    },
    availability: async (s: ShopContext) => {
      const rows = await db
        .select({ pid: productStatus.pid, available: productStatus.available, checkedAt: productStatus.checkedAt })
        .from(productStatus)
        .where(and(eq(productStatus.instance, s.instance), eq(productStatus.shopId, s.shopId)))
      return new Map(rows.map((r) => [r.pid, { available: r.available, checkedAt: r.checkedAt }]))
    },
    /** True when this call took the order: false when it is already being (or has been) forwarded */
    claimOrder: async (s: ShopContext, orderId: string, orderNumber: number) => {
      // A failed order is picked up again; a new one is recorded; anything else is already handled
      const retried = await db
        .update(orders)
        .set({ status: 'pending', error: null })
        .where(and(ofOrder(s, orderId), eq(orders.status, 'failed')))
        .returning({ id: orders.orderId })
      if (retried.length === 1) return true
      const claimed = await db
        .insert(orders)
        .values({ instance: s.instance, shopId: s.shopId, orderId, orderNumber, status: 'pending' })
        .onConflictDoNothing()
        .returning({ id: orders.orderId })
      return claimed.length === 1
    },
    setOrder: async (
      s: ShopContext,
      orderId: string,
      status: OrderStatus,
      fields: { error?: string; cjOrderId?: string; trackingNumber?: string } = {},
    ) => {
      await db
        .update(orders)
        .set({
          status,
          error: fields.error ?? null,
          cjOrderId: sql`coalesce(${fields.cjOrderId ?? null}, ${orders.cjOrderId})`,
          trackingNumber: sql`coalesce(${fields.trackingNumber ?? null}, ${orders.trackingNumber})`,
        })
        .where(ofOrder(s, orderId))
    },
    dropOrder: async (s: ShopContext, orderId: string) => {
      await db.delete(orders).where(ofOrder(s, orderId))
    },
    orders: async (s: ShopContext, limit = 25): Promise<ForwardedOrder[]> => {
      const rows = await db
        .select()
        .from(orders)
        .where(and(eq(orders.instance, s.instance), eq(orders.shopId, s.shopId)))
        .orderBy(desc(orders.orderNumber))
        .limit(limit)
      return rows.map((r) => ({
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        cjOrderId: r.cjOrderId,
        status: r.status as OrderStatus,
        error: r.error,
        trackingNumber: r.trackingNumber,
        createdAt: r.createdAt,
      }))
    },
    awaitingTracking: async (s: ShopContext) => {
      const rows = await db
        .select({ order_id: orders.orderId, cj_order_id: orders.cjOrderId })
        .from(orders)
        .where(and(eq(orders.instance, s.instance), eq(orders.shopId, s.shopId), eq(orders.status, 'created')))
      return rows as { order_id: string; cj_order_id: string }[]
    },
    shopsAwaitingTracking: async () => {
      const rows = await db
        .selectDistinct({ instance: orders.instance, shop_id: orders.shopId })
        .from(orders)
        .where(eq(orders.status, 'created'))
      return rows as { instance: string; shop_id: string }[]
    },
  }
}

export type Tables = ReturnType<typeof openTables>
