// What a capability is about, as the provider sees it: loaded by Shopnex from the shop's own data, never by the
// provider. Only what the copy needs, nothing about orders or customers.
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { htmlToText, productService, type ProductWithDetails } from '@shopnex/catalog'
import { db, schema } from '@shopnex/db'
import type { AiCollection, AiPage, AiProduct, AiRunRequest } from '@shopnex/marketplace-sdk/ai'
import { AiError } from './errors'

const MAX_VARIANTS = 50
const MAX_COLLECTION_PRODUCTS = 30
// A page needs a sense of what the shop sells, not the catalog
const CATALOG_SAMPLE = 20
const CATALOG_LISTED = 100

export const toAiProduct = (p: ProductWithDetails, currency: string): AiProduct => ({
  id: p.id,
  title: p.title,
  description: p.descriptionHtml ? htmlToText(p.descriptionHtml) : (p.description ?? ''),
  vendor: p.vendor,
  productType: p.productType,
  tags: p.tags,
  seo: { title: p.seoTitle, description: p.seoDescription },
  options: p.options.map((o) => ({ name: o.name, values: o.values })),
  variants: p.variants.slice(0, MAX_VARIANTS).map((v) => ({
    title: v.title,
    sku: v.sku,
    price: { cents: v.priceCents, currency },
  })),
  images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
  collections: p.collectionSlugs,
})

export async function product(shopId: string, id: string, currency: string): Promise<AiProduct> {
  const row = await productService.getById(shopId, id)
  if (!row) throw new AiError('SUBJECT_NOT_FOUND', 'Product not found')
  const [details] = await productService.withDetails([row])
  return toAiProduct(details!, currency)
}

export async function collection(shopId: string, id: string): Promise<AiCollection> {
  const [row] = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.shopId, shopId), eq(schema.collections.id, id)))
  if (!row) throw new AiError('SUBJECT_NOT_FOUND', 'Collection not found')
  const [members, [total]] = await Promise.all([
    db
      .select({
        title: schema.products.title,
        productType: schema.products.productType,
        tags: schema.products.tags,
      })
      .from(schema.productCollections)
      .innerJoin(schema.products, eq(schema.products.id, schema.productCollections.productId))
      .where(eq(schema.productCollections.collectionId, id))
      .orderBy(asc(schema.productCollections.position))
      .limit(MAX_COLLECTION_PRODUCTS),
    db.select({ n: count() }).from(schema.productCollections).where(eq(schema.productCollections.collectionId, id)),
  ])
  return {
    id: row.id,
    title: row.title,
    handle: row.slug,
    description: row.descriptionHtml ? htmlToText(row.descriptionHtml) : (row.description ?? ''),
    seo: { title: row.seoTitle, description: row.seoDescription },
    productCount: total?.n ?? members.length,
    products: members,
  }
}

/** null when no page is given: the page is still being written */
export async function page(shopId: string, id: string | undefined): Promise<AiPage | null> {
  if (!id) return null
  const [row] = await db
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.shopId, shopId), eq(schema.pages.id, id)))
  if (!row) throw new AiError('SUBJECT_NOT_FOUND', 'Page not found')
  return { id: row.id, title: row.title, handle: row.handle, body: htmlToText(row.bodyHtml) }
}

/** What the shop sells: its collections, the product types and tags in use (most used first), a sample of products */
export async function catalog(shopId: string): Promise<NonNullable<AiRunRequest['shop']['catalog']>> {
  const mine = eq(schema.products.shopId, shopId)
  const [collections, types, tags, products] = await Promise.all([
    db
      .select({ handle: schema.collections.slug, title: schema.collections.title })
      .from(schema.collections)
      .where(eq(schema.collections.shopId, shopId))
      .orderBy(asc(schema.collections.createdAt))
      .limit(CATALOG_LISTED),
    db
      .select({ value: schema.products.productType, n: count() })
      .from(schema.products)
      .where(and(mine, sql`${schema.products.productType} <> ''`))
      .groupBy(schema.products.productType)
      .orderBy(desc(count()))
      .limit(CATALOG_LISTED),
    db
      .select({ value: sql<string>`unnest(${schema.products.tags})`, n: count() })
      .from(schema.products)
      .where(mine)
      .groupBy(sql`1`)
      .orderBy(desc(count()))
      .limit(CATALOG_LISTED),
    db
      .select({ title: schema.products.title, productType: schema.products.productType })
      .from(schema.products)
      .where(and(mine, eq(schema.products.status, 'active')))
      .orderBy(desc(schema.products.createdAt))
      .limit(CATALOG_SAMPLE),
  ])
  return {
    collections,
    productTypes: types.map((t) => t.value),
    tags: tags.map((t) => t.value),
    products,
  }
}
