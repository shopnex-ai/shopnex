import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, isNotNull } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { DEFAULT_SHOP_ID, isMultiTenant } from './config'

// Zero setup: a single shop that hasn't saved a Storefront URL uses STOREFRONT_URL (`pnpm dev` sets it to the
// bundled storefront). Multi-tenant shops each need their own, so nothing is guessed there.
export function withStorefrontUrl<T extends schema.Shop | null>(shop: T): T {
  const fallback = process.env.STOREFRONT_URL?.trim().replace(/\/$/, '')
  if (!shop || shop.storefrontUrl || isMultiTenant || !fallback) return shop
  return { ...shop, storefrontUrl: fallback }
}

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
  patch: Partial<
    Pick<
      schema.Shop,
      'name' | 'currency' | 'storefrontUrl' | 'seoTitle' | 'seoDescription' | 'taxesIncluded' | 'taxShipping'
    >
  >,
) {
  const [shop] = await db.update(schema.shops).set(patch).where(eq(schema.shops.id, id)).returning()
  return shop ?? null
}

export async function getShopById(id: string) {
  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, id))
  return withStorefrontUrl(shop ?? null)
}

export async function getFirstShop() {
  const [shop] = await db.select().from(schema.shops).orderBy(asc(schema.shops.createdAt)).limit(1)
  return withStorefrontUrl(shop ?? null)
}

export async function getShopByDomain(domain: string) {
  const [row] = await db
    .select({ shop: schema.shops })
    .from(schema.shopDomains)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.shopDomains.shopId))
    .where(and(eq(schema.shopDomains.domain, domain.toLowerCase()), isNotNull(schema.shopDomains.verifiedAt)))
  return withStorefrontUrl(row?.shop ?? null)
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

const SWITCHER_LIMIT = 100

// The shops the admin's shop switcher offers: the user's own, or every shop for a super admin.
// Empty in single mode (there is one shop, nothing to switch).
export async function listSwitchableShops(userId: string, superAdmin: boolean) {
  if (!isMultiTenant) return []
  const columns = { id: schema.shops.id, name: schema.shops.name }
  if (superAdmin) return db.select(columns).from(schema.shops).orderBy(asc(schema.shops.name)).limit(SWITCHER_LIMIT)
  return db
    .select(columns)
    .from(schema.shops)
    .innerJoin(schema.shopMembers, eq(schema.shopMembers.organizationId, schema.shops.id))
    .where(eq(schema.shopMembers.userId, userId))
    .orderBy(asc(schema.shops.name))
    .limit(SWITCHER_LIMIT)
}

// Makes `shopId` the session's active shop. False when the user may not act in it (not a member, and not a
// super admin) or it doesn't exist. Written to the session directly, since Better Auth's setActive requires
// membership and super admins act in shops they aren't members of.
export async function setActiveShop(input: { sessionId: string; userId: string; superAdmin: boolean; shopId: string }) {
  if (!isMultiTenant) return false
  const allowed = input.superAdmin ? await getShopById(input.shopId) : await getMembership(input.shopId, input.userId)
  if (!allowed) return false
  await db
    .update(schema.session)
    .set({ activeOrganizationId: input.shopId })
    .where(and(eq(schema.session.id, input.sessionId), eq(schema.session.userId, input.userId)))
  return true
}
