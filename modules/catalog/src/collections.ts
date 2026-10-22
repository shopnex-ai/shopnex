// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
import { and, asc, eq, max } from 'drizzle-orm'
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

export async function list(shopId: string, opts: { limit: number; offset: number }, conn: Conn = db) {
  return conn
    .select()
    .from(schema.collections)
    .where(eq(schema.collections.shopId, shopId))
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
    return row!
  })
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
