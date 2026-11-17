import { menus, pages, type MenuItemType, type StoredMenuItem } from '../src/content.schema'
// What the content tests share: the embedded database and a few rows. Importing this file picks the database, so it must come
// before anything imports @shopnex/db.

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { menuService, pageService } = await import('../src')

export { db, schema, prepareDatabase, eq, menuService, pageService }
export const SHOP = 'default'
export const OTHER_SHOP = 'content-other-shop'

let counter = 0
export const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const made = { products: [] as string[], collections: [] as string[], shops: [] as string[], users: [] as string[] }

export async function otherShop() {
  await db
    .insert(schema.shops)
    .values({ id: OTHER_SHOP, name: 'Other shop', slug: `other-${unique()}` })
    .onConflictDoNothing()
}

export async function shop() {
  const id = `s-${unique()}`
  const [row] = await db.insert(schema.shops).values({ id, name: id, slug: id }).returning()
  made.shops.push(id)
  return row!
}

export async function user() {
  const id = `u-${unique()}`
  const [row] = await db
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@example.test` })
    .returning()
  made.users.push(id)
  return row!
}

export async function product(patch: Partial<typeof schema.products.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.products)
    .values({ shopId: SHOP, slug: `p-${unique()}`, title: 'Linen shirt', priceCents: 2500, ...patch })
    .returning()
  made.products.push(row!.id)
  return row!
}

export async function collection(patch: Partial<typeof schema.collections.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.collections)
    .values({ shopId: SHOP, slug: `c-${unique()}`, title: 'Summer', ...patch })
    .returning()
  made.collections.push(row!.id)
  return row!
}

/** A menu item, as the admin sends it */
export const item = (
  type: MenuItemType,
  extra: { resourceId?: string; url?: string | null; items?: StoredMenuItem[]; title?: string } = {},
): StoredMenuItem => ({ id: `i-${unique()}`, title: extra.title ?? type, type, items: [], ...extra })

/** Everything the tests made, and the menus and pages they caused */
export async function cleanup() {
  const shops = [SHOP, OTHER_SHOP]
  await db.delete(menus).where(inArray(menus.shopId, shops))
  await db.delete(pages).where(inArray(pages.shopId, shops))
  if (made.products.length) await db.delete(schema.products).where(inArray(schema.products.id, made.products))
  if (made.collections.length)
    await db.delete(schema.collections).where(inArray(schema.collections.id, made.collections))
  if (made.shops.length) await db.delete(schema.shops).where(inArray(schema.shops.id, made.shops))
  if (made.users.length) await db.delete(schema.user).where(inArray(schema.user.id, made.users))
  for (const list of Object.values(made)) list.length = 0
}
