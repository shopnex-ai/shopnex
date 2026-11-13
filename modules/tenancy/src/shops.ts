import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, isNotNull } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import { DEFAULT_SHOP_ID, ROOT_DOMAIN, isMultiTenant } from './config'
import { isSubdomainSlug, subdomainUrl } from './subdomains'

// Where a shop's storefront lives.
// - Multi mode: derived, never chosen. The shop's first verified domain (domains prove ownership), else its
//   <slug>.ROOT_DOMAIN address (when ROOT_DOMAIN is set), otherwise nothing is guessed. The stored column is ignored.
// - Single mode: the saved Storefront URL, else STOREFRONT_URL (`pnpm dev` sets it to the bundled storefront).
// `conn`: pass the transaction when called inside one. The multi mode reads the shop's domains, and a read on `db` inside
// a transaction waits for it for ever on the embedded database (one connection)
export async function withStorefrontUrl<T extends schema.Shop | null>(shop: T, conn: Conn = db): Promise<T> {
  if (!shop) return shop
  if (!isMultiTenant) {
    if (shop.storefrontUrl) return shop
    const fallback = process.env.STOREFRONT_URL?.trim().replace(/\/$/, '')
    return fallback ? { ...shop, storefrontUrl: fallback } : shop
  }
  const [domain] = await conn
    .select({ domain: schema.shopDomains.domain })
    .from(schema.shopDomains)
    .where(and(eq(schema.shopDomains.shopId, shop.id), isNotNull(schema.shopDomains.verifiedAt)))
    .orderBy(asc(schema.shopDomains.verifiedAt), asc(schema.shopDomains.id))
    .limit(1)
  if (domain) return { ...shop, storefrontUrl: `https://${domain.domain}` }
  const derived = ROOT_DOMAIN && isSubdomainSlug(shop.slug) ? subdomainUrl(shop.slug, ROOT_DOMAIN) : null
  return { ...shop, storefrontUrl: derived }
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
      | 'name'
      | 'currency'
      | 'storefrontUrl'
      | 'seoTitle'
      | 'seoDescription'
      | 'taxesIncluded'
      | 'taxShipping'
      | 'unpaidOrderExpiryHours'
    >
  >,
) {
  // Multi mode derives the Storefront URL from the shop's domains; a shop can't set its own
  const { storefrontUrl: _ignored, ...rest } = patch
  const values = isMultiTenant ? rest : patch
  if (Object.keys(values).length === 0) return getShopById(id)
  const [shop] = await db.update(schema.shops).set(values).where(eq(schema.shops.id, id)).returning()
  return withStorefrontUrl(shop ?? null)
}

export async function getShopById(id: string) {
  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, id))
  return withStorefrontUrl(shop ?? null)
}

export async function getFirstShop() {
  const [shop] = await db.select().from(schema.shops).orderBy(asc(schema.shops.createdAt)).limit(1)
  return withStorefrontUrl(shop ?? null)
}

export async function getShopBySlug(slug: string) {
  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.slug, slug))
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
