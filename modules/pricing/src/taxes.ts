// Tax rates per country / province (admin: Settings → Taxes). Business logic only; every query is
// scoped by shopId. Whether prices include tax and whether shipping is taxed are shop settings.
import { and, asc, eq, sql } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { TaxRate } from '@shopnex/db/schema'
import { taxRateFor } from './calculate'
import { PricingError } from './errors'

type NewTaxRate = typeof schema.taxRates.$inferInsert
export type TaxRateInput = Pick<NewTaxRate, 'countryCode' | 'province' | 'name' | 'ratePercent'>

export async function list(shopId: string, conn: Conn = db) {
  return conn
    .select()
    .from(schema.taxRates)
    .where(eq(schema.taxRates.shopId, shopId))
    .orderBy(asc(schema.taxRates.countryCode), sql`${schema.taxRates.province} nulls first`)
}

// The rate for a shipping address (null: no tax). Province-specific rates win over country-wide ones.
export async function rateForAddress(
  shopId: string,
  address: { countryCode: string; province?: string | null } | null | undefined,
  conn: Conn = db,
): Promise<TaxRate | null> {
  if (!address) return null
  const rates = await conn
    .select()
    .from(schema.taxRates)
    .where(and(eq(schema.taxRates.shopId, shopId), eq(schema.taxRates.countryCode, address.countryCode.toUpperCase())))
  return taxRateFor(rates, address)
}

// Only touches the keys present (patches stay patches)
function normalize<T extends Partial<TaxRateInput>>(r: T): T {
  const out = { ...r }
  if (r.countryCode !== undefined) out.countryCode = r.countryCode.toUpperCase()
  // Blank = the whole country
  if (r.province !== undefined) out.province = r.province?.trim() || null
  if (r.name !== undefined) out.name = r.name.trim()
  return out
}

async function assertRegionFree(
  conn: Conn,
  shopId: string,
  r: Pick<TaxRateInput, 'countryCode' | 'province'>,
  exceptId?: string,
) {
  const [existing] = await conn
    .select({ id: schema.taxRates.id })
    .from(schema.taxRates)
    .where(
      and(
        eq(schema.taxRates.shopId, shopId),
        eq(schema.taxRates.countryCode, r.countryCode),
        sql`coalesce(lower(${schema.taxRates.province}), '') = ${r.province?.toLowerCase() ?? ''}`,
      ),
    )
  if (existing && existing.id !== exceptId) {
    throw new PricingError(
      'TAX_RATE_EXISTS',
      r.province
        ? `There's already a rate for ${r.province}, ${r.countryCode}`
        : `There's already a rate for ${r.countryCode}`,
    )
  }
}

export async function create(shopId: string, input: TaxRateInput) {
  const values = normalize(input)
  return db.transaction(async (tx) => {
    await assertRegionFree(tx, shopId, values)
    const [rate] = await tx
      .insert(schema.taxRates)
      .values({ ...values, shopId })
      .returning()
    return rate!
  })
}

// Returns null when the rate isn't in this shop
export async function update(shopId: string, id: string, patch: Partial<TaxRateInput>) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.taxRates)
      .where(and(eq(schema.taxRates.shopId, shopId), eq(schema.taxRates.id, id)))
    if (!current) return null
    const values = normalize(patch)
    await assertRegionFree(tx, shopId, { ...current, ...values }, id)
    const [rate] = await tx
      .update(schema.taxRates)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.taxRates.id, id))
      .returning()
    return rate!
  })
}

// Orders keep their tax lines (snapshot)
export async function remove(shopId: string, id: string) {
  const [rate] = await db
    .delete(schema.taxRates)
    .where(and(eq(schema.taxRates.shopId, shopId), eq(schema.taxRates.id, id)))
    .returning()
  return rate ?? null
}
