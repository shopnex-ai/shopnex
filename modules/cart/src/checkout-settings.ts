// What a shop offers at checkout: shipping rates (admin: Settings → Shipping). Payment methods are @shopnex/payments'.
// Business logic only; every query is scoped by shopId.
import { and, asc, eq } from 'drizzle-orm'
import { db, type Conn } from '@shopnex/db'
import { shippingRates } from './cart.schema'

type NewShippingRate = typeof shippingRates.$inferInsert

export type ShippingRateInput = Pick<NewShippingRate, 'name' | 'priceCents' | 'freeAboveCents' | 'active'>

// --- shipping rates ---

export async function listShippingRates(shopId: string, opts: { activeOnly?: boolean } = {}, conn: Conn = db) {
  return conn
    .select()
    .from(shippingRates)
    .where(and(eq(shippingRates.shopId, shopId), opts.activeOnly ? eq(shippingRates.active, true) : undefined))
    .orderBy(asc(shippingRates.position), asc(shippingRates.createdAt))
}

export async function createShippingRate(shopId: string, input: ShippingRateInput) {
  const [rate] = await db
    .insert(shippingRates)
    .values({ ...input, shopId })
    .returning()
  return rate!
}

// Returns null when the rate isn't in this shop
export async function updateShippingRate(shopId: string, id: string, patch: Partial<ShippingRateInput>) {
  const [rate] = await db
    .update(shippingRates)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(shippingRates.shopId, shopId), eq(shippingRates.id, id)))
    .returning()
  return rate ?? null
}

// Orders keep their shipping line (title/price snapshot)
export async function deleteShippingRate(shopId: string, id: string) {
  const [rate] = await db
    .delete(shippingRates)
    .where(and(eq(shippingRates.shopId, shopId), eq(shippingRates.id, id)))
    .returning()
  return rate ?? null
}
