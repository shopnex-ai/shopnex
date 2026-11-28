// Navigation menus (admin: Online store → Navigation). Business logic only; every query is scoped by shopId.
// Item trees are validated by the API layer (menuInput); here, collection and product links are checked to
// belong to the shop, and `resolve` turns them into storefront links.
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { type Conn } from '@shopnex/db'
import { ContentError } from './content.errors'
import { menus, pages, type StoredMenuItem } from './content.schema'
import { collections as collectionsTable } from '@shopnex/catalog/schema'
import { products as productsTable } from '@shopnex/catalog/schema'

export interface MenuInput {
  handle: string
  title: string
  items: StoredMenuItem[]
}

export async function list(shopId: string, conn: Conn) {
  return conn.select().from(menus).where(eq(menus.shopId, shopId)).orderBy(asc(menus.createdAt))
}

export async function getById(shopId: string, id: string, conn: Conn) {
  const [row] = await conn
    .select()
    .from(menus)
    .where(and(eq(menus.shopId, shopId), eq(menus.id, id)))
  return row ?? null
}

export async function getByHandle(shopId: string, handle: string, conn: Conn) {
  const [row] = await conn
    .select()
    .from(menus)
    .where(and(eq(menus.shopId, shopId), eq(menus.handle, handle)))
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
    ['collection', collectionsTable],
    ['product', productsTable],
    ['page', pages],
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

export async function create(shopId: string, input: MenuInput, conn: Conn) {
  return conn.transaction(async (tx) => {
    await assertHandleFree(tx, shopId, input.handle)
    await assertResources(tx, shopId, input.items)
    const [row] = await tx
      .insert(menus)
      .values({ shopId, handle: input.handle, title: input.title, items: input.items })
      .returning()
    if (!row) throw new Error('The menu was not saved')
    return row
  })
}

// Returns null when the menu isn't in this shop
export async function update(shopId: string, id: string, patch: Partial<MenuInput>, conn: Conn) {
  return conn.transaction(async (tx) => {
    if (!(await getById(shopId, id, tx))) return null
    if (patch.handle !== undefined) await assertHandleFree(tx, shopId, patch.handle, id)
    if (patch.items !== undefined) await assertResources(tx, shopId, patch.items)
    const [row] = await tx
      .update(menus)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(menus.id, id))
      .returning()
    if (!row) throw new Error('The menu was not saved')
    return row
  })
}

export async function remove(shopId: string, id: string, conn: Conn) {
  const [row] = await conn
    .delete(menus)
    .where(and(eq(menus.shopId, shopId), eq(menus.id, id)))
    .returning()
  return row ?? null
}

export async function removeMany(shopId: string, ids: string[], conn: Conn) {
  if (!ids.length) return 0
  const deleted = await conn
    .delete(menus)
    .where(and(eq(menus.shopId, shopId), inArray(menus.id, ids)))
    .returning({ id: menus.id })
  return deleted.length
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
export async function resolve(shopId: string, items: StoredMenuItem[], conn: Conn): Promise<ResolvedMenuItem[]> {
  const collectionIds = resourceIds(items, 'collection')
  const productIds = resourceIds(items, 'product')
  const pageIds = resourceIds(items, 'page')
  const [collections, products, pageRows] = await Promise.all([
    collectionIds.length
      ? conn
          .select({ id: collectionsTable.id, slug: collectionsTable.slug })
          .from(collectionsTable)
          .where(and(eq(collectionsTable.shopId, shopId), inArray(collectionsTable.id, collectionIds)))
      : [],
    productIds.length
      ? conn
          .select({ id: productsTable.id, slug: productsTable.slug })
          .from(productsTable)
          .where(
            and(
              eq(productsTable.shopId, shopId),
              eq(productsTable.status, 'active'),
              inArray(productsTable.id, productIds),
            ),
          )
      : [],
    pageIds.length
      ? conn
          .select({ id: pages.id, slug: pages.handle })
          .from(pages)
          .where(
            and(
              eq(pages.shopId, shopId),
              isNotNull(pages.publishedAt),
              lte(pages.publishedAt, new Date()),
              inArray(pages.id, pageIds),
            ),
          )
      : [],
  ])
  const slugs = {
    collection: new Map(collections.map((c) => [c.id, c.slug])),
    product: new Map(products.map((p) => [p.id, p.slug])),
    page: new Map(pageRows.map((p) => [p.id, p.slug])),
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

/**
 * The storefront's menus, so a new shop has working navigation from the first visit: the header (`main-menu`)
 * and the footer (`footer`), the two handles every bundled theme reads. Every link needs no content (the front
 * page, the catalog, search), so the menus are valid before there is a product or collection.
 * Never replaces an existing menu: a merchant who deleted or rebuilt theirs keeps it that way.
 */
export async function seedDefault(shopId: string, conn: Conn) {
  await conn
    .insert(menus)
    .values([
      {
        shopId,
        handle: 'main-menu',
        title: 'Main menu',
        items: [
          { id: randomUUID(), title: 'Home', type: 'frontpage', items: [] },
          { id: randomUUID(), title: 'Shop all', type: 'catalog', items: [] },
        ],
      },
      {
        shopId,
        handle: 'footer',
        title: 'Footer menu',
        items: [{ id: randomUUID(), title: 'Search', type: 'search', items: [] }],
      },
    ])
    .onConflictDoNothing()
}
