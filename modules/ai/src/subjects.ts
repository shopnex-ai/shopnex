// What a capability is about, as the provider sees it: loaded by ShopNex from the shop's own data, never by the
// provider. Only what the copy needs, nothing about orders or customers.
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { htmlToText, productService, type ProductWithDetails } from '@shopnex/catalog'
import type { Conn } from '@shopnex/db'
import type { AiCollection, AiPage, AiProduct, AiRunRequest } from '@shopnex/marketplace-sdk/ai'
import { AiError } from './ai.errors'
import { pages } from '@shopnex/content/schema'
import { collections as collectionsTable, productCollections } from '@shopnex/catalog/schema'
import { products as productsTable } from '@shopnex/catalog/schema'

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
  if (!details) throw new AiError('SUBJECT_NOT_FOUND', 'Product not found')
  return toAiProduct(details, currency)
}

export async function collection(shopId: string, id: string, conn: Conn): Promise<AiCollection> {
  const [row] = await conn
    .select()
    .from(collectionsTable)
    .where(and(eq(collectionsTable.shopId, shopId), eq(collectionsTable.id, id)))
  if (!row) throw new AiError('SUBJECT_NOT_FOUND', 'Collection not found')
  const [members, [total]] = await Promise.all([
    conn
      .select({
        title: productsTable.title,
        productType: productsTable.productType,
        tags: productsTable.tags,
      })
      .from(productCollections)
      .innerJoin(productsTable, eq(productsTable.id, productCollections.productId))
      .where(eq(productCollections.collectionId, id))
      .orderBy(asc(productCollections.position))
      .limit(MAX_COLLECTION_PRODUCTS),
    conn.select({ n: count() }).from(productCollections).where(eq(productCollections.collectionId, id)),
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
export async function page(shopId: string, id: string | undefined, conn: Conn): Promise<AiPage | null> {
  if (!id) return null
  const [row] = await conn
    .select()
    .from(pages)
    .where(and(eq(pages.shopId, shopId), eq(pages.id, id)))
  if (!row) throw new AiError('SUBJECT_NOT_FOUND', 'Page not found')
  return { id: row.id, title: row.title, handle: row.handle, body: htmlToText(row.bodyHtml) }
}

/** What the shop sells: its collections, the product types and tags in use (most used first), a sample of products */
export async function catalog(shopId: string, conn: Conn): Promise<NonNullable<AiRunRequest['shop']['catalog']>> {
  const mine = eq(productsTable.shopId, shopId)
  const [collections, types, tags, products] = await Promise.all([
    conn
      .select({ handle: collectionsTable.slug, title: collectionsTable.title })
      .from(collectionsTable)
      .where(eq(collectionsTable.shopId, shopId))
      .orderBy(asc(collectionsTable.createdAt))
      .limit(CATALOG_LISTED),
    conn
      .select({ value: productsTable.productType, n: count() })
      .from(productsTable)
      .where(and(mine, sql`${productsTable.productType} <> ''`))
      .groupBy(productsTable.productType)
      .orderBy(desc(count()))
      .limit(CATALOG_LISTED),
    conn
      .select({ value: sql<string>`unnest(${productsTable.tags})`, n: count() })
      .from(productsTable)
      .where(mine)
      .groupBy(sql`1`)
      .orderBy(desc(count()))
      .limit(CATALOG_LISTED),
    conn
      .select({ title: productsTable.title, productType: productsTable.productType })
      .from(productsTable)
      .where(and(mine, eq(productsTable.status, 'active')))
      .orderBy(desc(productsTable.createdAt))
      .limit(CATALOG_SAMPLE),
  ])
  return {
    collections,
    productTypes: types.map((t) => t.value),
    tags: tags.map((t) => t.value),
    products,
  }
}
