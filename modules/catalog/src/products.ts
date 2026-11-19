import { QueryBuilder } from 'drizzle-orm/pg-core'
// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
import {
  and,
  arrayOverlaps,
  asc,
  count as sqlCount,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  min,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { publicationService, type PublicationInput } from '@shopnex/channels'
import { all, type Conn } from '@shopnex/db'
import { customFieldService, type CustomFieldUpdates } from '@shopnex/custom-fields'
import { emit } from '@shopnex/webhooks'
import { CatalogError } from './catalog.errors'
import { sanitizeHtml } from './html'
import { isSlugTaken, nextFreeSlug, slugify } from './slug'
import {
  collections,
  productCollections,
  productImages,
  productVariants,
  products,
  type ProductImage,
} from './catalog.schema'
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
import {
  type Product,
  products as productsTable,
  type ProductStatus,
  productVariants as productVariantsTable,
} from './catalog.schema'

export type ImageInput = { url: string; alt?: string | null }

export type ProductInput = {
  title: string
  /** Only `active` products are visible to storefronts (default: active) */
  status?: ProductStatus
  description?: string | null
  /** Sanitized on write */
  descriptionHtml?: string | null
  vendor?: string
  /** Client id of the app that fulfills this product (dropshipping); null = the shop ships it itself */
  fulfilledBy?: string | null
  productType?: string
  tags?: string[]
  seo?: { title?: string | null; description?: string | null }
  /** Custom field values by key; null clears one (see @shopnex/custom-fields) */
  customFields?: CustomFieldUpdates
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
export async function withDetails(rows: Product[], conn: Conn): Promise<ProductWithDetails[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [images, links, { options, variants }] = await all(conn, [
    () =>
      conn
        .select()
        .from(productImages)
        .where(inArray(productImages.productId, ids))
        .orderBy(asc(productImages.position)),
    () =>
      conn
        .select({ productId: productCollections.productId, slug: collections.slug })
        .from(productCollections)
        .innerJoin(collections, eq(collections.id, productCollections.collectionId))
        .where(inArray(productCollections.productId, ids))
        .orderBy(asc(collections.createdAt)),
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
  /** Matches (case-insensitive, substring) the title, vendor, product type, a tag or a variant SKU */
  search?: string
  /** Any of these vendors / product types / tags */
  vendors?: string[]
  productTypes?: string[]
  tags?: string[]
  /** Some variant is priced within [minPriceCents, maxPriceCents] */
  minPriceCents?: number
  maxPriceCents?: number
  /** Some variant can be bought: its stock isn't tracked, or is above zero */
  available?: boolean
  /** Only products published on this channel now. Storefronts pass their channel (with status 'active'). */
  channelId?: string
  /** Custom field values the product must have, by key (see customFieldService.parseFilters) */
  customFields?: Record<string, string>
}

function ordering(opts: ListOptions): SQL[] {
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

export type FilterOptions = Pick<
  ListOptions,
  | 'status'
  | 'collection'
  | 'search'
  | 'channelId'
  | 'vendors'
  | 'productTypes'
  | 'tags'
  | 'minPriceCents'
  | 'maxPriceCents'
  | 'available'
  | 'customFields'
>

const likeAny = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`

// A variant of the product that satisfies `conditions`
const someVariant = (...conditions: (SQL | undefined)[]) =>
  exists(
    new QueryBuilder()
      .select({ one: sql`1` })
      .from(productVariantsTable)
      .where(and(eq(productVariantsTable.productId, productsTable.id), ...conditions)),
  )

// The collection filter needs the collection join (see list / count)
function filters(shopId: string, opts: FilterOptions) {
  const term = opts.search?.trim()
  const priced = opts.minPriceCents !== undefined || opts.maxPriceCents !== undefined
  return and(
    eq(products.shopId, shopId),
    opts.status ? eq(products.status, opts.status) : undefined,
    opts.collection ? eq(collections.slug, opts.collection) : undefined,
    opts.channelId ? publicationService.liveOn('product', opts.channelId, products.id) : undefined,
    term
      ? or(
          ilike(products.title, likeAny(term)),
          ilike(products.vendor, likeAny(term)),
          ilike(products.productType, likeAny(term)),
          sql`array_to_string(${products.tags}, ' ') ilike ${likeAny(term)}`,
          someVariant(ilike(productVariants.sku, likeAny(term))),
        )
      : undefined,
    opts.vendors?.length ? inArray(products.vendor, opts.vendors) : undefined,
    opts.productTypes?.length ? inArray(products.productType, opts.productTypes) : undefined,
    opts.tags?.length ? arrayOverlaps(products.tags, opts.tags) : undefined,
    priced
      ? someVariant(
          opts.minPriceCents !== undefined ? gte(productVariants.priceCents, opts.minPriceCents) : undefined,
          opts.maxPriceCents !== undefined ? lte(productVariants.priceCents, opts.maxPriceCents) : undefined,
        )
      : undefined,
    ...Object.entries(opts.customFields ?? {}).map(
      ([key, value]) => sql`${products.customFields} ->> ${key} = ${value}`,
    ),
    opts.available
      ? someVariant(or(isNull(productVariants.inventoryQuantity), sql`${productVariants.inventoryQuantity} > 0`))
      : undefined,
  )
}

export async function list(shopId: string, opts: ListOptions, conn: Conn) {
  const where = filters(shopId, opts)
  if (opts.collection) {
    const rows = await conn
      .select({ product: productsTable })
      .from(productsTable)
      .innerJoin(productCollections, eq(productCollections.productId, productsTable.id))
      .innerJoin(collections, eq(collections.id, productCollections.collectionId))
      .where(where)
      .orderBy(...ordering(opts))
      .limit(opts.limit)
      .offset(opts.offset)
    return rows.map((r) => r.product)
  }
  return conn
    .select()
    .from(productsTable)
    .where(where)
    .orderBy(...ordering(opts))
    .limit(opts.limit)
    .offset(opts.offset)
}

/** How many rows the shop has, counted up to `cap`: enough to know if a list is empty or how many rows to draw, and
 * as fast for a million rows as for ten. */
export async function countUpTo(shopId: string, cap: number, conn: Conn) {
  const rows = await conn
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.shopId, shopId))
    .limit(cap)
  return rows.length
}

// Total for the same filters as `list` (admin pagination)
export async function count(shopId: string, opts: FilterOptions, conn: Conn) {
  const query = conn.select({ total: sqlCount() }).from(productsTable)
  const [row] = await (opts.collection
    ? query
        .innerJoin(productCollections, eq(productCollections.productId, productsTable.id))
        .innerJoin(collections, eq(collections.id, productCollections.collectionId))
        .where(filters(shopId, opts))
    : query.where(filters(shopId, opts)))
  return row?.total ?? 0
}

export type Facets = {
  vendors: { value: string; count: number }[]
  productTypes: { value: string; count: number }[]
  tags: { value: string; count: number }[]
  /** Variant prices across the matching products; null when there are none */
  price: { minCents: number; maxCents: number } | null
}

// Products scanned for facet counts; a shop beyond this still gets filters, with counts for the first products
const FACET_SCAN_LIMIT = 5000

const tally = (values: string[]) => {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

// What a filter UI can offer for the products matching `opts` (its own selections included, so a facet
// keeps listing the values the shopper hasn't picked)
export async function facets(shopId: string, opts: FilterOptions, conn: Conn): Promise<Facets> {
  const where = filters(shopId, opts)
  const base = conn
    .select({ id: products.id, vendor: products.vendor, productType: products.productType, tags: products.tags })
    .from(products)
  const rows = await (
    opts.collection
      ? base
          .innerJoin(productCollections, eq(productCollections.productId, products.id))
          .innerJoin(collections, eq(collections.id, productCollections.collectionId))
          .where(where)
      : base.where(where)
  ).limit(FACET_SCAN_LIMIT)
  const [range] = rows.length
    ? await conn
        .select({ lo: min(productVariants.priceCents), hi: max(productVariants.priceCents) })
        .from(productVariants)
        .where(
          inArray(
            productVariants.productId,
            rows.map((r) => r.id),
          ),
        )
    : []
  return {
    vendors: tally(rows.map((r) => r.vendor)),
    productTypes: tally(rows.map((r) => r.productType)),
    tags: tally(rows.flatMap((r) => r.tags)),
    price: range?.lo != null && range.hi != null ? { minCents: range.lo, maxCents: range.hi } : null,
  }
}

export async function getById(shopId: string, id: string, conn: Conn) {
  const [row] = await conn
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.shopId, shopId), eq(productsTable.id, id)))
  return row ?? null
}

export async function removeMany(shopId: string, ids: string[], conn: Conn) {
  if (!ids.length) return 0
  const deleted = await conn
    .delete(productsTable)
    .where(and(eq(productsTable.shopId, shopId), inArray(productsTable.id, ids)))
    .returning({ id: productsTable.id })
  await publicationService.removeFor(
    shopId,
    'product',
    deleted.map((p) => p.id),
    conn,
  )
  return deleted.length
}

export async function getBySlug(shopId: string, slug: string, conn: Conn) {
  const [row] = await conn
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.shopId, shopId), eq(productsTable.slug, slug)))
  return row ?? null
}

export async function getManyByIds(shopId: string, ids: string[], conn: Conn) {
  if (ids.length === 0) return []
  return conn
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.shopId, shopId), inArray(productsTable.id, ids)))
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
    ...(input.fulfilledBy !== undefined && { fulfilledBy: input.fulfilledBy }),
    ...(input.productType !== undefined && { productType: input.productType.trim() }),
    ...(input.tags !== undefined && { tags: [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))] }),
    ...(input.seo?.title !== undefined && { seoTitle: input.seo.title }),
    ...(input.seo?.description !== undefined && { seoDescription: input.seo.description }),
  }
}

async function replaceImages(conn: Conn, productId: string, images: ImageInput[]) {
  await conn.delete(productImages).where(eq(productImages.productId, productId))
  if (images.length) {
    await conn
      .insert(productImages)
      .values(images.map((img, position) => ({ productId, url: img.url, alt: img.alt ?? null, position })))
  }
}

export async function create(shopId: string, input: ProductInput, conn: Conn) {
  if (input.variants === undefined && input.priceCents === undefined) {
    throw new CatalogError('INVALID_VARIANTS', 'Provide priceCents (simple product) or variants')
  }
  if (input.variants !== undefined && input.priceCents !== undefined) {
    throw new CatalogError('HAS_VARIANTS', 'Price lives on variants: pass priceCents on each variant instead')
  }
  // Without this, Math.min() of nothing is Infinity below and Postgres refuses it with a message no one can read
  if (input.variants?.length === 0) throw new CatalogError('INVALID_VARIANTS', 'A product needs at least one variant')
  return conn.transaction(async (tx) => {
    let slug: string
    if (input.slug) {
      if (await isSlugTaken(tx, productsTable, shopId, input.slug)) {
        throw new CatalogError('SLUG_TAKEN', `Slug "${input.slug}" is already used by another product`)
      }
      slug = input.slug
    } else {
      slug = await nextFreeSlug(tx, productsTable, shopId, slugify(input.title, 'product'))
    }
    const variants = input.variants ?? [{ priceCents: input.priceCents! }]
    const [product] = await tx
      .insert(productsTable)
      .values({
        ...contentColumns(input),
        customFields: await customFieldService.merge(shopId, 'product', input.customFields ?? {}, {}, tx),
        shopId,
        slug,
        title: input.title,
        // Placeholder; syncPriceCache sets the real minimum right after
        priceCents: Math.min(...variants.map((v) => v.priceCents)),
      })
      .returning()
    await applyVariants(tx, shopId, product!.id, { options: input.options ?? [], variants })
    // Like Shopify, a new product is on the Online Store (and any channel that wants new products)
    await publicationService.autoPublish(shopId, 'product', product!.id, tx)
    if (input.images) await replaceImages(tx, product!.id, input.images)
    return withDetailsAndEmit(tx, shopId, product!.id, 'product.created')
  })
}

type ProductTopic = 'product.created' | 'product.updated'

/**
 * Publishes the product on exactly these channels and queues `product.updated`, so apps that mirror the
 * catalog learn it appeared on or left a channel. Null when there's no such product.
 */
export async function setPublications(shopId: string, id: string, items: PublicationInput[], conn: Conn) {
  return conn.transaction(async (tx) => {
    if (!(await getById(shopId, id, tx))) return null
    await publicationService.set(shopId, 'product', id, items, tx)
    await emitProductEvent(tx, shopId, id, 'product.updated')
    return (await publicationService.listFor(shopId, 'product', [id], tx)).get(id)!
  })
}

async function reload(conn: Conn, id: string) {
  const [fresh] = await conn.select().from(productsTable).where(eq(productsTable.id, id))
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
  conn: Conn,
) {
  return conn.transaction(async (tx) => {
    if (!(await getById(shopId, id, tx))) return null
    await applyVariants(tx, shopId, id, input)
    return withDetailsAndEmit(tx, shopId, id, 'product.updated')
  })
}

// Partial update; images, when given, replace the existing set.
// priceCents is only accepted for simple products (it sets the default variant's price).
export async function update(
  shopId: string,
  id: string,
  patch: Partial<Omit<ProductInput, 'options' | 'variants'>>,
  conn: Conn,
) {
  return conn.transaction(async (tx) => {
    const existing = await getById(shopId, id, tx)
    if (!existing) return null
    if (patch.slug && patch.slug !== existing.slug && (await isSlugTaken(tx, productsTable, shopId, patch.slug, id))) {
      throw new CatalogError('SLUG_TAKEN', `Slug "${patch.slug}" is already used by another product`)
    }
    const { images, priceCents, slug } = patch
    const fields = {
      ...contentColumns(patch),
      ...(slug !== undefined && { slug }),
      ...(patch.customFields && {
        customFields: await customFieldService.merge(shopId, 'product', patch.customFields, existing.customFields, tx),
      }),
    }
    if (priceCents !== undefined) {
      const variants = await listByProduct(shopId, id, tx)
      if (variants.length !== 1 || variants[0]!.optionsKey !== '') {
        throw new CatalogError('HAS_VARIANTS', 'This product has variants: update the price on each variant')
      }
      await tx
        .update(productVariantsTable)
        .set({ priceCents, updatedAt: new Date() })
        .where(eq(productVariantsTable.id, variants[0]!.id))
      await syncPriceCache(shopId, id, tx)
    }
    if (Object.keys(fields).length) {
      await tx
        .update(productsTable)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(productsTable.id, id))
    }
    if (images) await replaceImages(tx, id, images)
    return withDetailsAndEmit(tx, shopId, id, 'product.updated')
  })
}
