// What a shop offers at checkout: shipping rates (admin: Settings → Shipping). Payment methods are @shopnex/payments'.
// Business logic only; every query is scoped by shopId.
import { and, asc, eq } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'

type NewShippingRate = typeof schema.shippingRates.$inferInsert

export type ShippingRateInput = Pick<NewShippingRate, 'name' | 'priceCents' | 'freeAboveCents' | 'active'>

// --- shipping rates ---

export async function listShippingRates(shopId: string, opts: { activeOnly?: boolean } = {}, conn: Conn = db) {
  return conn
    .select()
    .from(schema.shippingRates)
    .where(
      and(eq(schema.shippingRates.shopId, shopId), opts.activeOnly ? eq(schema.shippingRates.active, true) : undefined),
    )
    .orderBy(asc(schema.shippingRates.position), asc(schema.shippingRates.createdAt))
}

export async function createShippingRate(shopId: string, input: ShippingRateInput) {
  const [rate] = await db
    .insert(schema.shippingRates)
    .values({ ...input, shopId })
    .returning()
  return rate!
}

// Returns null when the rate isn't in this shop
export async function updateShippingRate(shopId: string, id: string, patch: Partial<ShippingRateInput>) {
  const [rate] = await db
    .update(schema.shippingRates)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.shippingRates.shopId, shopId), eq(schema.shippingRates.id, id)))
    .returning()
  return rate ?? null
}

// Orders keep their shipping line (title/price snapshot)
export async function deleteShippingRate(shopId: string, id: string) {
  const [rate] = await db
    .delete(schema.shippingRates)
    .where(and(eq(schema.shippingRates.shopId, shopId), eq(schema.shippingRates.id, id)))
    .returning()
  return rate ?? null
}
