import { randomUUID } from 'node:crypto'
import { and, asc, count, eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { DEFAULT_SHOP_ID } from './config'

let defaultShopCreated: Promise<void> | undefined

// Idempotent; the insert runs once per process (the migration also creates it). The row itself is
// read every time, since name/currency can be edited in the admin.
export async function ensureDefaultShop(): Promise<schema.Shop> {
  defaultShopCreated ??= db
    .insert(schema.shops)
    .values({ id: DEFAULT_SHOP_ID, name: process.env.DEFAULT_SHOP_NAME ?? 'My Shop', slug: DEFAULT_SHOP_ID })
    .onConflictDoNothing()
    .then(
      () => {},
      (error) => {
        defaultShopCreated = undefined
        throw error
      },
    )
  await defaultShopCreated
  return (await getShopById(DEFAULT_SHOP_ID))!
}

// Returns null when the shop doesn't exist
export async function updateShop(
  id: string,
  patch: Partial<Pick<schema.Shop, 'name' | 'currency' | 'storefrontUrl' | 'seoTitle' | 'seoDescription' | 'taxesIncluded' | 'taxShipping'>>,
) {
  const [shop] = await db.update(schema.shops).set(patch).where(eq(schema.shops.id, id)).returning()
  return shop ?? null
}

export async function getShopById(id: string) {
  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, id))
  return shop ?? null
}

export async function getFirstShop() {
  const [shop] = await db.select().from(schema.shops).orderBy(asc(schema.shops.createdAt)).limit(1)
  return shop ?? null
}

export async function getShopByDomain(domain: string) {
  const [row] = await db
    .select({ shop: schema.shops })
    .from(schema.shopDomains)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.shopDomains.shopId))
    .where(eq(schema.shopDomains.domain, domain.toLowerCase()))
  return row?.shop ?? null
}

export async function getMembership(shopId: string, userId: string) {
  const [member] = await db
    .select()
    .from(schema.shopMembers)
    .where(and(eq(schema.shopMembers.organizationId, shopId), eq(schema.shopMembers.userId, userId)))
  return member ?? null
}

export async function getFirstMembership(userId: string) {
  const [member] = await db
    .select()
    .from(schema.shopMembers)
    .where(eq(schema.shopMembers.userId, userId))
    .orderBy(asc(schema.shopMembers.createdAt))
    .limit(1)
  return member ?? null
}

// First member of a shop becomes its owner
export async function addMember(shopId: string, userId: string) {
  const [{ value: existing } = { value: 0 }] = await db
    .select({ value: count() })
    .from(schema.shopMembers)
    .where(eq(schema.shopMembers.organizationId, shopId))
  await db
    .insert(schema.shopMembers)
    .values({ id: randomUUID(), organizationId: shopId, userId, role: existing === 0 ? 'owner' : 'member' })
    .onConflictDoNothing()
}
