// Navigation menus (admin: Online store → Navigation). Business logic only; every query is scoped by shopId.
// Item trees are validated by the API layer (menuInput); here, collection and product links are checked to
// belong to the shop, and `resolve` turns them into storefront links.
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { StoredMenuItem } from '@shopnex/db/schema'
import { ContentError } from './errors'

export type MenuInput = { handle: string; title: string; items: StoredMenuItem[] }

export async function list(shopId: string, conn: Conn = db) {
  return conn.select().from(schema.menus).where(eq(schema.menus.shopId, shopId)).orderBy(asc(schema.menus.createdAt))
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.menus)
    .where(and(eq(schema.menus.shopId, shopId), eq(schema.menus.id, id)))
  return row ?? null
}

export async function getByHandle(shopId: string, handle: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.menus)
    .where(and(eq(schema.menus.shopId, shopId), eq(schema.menus.handle, handle)))
  return row ?? null
}

const flatten = (items: StoredMenuItem[]): StoredMenuItem[] => items.flatMap((i) => [i, ...flatten(i.items)])

type ResourceType = 'collection' | 'product' | 'page'

function resourceIds(items: StoredMenuItem[], type: ResourceType) {
  return [...new Set(flatten(items).flatMap((i) => (i.type === type && i.resourceId ? [i.resourceId] : [])))]
}

// Links may only point at this shop's collections, products and pages
async function assertResources(conn: Conn, shopId: string, items: StoredMenuItem[]) {
  for (const [type, table] of [
    ['collection', schema.collections],
    ['product', schema.products],
    ['page', schema.pages],
  ] as const) {
    const ids = resourceIds(items, type)
    if (!ids.length) continue
    const found = await conn
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.shopId, shopId), inArray(table.id, ids)))
    if (found.length !== ids.length) {
      throw new ContentError('RESOURCE_NOT_FOUND', `A menu item links to a ${type} that doesn't exist`)
    }
  }
}

async function assertHandleFree(conn: Conn, shopId: string, handle: string, exceptId?: string) {
  const existing = await getByHandle(shopId, handle, conn)
  if (existing && existing.id !== exceptId) {
    throw new ContentError('HANDLE_TAKEN', `Handle "${handle}" is already used by another menu`)
  }
}

export async function create(shopId: string, input: MenuInput) {
  return db.transaction(async (tx) => {
    await assertHandleFree(tx, shopId, input.handle)
    await assertResources(tx, shopId, input.items)
    const [row] = await tx
      .insert(schema.menus)
      .values({ shopId, handle: input.handle, title: input.title, items: input.items })
      .returning()
    return row!
  })
}

// Returns null when the menu isn't in this shop
export async function update(shopId: string, id: string, patch: Partial<MenuInput>) {
  return db.transaction(async (tx) => {
    if (!(await getById(shopId, id, tx))) return null
    if (patch.handle !== undefined) await assertHandleFree(tx, shopId, patch.handle, id)
    if (patch.items !== undefined) await assertResources(tx, shopId, patch.items)
    const [row] = await tx
      .update(schema.menus)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.menus.id, id))
      .returning()
    return row!
  })
}

export async function remove(shopId: string, id: string) {
  const [row] = await db
    .delete(schema.menus)
    .where(and(eq(schema.menus.shopId, shopId), eq(schema.menus.id, id)))
    .returning()
  return row ?? null
}

export type ResolvedMenuItem = Omit<StoredMenuItem, 'items' | 'url' | 'resourceId'> & {
  resourceId: string | null
  /** Storefront path (/collections/{handle}…) or the http address */
  url: string
  /** collection / product / page */
  handle: string | null
  items: ResolvedMenuItem[]
}

// Shopify's paths, so storefronts built for Shopify menus work as is
const PATHS = { frontpage: '/', catalog: '/collections/all', search: '/search' } as const

/**
 * The menu's items with links resolved for storefronts. Items pointing at a deleted collection, a product
 * that is gone or not active, or a page that is gone or hidden, are left out (with their sub-items), so
 * storefronts never show dead links.
 */
export async function resolve(shopId: string, items: StoredMenuItem[], conn: Conn = db): Promise<ResolvedMenuItem[]> {
  const collectionIds = resourceIds(items, 'collection')
  const productIds = resourceIds(items, 'product')
  const pageIds = resourceIds(items, 'page')
  const [collections, products, pages] = await Promise.all([
    collectionIds.length
      ? conn
          .select({ id: schema.collections.id, slug: schema.collections.slug })
          .from(schema.collections)
          .where(and(eq(schema.collections.shopId, shopId), inArray(schema.collections.id, collectionIds)))
      : [],
    productIds.length
      ? conn
          .select({ id: schema.products.id, slug: schema.products.slug })
          .from(schema.products)
          .where(
            and(
              eq(schema.products.shopId, shopId),
              eq(schema.products.status, 'active'),
              inArray(schema.products.id, productIds),
            ),
          )
      : [],
    pageIds.length
      ? conn
          .select({ id: schema.pages.id, slug: schema.pages.handle })
          .from(schema.pages)
          .where(
            and(
              eq(schema.pages.shopId, shopId),
              isNotNull(schema.pages.publishedAt),
              lte(schema.pages.publishedAt, new Date()),
              inArray(schema.pages.id, pageIds),
            ),
          )
      : [],
  ])
  const slugs = {
    collection: new Map(collections.map((c) => [c.id, c.slug])),
    product: new Map(products.map((p) => [p.id, p.slug])),
    page: new Map(pages.map((p) => [p.id, p.slug])),
  }
  const segment = { collection: 'collections', product: 'products', page: 'pages' } as const

  const walk = (list: StoredMenuItem[]): ResolvedMenuItem[] =>
    list.flatMap((item) => {
      const { items: children, url: _, ...rest } = item
      let url: string
      let handle: string | null = null
      if (item.type === 'collection' || item.type === 'product' || item.type === 'page') {
        handle = slugs[item.type].get(item.resourceId ?? '') ?? null
        if (!handle) return []
        url = `/${segment[item.type]}/${handle}`
      } else if (item.type === 'http') {
        if (!item.url) return []
        url = item.url
      } else {
        url = PATHS[item.type]
      }
      return [{ ...rest, resourceId: rest.resourceId ?? null, url, handle, items: walk(children) }]
    })
  return walk(items)
}
