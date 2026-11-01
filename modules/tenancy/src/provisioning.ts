import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'

const DEFAULT_CURRENCY = 'USD'

const baseSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'shop'

// "acme", then "acme-4f2a"… until it's free (the unique index still decides if two signups race)
async function uniqueSlug(conn: Pick<typeof db, 'select'>, name: string) {
  const base = baseSlug(name)
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`
    const [taken] = await conn.select({ id: schema.shops.id }).from(schema.shops).where(eq(schema.shops.slug, slug))
    if (!taken) return slug
  }
  return `${base}-${randomUUID().slice(0, 8)}`
}

/**
 * A new shop for `ownerId`, ready to take an order: the owner membership plus the checkout defaults a shop
 * can't sell without (one shipping rate, one manual payment method). The Online Store channel and the first
 * theme are created on first use, so they aren't touched here.
 */
export async function createShop(input: { ownerId: string; name: string; currency?: string }) {
  const name = input.name.trim()
  return db.transaction(async (tx) => {
    const id = randomUUID()
    const [shop] = await tx
      .insert(schema.shops)
      .values({ id, name, slug: await uniqueSlug(tx, name), currency: input.currency ?? DEFAULT_CURRENCY })
      .returning()
    await tx
      .insert(schema.shopMembers)
      .values({ id: randomUUID(), organizationId: id, userId: input.ownerId, role: 'owner' })
    await tx
      .insert(schema.shippingRates)
      .values({ shopId: id, name: 'Standard shipping', priceCents: 500, freeAboveCents: 5000 })
    await tx.insert(schema.paymentMethods).values({
      shopId: id,
      provider: 'manual',
      name: 'Cash on delivery',
      instructions: 'Pay the courier when your order arrives.',
    })
    return shop!
  })
}
