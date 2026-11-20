// Mapping: the module services' rows → the public contract's shapes (only what the contract exposes), the customer token check, and the
// opaque cursor paging. Pure helpers of the storefront routes.
import { ORPCError } from '@orpc/server'
import { type CartView } from '@shopnex/cart'
import { publicationService } from '@shopnex/channels'
import {
  collectionService,
  escapeHtml,
  htmlToText,
  productService,
  type Collection as CollectionRow,
  type ProductWithDetails,
} from '@shopnex/catalog'
import type {
  Cart,
  Collection,
  Customer,
  CustomerOrder,
  Image,
  MenuItem,
  Money,
  OrderAddress,
  Page,
  Product,
  ProductVariant,
} from '@shopnex/storefront-sdk'
import { type Page as PageRow, type ResolvedMenuItem } from '@shopnex/content'
import { customFieldService, type CustomFieldResource, type CustomFieldValues } from '@shopnex/custom-fields'
import { accountService } from '@shopnex/customers'
import { db } from '@shopnex/db'
import { orderService, visibleProperties } from '@shopnex/orders'
import { CUSTOMER_TOKEN_HEADER } from '@shopnex/storefront-sdk/constants'
import { defined } from './storefront.procedures'
import { type Customer as CustomerRow } from '@shopnex/customers/schema'

// ── mapping: internal rows → public contract shapes (only what the contract exposes) ──

export const money = (amountMinor: number, currencyCode: string): Money => ({ amountMinor, currencyCode })

export const image = (img: { id?: string | null; url: string; alt?: string | null }): Image => ({
  id: img.id ?? null,
  url: img.url,
  altText: img.alt ?? null,
  width: null,
  height: null,
})

export function content(row: { description: string | null; descriptionHtml: string | null }) {
  return {
    description: row.description ?? (row.descriptionHtml ? htmlToText(row.descriptionHtml) : ''),
    descriptionHtml: row.descriptionHtml ?? (row.description ? `<p>${escapeHtml(row.description)}</p>` : ''),
  }
}

export function priceRange(prices: number[], currency: string) {
  return {
    minVariantPrice: money(Math.min(...prices), currency),
    maxVariantPrice: money(Math.max(...prices), currency),
  }
}

// Keeps only the custom fields the shop shows on the storefront
type FieldsView = (values: CustomFieldValues) => CustomFieldValues
export const fieldsView = (shopId: string, resource: CustomFieldResource) =>
  customFieldService.storefrontView(shopId, resource, db)

export function toProduct(p: ProductWithDetails, currency: string, fields: FieldsView): Product {
  const images = p.images.map(image)
  const featuredImage = images[0] ?? null
  const variants = p.variants.map((v): ProductVariant => ({
    id: v.id,
    title: v.title,
    sku: v.sku,
    availableForSale: v.available,
    price: money(v.priceCents, currency),
    compareAtPrice: v.compareAtPriceCents != null ? money(v.compareAtPriceCents, currency) : null,
    selectedOptions: v.selectedOptions,
    // Like Shopify: falls back to the product image
    image: v.imageUrl ? image({ url: v.imageUrl }) : featuredImage,
  }))
  const compareAt = p.variants.flatMap((v) => (v.compareAtPriceCents != null ? [v.compareAtPriceCents] : []))
  return {
    id: p.id,
    handle: p.slug,
    title: p.title,
    ...content(p),
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    availableForSale: variants.some((v) => v.availableForSale),
    options: p.options.map((o) => ({ id: o.id, name: o.name, optionValues: o.optionValues })),
    variants,
    priceRange: priceRange(
      p.variants.map((v) => v.priceCents),
      currency,
    ),
    compareAtPriceRange: compareAt.length ? priceRange(compareAt, currency) : null,
    featuredImage,
    images,
    collectionHandles: p.collectionSlugs,
    seo: { title: p.seoTitle, description: p.seoDescription },
    customFields: fields(p.customFields),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export const toCollection = (c: CollectionRow): Collection => ({
  id: c.id,
  handle: c.slug,
  title: c.title,
  ...content(c),
  image: c.imageUrl ? image({ url: c.imageUrl, alt: c.title }) : null,
  seo: { title: c.seoTitle, description: c.seoDescription },
  updatedAt: c.updatedAt.toISOString(),
})

const SUMMARY_LENGTH = 150

export function toPage(p: PageRow): Page {
  const text = htmlToText(p.bodyHtml)
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    body: p.bodyHtml,
    // Cut at a word boundary
    bodySummary: text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH).replace(/\s+\S*$/, '')}…` : text,
    seo: { title: p.seoTitle, description: p.seoDescription },
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

// Stored menus are validated to 3 levels; the contract spells the levels out, so map them that way
export const toMenuItems = (items: ResolvedMenuItem[]): MenuItem[] =>
  items.map((item) => ({
    ...item,
    items: item.items.map((child) => ({ ...child, items: child.items.map((leaf) => ({ ...leaf, items: [] })) })),
  }))

// Hosted checkout lives in the web app; APP_URL is its public origin
export const appUrl = () =>
  (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export function toCart(c: CartView): Cart {
  const m = (cents: number) => money(cents, c.currency)
  const applied = c.discountCode?.applicable ? c.discountCode.code : null
  const allocations = (cents: number) => (applied && cents > 0 ? [{ code: applied, discountedAmount: m(cents) }] : [])
  return {
    id: c.token,
    checkoutUrl: `${appUrl()}/checkout/${c.token}`,
    status: c.status,
    totalQuantity: c.totalQuantity,
    lines: c.lines.map((l) => ({
      id: l.lineId,
      quantity: l.quantity,
      merchandise: {
        id: l.variantId,
        title: l.variantTitle,
        sku: l.sku,
        selectedOptions: l.selectedOptions,
        image: l.imageUrl ? image({ url: l.imageUrl }) : null,
        product: { id: l.productId, handle: l.productSlug, title: l.title },
      },
      availableForSale: l.available,
      cost: {
        amountPerQuantity: m(l.unitPriceCents),
        compareAtAmountPerQuantity: l.compareAtPriceCents != null ? m(l.compareAtPriceCents) : null,
        subtotalAmount: m(l.lineTotalCents),
        totalAmount: m(l.lineTotalCents - l.discountCents),
      },
      discountAllocations: allocations(l.discountCents),
      attributes: l.properties.map((p) => ({ key: p.name, value: p.value })),
    })),
    cost: { subtotalAmount: m(c.subtotalCents), totalAmount: m(c.totalCents) },
    discountCodes: c.discountCode ? [c.discountCode] : [],
    discountAllocations: allocations(c.discountCents),
    orderId: c.orderId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

// ── customer accounts ──

export const toCustomer = (c: CustomerRow, fields: FieldsView): Customer => ({
  id: c.id,
  email: c.email,
  name: c.name,
  phone: c.phone,
  customFields: fields(c.customFields),
})

type OrderRow = NonNullable<Awaited<ReturnType<typeof orderService.getById>>>

export function toOrderAddress(a: OrderRow['shippingAddress']): OrderAddress | null {
  return (
    a && {
      name: [a.firstName, a.lastName].filter(Boolean).join(' '),
      company: a.company,
      address1: a.address1,
      address2: a.address2,
      city: a.city,
      province: a.province,
      countryCode: a.countryCode,
      zip: a.zip,
      phone: a.phone,
    }
  )
}

export function toCustomerOrder(o: OrderRow, fields: FieldsView): CustomerOrder {
  const m = (cents: number) => money(cents, o.currency)
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt.toISOString(),
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    financialStatus: o.financialStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    subtotalPrice: m(o.subtotalCents),
    shippingPrice: m(o.shippingCents),
    totalDiscounts: m(o.discountCents),
    totalTax: m(o.taxCents),
    totalPrice: m(o.totalCents),
    paymentMethod: o.paymentMethodName,
    // Only while there is still something to pay
    paymentInstructions: o.financialStatus === 'pending' && !o.cancelledAt ? o.paymentInstructions : null,
    lines: o.items.map((i) => ({
      title: i.title,
      variantTitle: i.variantTitle,
      quantity: i.quantity,
      image: i.imageUrl ? image({ url: i.imageUrl }) : null,
      price: m(i.unitPriceCents),
      totalPrice: m(i.unitPriceCents * i.quantity - i.discountCents),
      customAttributes: visibleProperties(i.properties).map((p) => ({ key: p.name, value: p.value })),
    })),
    fulfillments: o.fulfillments.map((f) => ({
      trackingCompany: f.trackingCompany,
      trackingNumber: f.trackingNumber,
      trackingUrl: f.trackingUrl,
      createdAt: f.createdAt.toISOString(),
    })),
    shippingAddress: toOrderAddress(o.shippingAddress),
    customFields: fields(o.customFields),
  }
}

/** The signed-in customer of this shop (from the customer token header), else UNAUTHORIZED */
export async function signedIn(context: { headers: Headers; shop: { id: string } }) {
  const customer = await accountService.fromToken(context.shop.id, context.headers.get(CUSTOMER_TOKEN_HEADER), db)
  if (!customer) throw defined('UNAUTHORIZED', 'Sign in to continue')
  return customer
}

// ── cursor pagination ──
// Opaque to clients; currently an offset, so the implementation can change without breaking anyone.

const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url')

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o?: unknown }
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o
  } catch {
    // fall through
  }
  throw new ORPCError('BAD_REQUEST', { message: 'Invalid cursor' })
}

// Fetch one extra row to know whether there is a next page
export async function paginate<T>(
  args: { first: number; after?: string },
  fetch: (limit: number, offset: number) => Promise<T[]>,
) {
  const offset = decodeCursor(args.after)
  const rows = await fetch(args.first + 1, offset)
  const nodes = rows.slice(0, args.first)
  const hasNextPage = rows.length > args.first
  return { nodes, pageInfo: { hasNextPage, endCursor: nodes.length ? encodeCursor(offset + nodes.length) : null } }
}

export async function productFilters(
  shopId: string,
  input: {
    customField?: string[]
    query?: string
    vendor?: string[]
    productType?: string[]
    tag?: string[]
    minPrice?: number
    maxPrice?: number
    available?: boolean
  },
) {
  return {
    customFields: await customFieldService.parseFilters(
      shopId,
      'product',
      input.customField ?? [],
      { storefrontOnly: true },
      db,
    ),
    search: input.query,
    vendors: input.vendor,
    productTypes: input.productType,
    tags: input.tag,
    minPriceCents: input.minPrice,
    maxPriceCents: input.maxPrice,
    available: input.available,
  }
}

// Storefronts only ever see active products that are published on their channel
export async function activeProduct(
  row: Awaited<ReturnType<typeof productService.getById>>,
  currency: string,
  channelId: string,
) {
  if (row?.status !== 'active' || !(await publicationService.isLive(row.shopId, channelId, 'product', row.id, db))) {
    throw new ORPCError('NOT_FOUND')
  }
  const [product] = await withLiveCollections(await productService.withDetails([row], db), row.shopId, channelId)
  if (!product) throw new ORPCError('NOT_FOUND')
  return toProduct(product, currency, await fieldsView(row.shopId, 'product'))
}

// A product names only the collections published on the storefront's channel
export async function withLiveCollections(products: ProductWithDetails[], shopId: string, channelId: string) {
  const live = await collectionService.liveSlugs(
    shopId,
    channelId,
    [...new Set(products.flatMap((p) => p.collectionSlugs))],
    db,
  )
  return products.map((p) => ({ ...p, collectionSlugs: p.collectionSlugs.filter((slug) => live.has(slug)) }))
}
