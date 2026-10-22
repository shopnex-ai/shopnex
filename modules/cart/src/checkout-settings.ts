// What a shop offers at checkout: shipping rates and payment methods (admin: Settings → Shipping / Payments).
// Business logic only; every query is scoped by shopId.
import { and, asc, eq } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'

type NewShippingRate = typeof schema.shippingRates.$inferInsert
type NewPaymentMethod = typeof schema.paymentMethods.$inferInsert

export type ShippingRateInput = Pick<NewShippingRate, 'name' | 'priceCents' | 'freeAboveCents' | 'active'>
export type PaymentMethodInput = Pick<NewPaymentMethod, 'name' | 'additionalDetails' | 'instructions' | 'active'>

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

// --- payment methods ---

export async function listPaymentMethods(shopId: string, opts: { activeOnly?: boolean } = {}, conn: Conn = db) {
  return conn
    .select()
    .from(schema.paymentMethods)
    .where(
      and(
        eq(schema.paymentMethods.shopId, shopId),
        opts.activeOnly ? eq(schema.paymentMethods.active, true) : undefined,
        opts.activeOnly ? eq(schema.paymentMethods.ready, true) : undefined,
      ),
    )
    .orderBy(asc(schema.paymentMethods.position), asc(schema.paymentMethods.createdAt))
}

export async function createPaymentMethod(shopId: string, input: PaymentMethodInput) {
  const [method] = await db
    .insert(schema.paymentMethods)
    .values({ ...input, shopId, provider: 'manual' })
    .returning()
  return method!
}

export async function updatePaymentMethod(shopId: string, id: string, patch: Partial<PaymentMethodInput>) {
  const [method] = await db
    .update(schema.paymentMethods)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.paymentMethods.shopId, shopId), eq(schema.paymentMethods.id, id)))
    .returning()
  return method ?? null
}

// Orders keep the method's name and instructions (snapshot). A payments app's method goes when the app is
// uninstalled, not from here (it would just configure it again).
export async function deletePaymentMethod(shopId: string, id: string) {
  const [method] = await db
    .delete(schema.paymentMethods)
    .where(
      and(
        eq(schema.paymentMethods.shopId, shopId),
        eq(schema.paymentMethods.id, id),
        eq(schema.paymentMethods.provider, 'manual'),
      ),
    )
    .returning()
  return method ?? null
}
