// Discount codes (admin: Discounts). Business logic only; every query is scoped by shopId.
// One code per order. Usage is recorded when an order is placed (see redeem), under the discount's row lock.
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { Discount, NewDiscount } from '@shopnex/db/schema'
import { PricingError } from './errors'

export type DiscountInput = Pick<
  NewDiscount,
  'code' | 'type' | 'value' | 'minSubtotalCents' | 'usageLimit' | 'oncePerCustomer' | 'active' | 'startsAt' | 'endsAt'
>

const byCode = (shopId: string, code: string) =>
  and(eq(schema.discounts.shopId, shopId), sql`lower(${schema.discounts.code}) = ${code.trim().toLowerCase()}`)

export async function list(shopId: string, conn: Conn = db) {
  return conn
    .select()
    .from(schema.discounts)
    .where(eq(schema.discounts.shopId, shopId))
    .orderBy(desc(schema.discounts.createdAt))
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.discounts)
    .where(and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.id, id)))
  return row ?? null
}

// Case-insensitive; null when the shop has no such code
export async function findByCode(shopId: string, code: string, conn: Conn = db) {
  const [row] = await conn.select().from(schema.discounts).where(byCode(shopId, code))
  return row ?? null
}

// Cross-field rules the column types can't express. free_shipping carries no value.
function normalize<T extends Partial<DiscountInput>>(d: T & Pick<DiscountInput, 'type' | 'value'>): T {
  if (d.type === 'percentage' && (d.value == null || d.value < 1 || d.value > 100)) {
    throw new PricingError('INVALID_DISCOUNT', 'A percentage discount takes a value from 1 to 100')
  }
  if (d.type === 'fixed_amount' && (d.value == null || d.value < 1)) {
    throw new PricingError('INVALID_DISCOUNT', 'A fixed amount discount takes a value above 0')
  }
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) {
    throw new PricingError('INVALID_DISCOUNT', 'The end date must be after the start date')
  }
  return { ...d, code: d.code?.trim(), value: d.type === 'free_shipping' ? 0 : d.value }
}

async function assertCodeFree(conn: Conn, shopId: string, code: string, exceptId?: string) {
  const existing = await findByCode(shopId, code, conn)
  if (existing && existing.id !== exceptId) {
    throw new PricingError('CODE_TAKEN', `Code "${code.trim()}" is already used by another discount`)
  }
}

export async function create(shopId: string, input: DiscountInput) {
  const values = normalize(input)
  return db.transaction(async (tx) => {
    await assertCodeFree(tx, shopId, values.code)
    const [row] = await tx
      .insert(schema.discounts)
      .values({ ...values, shopId })
      .returning()
    return row!
  })
}

// Returns null when the discount isn't in this shop
export async function update(shopId: string, id: string, patch: Partial<DiscountInput>) {
  return db.transaction(async (tx) => {
    const current = await getById(shopId, id, tx)
    if (!current) return null
    const values = normalize({ ...current, ...patch })
    if (patch.code !== undefined) await assertCodeFree(tx, shopId, values.code, id)
    const [row] = await tx
      .update(schema.discounts)
      .set({
        code: values.code,
        type: values.type,
        value: values.value,
        minSubtotalCents: values.minSubtotalCents,
        usageLimit: values.usageLimit,
        oncePerCustomer: values.oncePerCustomer,
        active: values.active,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.discounts.id, id))
      .returning()
    return row!
  })
}

// Orders keep the code (discountCodes snapshot); their redemption rows go with the discount
export async function remove(shopId: string, id: string) {
  const [row] = await db
    .delete(schema.discounts)
    .where(and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.id, id)))
    .returning()
  return row ?? null
}

export async function removeMany(shopId: string, ids: string[]) {
  if (!ids.length) return 0
  const deleted = await db
    .delete(schema.discounts)
    .where(and(eq(schema.discounts.shopId, shopId), inArray(schema.discounts.id, ids)))
    .returning({ id: schema.discounts.id })
  return deleted.length
}

/** Why a discount can't be used right now (null = it can). Not about the cart: see calculate's minimum subtotal. */
export function unavailableReason(d: Discount, now = new Date()): string | null {
  if (!d.active || (d.startsAt && d.startsAt > now) || (d.endsAt && d.endsAt <= now)) {
    return `Discount code "${d.code}" isn't active`
  }
  if (d.usageLimit != null && d.usageCount >= d.usageLimit)
    return `Discount code "${d.code}" has reached its usage limit`
  return null
}

// For placing an order: locks the discount row (concurrent orders using the code queue here, so the
// usage limit and "once per customer" hold), then checks it. Returns the discount or why it can't be used.
export async function checkForOrder(
  tx: Conn,
  shopId: string,
  code: string,
  customerId: string | null,
): Promise<{ discount: Discount; error: null } | { discount: null; error: string }> {
  const [discount] = await tx.select().from(schema.discounts).where(byCode(shopId, code)).for('update')
  if (!discount) return { discount: null, error: `Discount code "${code.trim()}" isn't valid` }
  const reason = unavailableReason(discount)
  if (reason) return { discount: null, error: reason }
  if (discount.oncePerCustomer && customerId) {
    const [used] = await tx
      .select({ id: schema.discountRedemptions.id })
      .from(schema.discountRedemptions)
      .where(
        and(
          eq(schema.discountRedemptions.discountId, discount.id),
          eq(schema.discountRedemptions.customerId, customerId),
        ),
      )
      .limit(1)
    if (used) return { discount: null, error: `Discount code "${discount.code}" was already used` }
  }
  return { discount, error: null }
}

// Records the use, in the order's transaction (after checkForOrder locked the row)
export async function redeem(tx: Conn, discount: Discount, order: { id: string; customerId: string | null }) {
  await tx
    .update(schema.discounts)
    .set({ usageCount: sql`${schema.discounts.usageCount} + 1` })
    .where(eq(schema.discounts.id, discount.id))
  await tx
    .insert(schema.discountRedemptions)
    .values({ discountId: discount.id, orderId: order.id, customerId: order.customerId })
}
