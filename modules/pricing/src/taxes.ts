// Tax rates per country / province (admin: Settings → Taxes). Business logic only; every query is
// scoped by shopId. Whether prices include tax and whether shipping is taxed are shop settings.
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import { taxRateFor } from './calculate'
import { PricingError } from './pricing.errors'
import { taxRates, type TaxRate } from './pricing.schema'

type NewTaxRate = typeof taxRates.$inferInsert
export type TaxRateInput = Pick<NewTaxRate, 'countryCode' | 'province' | 'name' | 'ratePercent'>

export async function list(shopId: string, conn: Conn) {
  return conn
    .select()
    .from(taxRates)
    .where(eq(taxRates.shopId, shopId))
    .orderBy(asc(taxRates.countryCode), sql`${taxRates.province} nulls first`)
}

// The rate for a shipping address (null: no tax). Province-specific rates win over country-wide ones.
export async function rateForAddress(
  shopId: string,
  address: { countryCode: string; province?: string | null } | null | undefined,
  conn: Conn,
): Promise<TaxRate | null> {
  if (!address) return null
  const rates = await conn
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.shopId, shopId), eq(taxRates.countryCode, address.countryCode.toUpperCase())))
  return taxRateFor(rates, address)
}

// Only touches the keys present (patches stay patches)
function normalize<T extends Partial<TaxRateInput>>(r: T): T {
  const out = { ...r }
  if (r.countryCode !== undefined) out.countryCode = r.countryCode.toUpperCase()
  // Blank = the whole country
  if (r.province !== undefined) {
    const province = r.province?.trim()
    out.province = province === undefined || province === '' ? null : province
  }
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
    .select({ id: taxRates.id })
    .from(taxRates)
    .where(
      and(
        eq(taxRates.shopId, shopId),
        eq(taxRates.countryCode, r.countryCode),
        sql`coalesce(lower(${taxRates.province}), '') = ${r.province?.toLowerCase() ?? ''}`,
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

export async function create(shopId: string, input: TaxRateInput, conn: Conn) {
  const values = normalize(input)
  return conn.transaction(async (tx) => {
    await assertRegionFree(tx, shopId, values)
    const [rate] = await tx
      .insert(taxRates)
      .values({ ...values, shopId })
      .returning()
    if (!rate) throw new Error('The tax rate was not saved')
    return rate
  })
}

// Returns null when the rate isn't in this shop
export async function update(shopId: string, id: string, patch: Partial<TaxRateInput>, conn: Conn) {
  return conn.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(taxRates)
      .where(and(eq(taxRates.shopId, shopId), eq(taxRates.id, id)))
    if (!current) return null
    const values = normalize(patch)
    await assertRegionFree(tx, shopId, { ...current, ...values }, id)
    const [rate] = await tx
      .update(taxRates)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(taxRates.id, id))
      .returning()
    return rate ?? null
  })
}

// Orders keep their tax lines (snapshot)
export async function remove(shopId: string, id: string, conn: Conn) {
  const [rate] = await conn
    .delete(taxRates)
    .where(and(eq(taxRates.shopId, shopId), eq(taxRates.id, id)))
    .returning()
  return rate ?? null
}
