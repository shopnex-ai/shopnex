// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
import { and, asc, count, eq, inArray, max } from 'drizzle-orm'
import { publicationService } from '@shopnex/channels'
import { db, schema, type Conn } from '@shopnex/db'
import { CatalogError } from './errors'
import { sanitizeHtml } from './html'
import { getById as getProductById } from './products'
import { isSlugTaken, nextFreeSlug, slugify } from './slug'

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
export async function list(
  shopId: string,
  opts: { limit: number; offset: number; channelId?: string },
  conn: Conn = db,
) {
  return conn
    .select()
    .from(schema.collections)
    .where(
      and(
        eq(schema.collections.shopId, shopId),
        opts.channelId ? publicationService.liveOn('collection', opts.channelId, schema.collections.id) : undefined,
      ),
    )
    .orderBy(asc(schema.collections.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.shopId, shopId), eq(schema.collections.id, id)))
  return row ?? null
}

export async function getBySlug(shopId: string, slug: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.shopId, shopId), eq(schema.collections.slug, slug)))
  return row ?? null
}

/** Of these collection slugs, the ones published on the channel now (for what a storefront may name or filter by) */
export async function liveSlugs(shopId: string, channelId: string, slugs: string[], conn: Conn = db) {
  if (!slugs.length) return new Set<string>()
  const rows = await conn
    .select({ slug: schema.collections.slug })
    .from(schema.collections)
    .where(
      and(
        eq(schema.collections.shopId, shopId),
        inArray(schema.collections.slug, slugs),
        publicationService.liveOn('collection', channelId, schema.collections.id),
      ),
    )
  return new Set(rows.map((r) => r.slug))
}

export async function create(shopId: string, input: CollectionInput) {
  return db.transaction(async (tx) => {
    let slug: string
    if (input.slug) {
      if (await isSlugTaken(tx, schema.collections, shopId, input.slug)) {
        throw new CatalogError('SLUG_TAKEN', `Slug "${input.slug}" is already used by another collection`)
      }
      slug = input.slug
    } else {
      slug = await nextFreeSlug(tx, schema.collections, shopId, slugify(input.title, 'collection'))
    }
    const [row] = await tx
      .insert(schema.collections)
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
export async function update(shopId: string, id: string, patch: Partial<CollectionInput>) {
  return db.transaction(async (tx) => {
    const existing = await getById(shopId, id, tx)
    if (!existing) return null
    if (
      patch.slug &&
      patch.slug !== existing.slug &&
      (await isSlugTaken(tx, schema.collections, shopId, patch.slug, id))
    ) {
      throw new CatalogError('SLUG_TAKEN', `Slug "${patch.slug}" is already used by another collection`)
    }
    const [row] = await tx
      .update(schema.collections)
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
      .where(and(eq(schema.collections.shopId, shopId), eq(schema.collections.id, id)))
      .returning()
    return row ?? null
  })
}

// Products stay; only their membership rows cascade away
export async function remove(shopId: string, id: string) {
  const [row] = await db
    .delete(schema.collections)
    .where(and(eq(schema.collections.shopId, shopId), eq(schema.collections.id, id)))
    .returning()
  if (row) await publicationService.removeFor(shopId, 'collection', [id])
  return row ?? null
}

export async function removeMany(shopId: string, ids: string[]) {
  if (!ids.length) return 0
  const deleted = await db
    .delete(schema.collections)
    .where(and(eq(schema.collections.shopId, shopId), inArray(schema.collections.id, ids)))
    .returning({ id: schema.collections.id })
  await publicationService.removeFor(
    shopId,
    'collection',
    deleted.map((c) => c.id),
  )
  return deleted.length
}

// collectionId → number of products, for the given collections (all belong to this shop)
export async function productCounts(shopId: string, ids: string[], conn: Conn = db) {
  if (!ids.length) return new Map<string, number>()
  const rows = await conn
    .select({ id: schema.productCollections.collectionId, n: count() })
    .from(schema.productCollections)
    .innerJoin(schema.collections, eq(schema.collections.id, schema.productCollections.collectionId))
    .where(and(eq(schema.collections.shopId, shopId), inArray(schema.productCollections.collectionId, ids)))
    .groupBy(schema.productCollections.collectionId)
  return new Map(rows.map((r) => [r.id, r.n]))
}

// Members in collection order
export async function listProducts(shopId: string, collectionId: string, conn: Conn = db) {
  return conn
    .select({ id: schema.products.id, title: schema.products.title, status: schema.products.status })
    .from(schema.productCollections)
    .innerJoin(schema.products, eq(schema.products.id, schema.productCollections.productId))
    .innerJoin(schema.collections, eq(schema.collections.id, schema.productCollections.collectionId))
    .where(and(eq(schema.collections.shopId, shopId), eq(schema.productCollections.collectionId, collectionId)))
    .orderBy(asc(schema.productCollections.position))
}

// Idempotent; new products go to the end of the collection
export async function addProduct(shopId: string, collectionId: string, productId: string) {
  return db.transaction(async (tx) => {
    // Both must belong to this shop — never link across shops
    if (!(await getById(shopId, collectionId, tx))) {
      throw new CatalogError('COLLECTION_NOT_FOUND', 'Collection not found')
    }
    if (!(await getProductById(shopId, productId, tx))) {
      throw new CatalogError('PRODUCT_NOT_FOUND', 'Product not found')
    }
    const [{ last } = { last: null }] = await tx
      .select({ last: max(schema.productCollections.position) })
      .from(schema.productCollections)
      .where(eq(schema.productCollections.collectionId, collectionId))
    await tx
      .insert(schema.productCollections)
      .values({ collectionId, productId, position: (last ?? -1) + 1 })
      .onConflictDoNothing()
  })
}

export async function removeProduct(shopId: string, collectionId: string, productId: string) {
  if (!(await getById(shopId, collectionId))) {
    throw new CatalogError('COLLECTION_NOT_FOUND', 'Collection not found')
  }
  await db
    .delete(schema.productCollections)
    .where(
      and(eq(schema.productCollections.collectionId, collectionId), eq(schema.productCollections.productId, productId)),
    )
}
