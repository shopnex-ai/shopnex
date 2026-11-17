// What the content tests share: the embedded database and a few rows. Importing this file picks the database, so it must come
// before anything imports @shopnex/db.
import type { MenuItemType, StoredMenuItem } from '@shopnex/db/schema'

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
const made = { products: [] as string[], collections: [] as string[] }

export async function otherShop() {
  await db
    .insert(schema.shops)
    .values({ id: OTHER_SHOP, name: 'Other shop', slug: `other-${unique()}` })
    .onConflictDoNothing()
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
  await db.delete(schema.menus).where(inArray(schema.menus.shopId, shops))
  await db.delete(schema.pages).where(inArray(schema.pages.shopId, shops))
  if (made.products.length) await db.delete(schema.products).where(inArray(schema.products.id, made.products))
  if (made.collections.length)
    await db.delete(schema.collections).where(inArray(schema.collections.id, made.collections))
  made.products.length = 0
  made.collections.length = 0
}
