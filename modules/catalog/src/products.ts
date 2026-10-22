// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
import { and, asc, count as sqlCount, desc, eq, ilike, inArray, type SQL } from 'drizzle-orm'
import { all, db, schema, type Conn } from '@shopnex/db'
import type { Product, ProductImage, ProductStatus } from '@shopnex/db/schema'
import { emit } from '@shopnex/webhooks'
import { CatalogError } from './errors'
import { sanitizeHtml } from './html'
import { isSlugTaken, nextFreeSlug, slugify } from './slug'
import {
  applyVariants,
  listByProduct,
  loadForProducts,
  syncPriceCache,
  type OptionDetail,
  type OptionInput,
  type VariantDetail,
  type VariantInput,
} from './variants'

export type ImageInput = { url: string; alt?: string | null }

export type ProductInput = {
  title: string
  /** Only `active` products are visible to storefronts (default: active) */
  status?: ProductStatus
  description?: string | null
  /** Sanitized on write */
  descriptionHtml?: string | null
  vendor?: string
  productType?: string
  tags?: string[]
  seo?: { title?: string | null; description?: string | null }
  /** Simple product (one default variant). Use options + variants instead for products with variants. */
  priceCents?: number
  options?: OptionInput[]
  variants?: VariantInput[]
  /** Omit to derive from the title (made unique within the shop) */
  slug?: string
  /** Replaces all images; order = display order */
  images?: ImageInput[]
}

export type ProductWithDetails = Product & {
  images: Pick<ProductImage, 'id' | 'url' | 'alt'>[]
  collectionSlugs: string[]
  options: OptionDetail[]
  variants: VariantDetail[]
}

// Batch-load images, collection slugs, options and variants for many products (no N+1)
export async function withDetails(rows: Product[], conn: Conn = db): Promise<ProductWithDetails[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [images, links, { options, variants }] = await all(conn, [
    () =>
      conn
        .select()
        .from(schema.productImages)
        .where(inArray(schema.productImages.productId, ids))
        .orderBy(asc(schema.productImages.position)),
    () =>
      conn
        .select({ productId: schema.productCollections.productId, slug: schema.collections.slug })
        .from(schema.productCollections)
        .innerJoin(schema.collections, eq(schema.collections.id, schema.productCollections.collectionId))
        .where(inArray(schema.productCollections.productId, ids))
        .orderBy(asc(schema.collections.createdAt)),
    () => loadForProducts(ids, conn),
  ])
  return rows.map((r) => ({
    ...r,
    images: images.filter((i) => i.productId === r.id).map(({ id, url, alt }) => ({ id, url, alt })),
    collectionSlugs: links.filter((l) => l.productId === r.id).map((l) => l.slug),
    options: options.get(r.id) ?? [],
    variants: variants.get(r.id) ?? [],
  }))
}

export type ProductSortKey = 'CREATED_AT' | 'TITLE' | 'PRICE' | 'MANUAL'

export type ListOptions = {
  limit: number
  offset: number
  /** Collection slug */
  collection?: string
  /** Default: MANUAL (collection order) when filtering by collection, else newest first */
  sortKey?: ProductSortKey
  /** Explicit sort keys are ascending unless reversed */
  reverse?: boolean
  /** Storefronts pass 'active' */
  status?: ProductStatus
  /** Title contains (case-insensitive) */
  search?: string
}

function ordering(opts: ListOptions): SQL[] {
  const { products, productCollections } = schema
  const dir = (col: Parameters<typeof asc>[0], descending: boolean) => (descending ? desc(col) : asc(col))
  if (!opts.sortKey) {
    return opts.collection
      ? [asc(productCollections.position), desc(products.createdAt), asc(products.id)]
      : [desc(products.createdAt), desc(products.id)]
  }
  const reverse = !!opts.reverse
  const key =
    opts.sortKey === 'TITLE'
      ? products.title
      : opts.sortKey === 'PRICE'
        ? products.priceCents // lowest variant price (cache kept in sync)
        : opts.sortKey === 'MANUAL' && opts.collection
          ? productCollections.position
          : products.createdAt
  return [dir(key, reverse), dir(products.id, reverse)]
}

// The collection filter needs the collection join (see list / count)
function filters(shopId: string, opts: Pick<ListOptions, 'status' | 'collection' | 'search'>) {
  return and(
    eq(schema.products.shopId, shopId),
    opts.status ? eq(schema.products.status, opts.status) : undefined,
    opts.collection ? eq(schema.collections.slug, opts.collection) : undefined,
    opts.search ? ilike(schema.products.title, `%${opts.search.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
  )
}

export async function list(shopId: string, opts: ListOptions, conn: Conn = db) {
  const where = filters(shopId, opts)
  if (opts.collection) {
    const rows = await conn
      .select({ product: schema.products })
      .from(schema.products)
      .innerJoin(schema.productCollections, eq(schema.productCollections.productId, schema.products.id))
      .innerJoin(schema.collections, eq(schema.collections.id, schema.productCollections.collectionId))
      .where(where)
      .orderBy(...ordering(opts))
      .limit(opts.limit)
      .offset(opts.offset)
    return rows.map((r) => r.product)
  }
  return conn
    .select()
    .from(schema.products)
    .where(where)
    .orderBy(...ordering(opts))
    .limit(opts.limit)
    .offset(opts.offset)
}

// Total for the same filters as `list` (admin pagination)
export async function count(
  shopId: string,
  opts: Pick<ListOptions, 'status' | 'collection' | 'search'>,
  conn: Conn = db,
) {
  const query = conn.select({ total: sqlCount() }).from(schema.products)
  const [row] = await (opts.collection
    ? query
        .innerJoin(schema.productCollections, eq(schema.productCollections.productId, schema.products.id))
        .innerJoin(schema.collections, eq(schema.collections.id, schema.productCollections.collectionId))
        .where(filters(shopId, opts))
    : query.where(filters(shopId, opts)))
  return row?.total ?? 0
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), eq(schema.products.id, id)))
  return row ?? null
}

export async function getBySlug(shopId: string, slug: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), eq(schema.products.slug, slug)))
  return row ?? null
}

export async function getManyByIds(shopId: string, ids: string[], conn: Conn = db) {
  if (ids.length === 0) return []
  return conn
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids)))
}

// Input → product columns, only for keys present (so partial updates leave the rest alone)
function contentColumns(input: Partial<ProductInput>) {
  return {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.descriptionHtml !== undefined && {
      descriptionHtml: input.descriptionHtml ? sanitizeHtml(input.descriptionHtml) || null : null,
    }),
    ...(input.vendor !== undefined && { vendor: input.vendor.trim() }),
    ...(input.productType !== undefined && { productType: input.productType.trim() }),
    ...(input.tags !== undefined && { tags: [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))] }),
    ...(input.seo?.title !== undefined && { seoTitle: input.seo.title }),
    ...(input.seo?.description !== undefined && { seoDescription: input.seo.description }),
  }
}

async function replaceImages(conn: Conn, productId: string, images: ImageInput[]) {
  await conn.delete(schema.productImages).where(eq(schema.productImages.productId, productId))
  if (images.length) {
    await conn
      .insert(schema.productImages)
      .values(images.map((img, position) => ({ productId, url: img.url, alt: img.alt ?? null, position })))
  }
}

export async function create(shopId: string, input: ProductInput) {
  if (input.variants === undefined && input.priceCents === undefined) {
    throw new CatalogError('INVALID_VARIANTS', 'Provide priceCents (simple product) or variants')
  }
  if (input.variants !== undefined && input.priceCents !== undefined) {
    throw new CatalogError('HAS_VARIANTS', 'Price lives on variants: pass priceCents on each variant instead')
  }
  return db.transaction(async (tx) => {
    let slug: string
    if (input.slug) {
      if (await isSlugTaken(tx, schema.products, shopId, input.slug)) {
        throw new CatalogError('SLUG_TAKEN', `Slug "${input.slug}" is already used by another product`)
      }
      slug = input.slug
    } else {
      slug = await nextFreeSlug(tx, schema.products, shopId, slugify(input.title, 'product'))
    }
    const variants = input.variants ?? [{ priceCents: input.priceCents! }]
    const [product] = await tx
      .insert(schema.products)
      .values({
        ...contentColumns(input),
        shopId,
        slug,
        title: input.title,
        // Placeholder; syncPriceCache sets the real minimum right after
        priceCents: Math.min(...variants.map((v) => v.priceCents)),
      })
      .returning()
    await applyVariants(tx, shopId, product!.id, { options: input.options ?? [], variants })
    if (input.images) await replaceImages(tx, product!.id, input.images)
    return withDetailsAndEmit(tx, shopId, product!.id, 'product.created')
  })
}

type ProductTopic = 'product.created' | 'product.updated'

async function reload(conn: Conn, id: string) {
  const [fresh] = await conn.select().from(schema.products).where(eq(schema.products.id, id))
  return (await withDetails([fresh!], conn))[0]!
}

// Queues a product webhook; the payload is what the admin API returns for the product
export function emitProductEvent(conn: Conn, shopId: string, id: string, topic: ProductTopic) {
  return emit(conn, shopId, topic, () => reload(conn, id))
}

// After a write: reload the product (the caller returns it anyway) and queue its webhook
async function withDetailsAndEmit(conn: Conn, shopId: string, id: string, topic: ProductTopic) {
  const product = await reload(conn, id)
  await emit(conn, shopId, topic, () => product)
  return product
}

// Replace options + variants; variants keep their ids when their option combination is unchanged
export async function setVariants(
  shopId: string,
  id: string,
  input: { options: OptionInput[]; variants: VariantInput[] },
) {
  return db.transaction(async (tx) => {
    if (!(await getById(shopId, id, tx))) return null
    await applyVariants(tx, shopId, id, input)
    return withDetailsAndEmit(tx, shopId, id, 'product.updated')
  })
}

// Partial update; images, when given, replace the existing set.
// priceCents is only accepted for simple products (it sets the default variant's price).
export async function update(shopId: string, id: string, patch: Partial<Omit<ProductInput, 'options' | 'variants'>>) {
  return db.transaction(async (tx) => {
    const existing = await getById(shopId, id, tx)
    if (!existing) return null
    if (
      patch.slug &&
      patch.slug !== existing.slug &&
      (await isSlugTaken(tx, schema.products, shopId, patch.slug, id))
    ) {
      throw new CatalogError('SLUG_TAKEN', `Slug "${patch.slug}" is already used by another product`)
    }
    const { images, priceCents, slug } = patch
    const fields = { ...contentColumns(patch), ...(slug !== undefined && { slug }) }
    if (priceCents !== undefined) {
      const variants = await listByProduct(id, tx)
      if (variants.length !== 1 || variants[0]!.optionsKey !== '') {
        throw new CatalogError('HAS_VARIANTS', 'This product has variants: update the price on each variant')
      }
      await tx
        .update(schema.productVariants)
        .set({ priceCents, updatedAt: new Date() })
        .where(eq(schema.productVariants.id, variants[0]!.id))
      await syncPriceCache(tx, id)
    }
    if (Object.keys(fields).length) {
      await tx
        .update(schema.products)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(schema.products.id, id))
    }
    if (images) await replaceImages(tx, id, images)
    return withDetailsAndEmit(tx, shopId, id, 'product.updated')
  })
}
