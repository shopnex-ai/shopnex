import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, ilike, isNotNull, or } from 'drizzle-orm'
import { db, type Conn } from '@shopnex/db'
import { DEFAULT_SHOP_ID, ROOT_DOMAIN, isMultiTenant } from './config'
import { isSubdomainSlug, subdomainUrl } from './subdomains'
import { canonicalLanguage } from '@shopnex/languages/contract'
import { likePattern } from './platform'
import { shopDomains, shopMembers } from './tenancy.schema'
import { type Shop, shops } from '@shopnex/core/schema'

// Where a shop's storefront lives.
// - Multi mode: derived, never chosen. The shop's first verified domain (domains prove ownership), else its
//   <slug>.ROOT_DOMAIN address (when ROOT_DOMAIN is set), otherwise nothing is guessed. The stored column is ignored.
// - Single mode: the saved Storefront URL, else STOREFRONT_URL (`pnpm dev` sets it to the bundled storefront).
// `conn`: pass the transaction when called inside one. The multi mode reads the shop's domains, and a read on `db` inside
// a transaction waits for it for ever on the embedded database (one connection)
export async function withStorefrontUrl<T extends Shop | null>(shop: T, conn: Conn = db): Promise<T> {
  if (!shop) return shop
  if (!isMultiTenant) {
    if (shop.storefrontUrl) return shop
    const fallback = process.env.STOREFRONT_URL?.trim().replace(/\/$/, '')
    return fallback ? { ...shop, storefrontUrl: fallback } : shop
  }
  const [domain] = await conn
    .select({ domain: shopDomains.domain })
    .from(shopDomains)
    .where(and(eq(shopDomains.shopId, shop.id), isNotNull(shopDomains.verifiedAt)))
    .orderBy(asc(shopDomains.verifiedAt), asc(shopDomains.id))
    .limit(1)
  if (domain) return { ...shop, storefrontUrl: `https://${domain.domain}` }
  const derived = ROOT_DOMAIN && isSubdomainSlug(shop.slug) ? subdomainUrl(shop.slug, ROOT_DOMAIN) : null
  return { ...shop, storefrontUrl: derived }
}

let defaultShopCreated: Promise<void> | undefined

// Idempotent; the insert runs once per process (the migration also creates it). The row itself is
// read every time, since name/currency can be edited in the admin.
export async function ensureDefaultShop(): Promise<Shop> {
  defaultShopCreated ??= db
    .insert(shops)
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
      Shop,
      | 'name'
      | 'currency'
      | 'language'
      | 'storefrontUrl'
      | 'seoTitle'
      | 'seoDescription'
      | 'taxesIncluded'
      | 'taxShipping'
      | 'unpaidOrderExpiryHours'
      | 'legalName'
      | 'businessAddress'
      | 'taxId'
      | 'cookieBanner'
      | 'customerAccounts'
      | 'shipToCountries'
    >
  >,
) {
  // Multi mode derives the Storefront URL from the shop's domains; a shop can't set its own
  const { storefrontUrl: _ignored, ...rest } = patch
  const values = isMultiTenant ? rest : patch
  if (values.language !== undefined) {
    const language = canonicalLanguage(values.language)
    if (!language) throw new Error(`"${values.language}" is not a language tag`)
    values.language = language
  }
  if (Object.keys(values).length === 0) return getShopById(id)
  const [shop] = await db.update(shops).set(values).where(eq(shops.id, id)).returning()
  return withStorefrontUrl(shop ?? null)
}

export async function getShopById(id: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, id))
  return withStorefrontUrl(shop ?? null)
}

export async function getFirstShop() {
  const [shop] = await db.select().from(shops).orderBy(asc(shops.createdAt)).limit(1)
  return withStorefrontUrl(shop ?? null)
}

export async function getShopBySlug(slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug))
  return withStorefrontUrl(shop ?? null)
}

export async function getShopByDomain(domain: string) {
  const [row] = await db
    .select({ shop: shops })
    .from(shopDomains)
    .innerJoin(shops, eq(shops.id, shopDomains.shopId))
    .where(and(eq(shopDomains.domain, domain.toLowerCase()), isNotNull(shopDomains.verifiedAt)))
  return withStorefrontUrl(row?.shop ?? null)
}

export async function getMembership(shopId: string, userId: string) {
  const [member] = await db
    .select()
    .from(shopMembers)
    .where(and(eq(shopMembers.organizationId, shopId), eq(shopMembers.userId, userId)))
  return member ?? null
}

export async function getFirstMembership(userId: string) {
  const [member] = await db
    .select()
    .from(shopMembers)
    .where(eq(shopMembers.userId, userId))
    .orderBy(asc(shopMembers.createdAt))
    .limit(1)
  return member ?? null
}

// First member of a shop becomes its owner
export async function addMember(shopId: string, userId: string) {
  const [{ value: existing } = { value: 0 }] = await db
    .select({ value: count() })
    .from(shopMembers)
    .where(eq(shopMembers.organizationId, shopId))
  await db
    .insert(shopMembers)
    .values({ id: randomUUID(), organizationId: shopId, userId, role: existing === 0 ? 'owner' : 'member' })
    .onConflictDoNothing()
}

const SWITCHER_LIMIT = 100

// The shops the admin's shop switcher offers: the user's own, or every shop for a super admin.
// `search` narrows them to a name or slug containing it, so a shop past the first 100 by name can still be found.
// Empty in single mode (there is one shop, nothing to switch).
export async function listSwitchableShops(userId: string, superAdmin: boolean, search?: string) {
  if (!isMultiTenant) return []
  const columns = { id: shops.id, name: shops.name }
  const term = search?.trim()
  const matches = term ? or(ilike(shops.name, likePattern(term)), ilike(shops.slug, likePattern(term))) : undefined
  if (superAdmin) return db.select(columns).from(shops).where(matches).orderBy(asc(shops.name)).limit(SWITCHER_LIMIT)
  return db
    .select(columns)
    .from(shops)
    .innerJoin(shopMembers, eq(shopMembers.organizationId, shops.id))
    .where(and(eq(shopMembers.userId, userId), matches))
    .orderBy(asc(shops.name))
    .limit(SWITCHER_LIMIT)
}

// Whether the user may act in the shop: a member, or a super admin (who acts in shops they aren't members of). False when the
// shop doesn't exist. Switching a session to it is @shopnex/auth's setActiveShop, which asks this.
export async function canActInShop(input: { userId: string; superAdmin: boolean; shopId: string }) {
  const allowed = input.superAdmin ? await getShopById(input.shopId) : await getMembership(input.shopId, input.userId)
  return Boolean(allowed)
}
