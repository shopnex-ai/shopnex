// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
import { and, asc, count, eq, inArray, max } from 'drizzle-orm'
import { publicationService } from '@shopnex/channels'
import { type Conn } from '@shopnex/db'
import { languageService } from '@shopnex/languages'
import { CatalogError } from './catalog.errors'
import { sanitizeHtml } from './html'
import { getById as getProductById } from './products'
import { isSlugTaken, nextFreeSlug, slugify } from './slug'
import { collections, productCollections } from './catalog.schema'
import { products } from './catalog.schema'

export type CollectionInput = {
  title: string
  slug?: string
  description?: string | null
  /** Sanitized on write */
  descriptionHtml?: string | null
  imageUrl?: string | null
  seo?: { title?: string | null; description?: string | null }
}

/** `channelId`: only collections published on that channel now (storefronts) */
export async function list(shopId: string, opts: { limit: number; offset: number; channelId?: string }, conn: Conn) {
  return conn
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.shopId, shopId),
        opts.channelId ? publicationService.liveOn('collection', opts.channelId, collections.id) : undefined,
      ),
    )
    .orderBy(asc(collections.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)
}

export async function getById(shopId: string, id: string, conn: Conn) {
  const [row] = await conn
    .select()
    .from(collections)
    .where(and(eq(collections.shopId, shopId), eq(collections.id, id)))
  return row ?? null
}

export async function getBySlug(shopId: string, slug: string, conn: Conn) {
  const [row] = await conn
    .select()
    .from(collections)
    .where(and(eq(collections.shopId, shopId), eq(collections.slug, slug)))
  return row ?? null
}

/** Of these collection slugs, the ones published on the channel now (for what a storefront may name or filter by) */
export async function liveSlugs(shopId: string, channelId: string, slugs: string[], conn: Conn) {
  if (!slugs.length) return new Set<string>()
  const rows = await conn
    .select({ slug: collections.slug })
    .from(collections)
    .where(
      and(
        eq(collections.shopId, shopId),
        inArray(collections.slug, slugs),
        publicationService.liveOn('collection', channelId, collections.id),
      ),
    )
  return new Set(rows.map((r) => r.slug))
}

export async function create(shopId: string, input: CollectionInput, conn: Conn) {
  return conn.transaction(async (tx) => {
    let slug: string
    if (input.slug) {
      if (await isSlugTaken(tx, collections, shopId, input.slug)) {
        throw new CatalogError('SLUG_TAKEN', `Slug "${input.slug}" is already used by another collection`)
      }
      slug = input.slug
    } else {
      slug = await nextFreeSlug(tx, collections, shopId, slugify(input.title, 'collection'))
    }
    const [row] = await tx
      .insert(collections)
      .values({
        shopId,
        slug,
        title: input.title,
        description: input.description,
        descriptionHtml: input.descriptionHtml ? sanitizeHtml(input.descriptionHtml) || null : null,
        imageUrl: input.imageUrl,
        seoTitle: input.seo?.title ?? null,
        seoDescription: input.seo?.description ?? null,
      })
      .returning()
    await publicationService.autoPublish(shopId, 'collection', row!.id, tx)
    return row!
  })
}

// Partial update; a changed slug must stay unique within the shop
export async function update(shopId: string, id: string, patch: Partial<CollectionInput>, conn: Conn) {
  return conn.transaction(async (tx) => {
    const existing = await getById(shopId, id, tx)
    if (!existing) return null
    if (patch.slug && patch.slug !== existing.slug && (await isSlugTaken(tx, collections, shopId, patch.slug, id))) {
      throw new CatalogError('SLUG_TAKEN', `Slug "${patch.slug}" is already used by another collection`)
    }
    const [row] = await tx
      .update(collections)
      .set({
        updatedAt: new Date(),
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.slug !== undefined && { slug: patch.slug }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.descriptionHtml !== undefined && {
          descriptionHtml: patch.descriptionHtml ? sanitizeHtml(patch.descriptionHtml) || null : null,
        }),
        ...(patch.imageUrl !== undefined && { imageUrl: patch.imageUrl }),
        ...(patch.seo?.title !== undefined && { seoTitle: patch.seo.title }),
        ...(patch.seo?.description !== undefined && { seoDescription: patch.seo.description }),
      })
      .where(and(eq(collections.shopId, shopId), eq(collections.id, id)))
      .returning()
    return row ?? null
  })
}

// Products stay; only their membership rows cascade away
export async function remove(shopId: string, id: string, conn: Conn) {
  const [row] = await conn
    .delete(collections)
    .where(and(eq(collections.shopId, shopId), eq(collections.id, id)))
    .returning()
  if (row) {
    await publicationService.removeFor(shopId, 'collection', [id], conn)
    await languageService.removeFor(shopId, 'collection', id, conn)
  }
  return row ?? null
}

export async function removeMany(shopId: string, ids: string[], conn: Conn) {
  if (!ids.length) return 0
  const deleted = await conn
    .delete(collections)
    .where(and(eq(collections.shopId, shopId), inArray(collections.id, ids)))
    .returning({ id: collections.id })
  const deletedIds = deleted.map((c) => c.id)
  await publicationService.removeFor(shopId, 'collection', deletedIds, conn)
  await languageService.removeFor(shopId, 'collection', deletedIds, conn)
  return deleted.length
}

// collectionId → number of products, for the given collections (all belong to this shop)
export async function productCounts(shopId: string, ids: string[], conn: Conn) {
  if (!ids.length) return new Map<string, number>()
  const rows = await conn
    .select({ id: productCollections.collectionId, n: count() })
    .from(productCollections)
    .innerJoin(collections, eq(collections.id, productCollections.collectionId))
    .where(and(eq(collections.shopId, shopId), inArray(productCollections.collectionId, ids)))
    .groupBy(productCollections.collectionId)
  return new Map(rows.map((r) => [r.id, r.n]))
}

// Members in collection order
export async function listProducts(shopId: string, collectionId: string, conn: Conn) {
  return conn
    .select({ id: products.id, title: products.title, status: products.status })
    .from(productCollections)
    .innerJoin(products, eq(products.id, productCollections.productId))
    .innerJoin(collections, eq(collections.id, productCollections.collectionId))
    .where(and(eq(collections.shopId, shopId), eq(productCollections.collectionId, collectionId)))
    .orderBy(asc(productCollections.position))
}

// Idempotent; new products go to the end of the collection
export async function addProduct(shopId: string, collectionId: string, productId: string, conn: Conn) {
  return conn.transaction(async (tx) => {
    // Both must belong to this shop — never link across shops
    if (!(await getById(shopId, collectionId, tx))) {
      throw new CatalogError('COLLECTION_NOT_FOUND', 'Collection not found')
    }
    if (!(await getProductById(shopId, productId, tx))) {
      throw new CatalogError('PRODUCT_NOT_FOUND', 'Product not found')
    }
    const [{ last } = { last: null }] = await tx
      .select({ last: max(productCollections.position) })
      .from(productCollections)
      .where(eq(productCollections.collectionId, collectionId))
    await tx
      .insert(productCollections)
      .values({ collectionId, productId, position: (last ?? -1) + 1 })
      .onConflictDoNothing()
  })
}

export async function removeProduct(shopId: string, collectionId: string, productId: string, conn: Conn) {
  if (!(await getById(shopId, collectionId, conn))) {
    throw new CatalogError('COLLECTION_NOT_FOUND', 'Collection not found')
  }
  await conn
    .delete(productCollections)
    .where(and(eq(productCollections.collectionId, collectionId), eq(productCollections.productId, productId)))
}
