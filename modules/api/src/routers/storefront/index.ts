import { ORPCError } from '@orpc/server'
import { cartService, checkoutService, type CartView } from '@shopnex/cart'
import {
  collectionService,
  escapeHtml,
  htmlToText,
  productService,
  type Collection as CollectionRow,
  type ProductWithDetails,
} from '@shopnex/catalog'
import type { Cart, Collection, Image, MenuItem, Money, Page, Product, ProductVariant } from '@shopnex/storefront-sdk'
import { menuService, pageService, type Page as PageRow, type ResolvedMenuItem } from '@shopnex/content'
import { themeService, verifyPreviewToken } from '@shopnex/theme'
import { storefront } from '../../orpc'

// ── mapping: internal rows → public contract shapes (only what the contract exposes) ──

const money = (amountMinor: number, currencyCode: string): Money => ({ amountMinor, currencyCode })

const image = (img: { id?: string | null; url: string; alt?: string | null }): Image => ({
  id: img.id ?? null,
  url: img.url,
  altText: img.alt ?? null,
  width: null,
  height: null,
})

function content(row: { description: string | null; descriptionHtml: string | null }) {
  return {
    description: row.description ?? (row.descriptionHtml ? htmlToText(row.descriptionHtml) : ''),
    descriptionHtml: row.descriptionHtml ?? (row.description ? `<p>${escapeHtml(row.description)}</p>` : ''),
  }
}

function priceRange(prices: number[], currency: string) {
  return {
    minVariantPrice: money(Math.min(...prices), currency),
    maxVariantPrice: money(Math.max(...prices), currency),
  }
}

function toProduct(p: ProductWithDetails, currency: string): Product {
  const images = p.images.map(image)
  const featuredImage = images[0] ?? null
  const variants = p.variants.map(
    (v): ProductVariant => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      availableForSale: v.available,
      price: money(v.priceCents, currency),
      compareAtPrice: v.compareAtPriceCents != null ? money(v.compareAtPriceCents, currency) : null,
      selectedOptions: v.selectedOptions,
      // Like Shopify: falls back to the product image
      image: v.imageUrl ? image({ url: v.imageUrl }) : featuredImage,
    }),
  )
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
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

const toCollection = (c: CollectionRow): Collection => ({
  id: c.id,
  handle: c.slug,
  title: c.title,
  ...content(c),
  image: c.imageUrl ? image({ url: c.imageUrl, alt: c.title }) : null,
  seo: { title: c.seoTitle, description: c.seoDescription },
  updatedAt: c.updatedAt.toISOString(),
})

const SUMMARY_LENGTH = 150

function toPage(p: PageRow): Page {
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
const toMenuItems = (items: ResolvedMenuItem[]): MenuItem[] =>
  items.map((item) => ({
    ...item,
    items: item.items.map((child) => ({ ...child, items: child.items.map((leaf) => ({ ...leaf, items: [] })) })),
  }))

// Hosted checkout lives in the web app; APP_URL is its public origin
const appUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')

function toCart(c: CartView): Cart {
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
    })),
    cost: { subtotalAmount: m(c.subtotalCents), totalAmount: m(c.totalCents) },
    discountCodes: c.discountCode ? [c.discountCode] : [],
    discountAllocations: allocations(c.discountCents),
    orderId: c.orderId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

// ── cursor pagination ──
// Opaque to clients; currently an offset, so the implementation can change without breaking anyone.

const encodeCursor = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url')

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (Number.isInteger(o) && o >= 0) return o
  } catch {
    // fall through
  }
  throw new ORPCError('BAD_REQUEST', { message: 'Invalid cursor' })
}

// Fetch one extra row to know whether there is a next page
async function paginate<T>(
  args: { first: number; after?: string },
  fetch: (limit: number, offset: number) => Promise<T[]>,
) {
  const offset = decodeCursor(args.after)
  const rows = await fetch(args.first + 1, offset)
  const nodes = rows.slice(0, args.first)
  const hasNextPage = rows.length > args.first
  return { nodes, pageInfo: { hasNextPage, endCursor: nodes.length ? encodeCursor(offset + nodes.length) : null } }
}

// Storefronts only ever see active products
async function activeProduct(row: Awaited<ReturnType<typeof productService.getById>>, currency: string) {
  if (!row || row.status !== 'active') throw new ORPCError('NOT_FOUND')
  return toProduct((await productService.withDetails([row]))[0]!, currency)
}

export const storefrontRouter = storefront.router({
  shop: {
    get: storefront.shop.get.handler(({ context }) => ({
      id: context.shop.id,
      name: context.shop.name,
      handle: context.shop.slug,
      currencyCode: context.shop.currency,
      seo: { title: context.shop.seoTitle || null, description: context.shop.seoDescription || null },
    })),
  },
  products: {
    list: storefront.products.list.handler(async ({ input, context }) => {
      const page = await paginate(input, async (limit, offset) =>
        productService.withDetails(
          await productService.list(context.shop.id, {
            limit,
            offset,
            collection: input.collection,
            sortKey: input.sortKey,
            reverse: input.reverse,
            status: 'active',
          }),
        ),
      )
      return { ...page, nodes: page.nodes.map((p) => toProduct(p, context.shop.currency)) }
    }),
    get: storefront.products.get.handler(async ({ input, context }) =>
      activeProduct(await productService.getById(context.shop.id, input.id), context.shop.currency),
    ),
    getByHandle: storefront.products.getByHandle.handler(async ({ input, context }) =>
      activeProduct(await productService.getBySlug(context.shop.id, input.handle), context.shop.currency),
    ),
  },
  collections: {
    list: storefront.collections.list.handler(async ({ input, context }) => {
      const page = await paginate(input, (limit, offset) => collectionService.list(context.shop.id, { limit, offset }))
      return { ...page, nodes: page.nodes.map(toCollection) }
    }),
    getByHandle: storefront.collections.getByHandle.handler(async ({ input, context }) => {
      const collection = await collectionService.getBySlug(context.shop.id, input.handle)
      if (!collection) throw new ORPCError('NOT_FOUND')
      return toCollection(collection)
    }),
  },
  pages: {
    list: storefront.pages.list.handler(async ({ input, context }) => {
      const page = await paginate(input, (limit, offset) =>
        pageService.listPublished(context.shop.id, { limit, offset }),
      )
      return { ...page, nodes: page.nodes.map(toPage) }
    }),
    getByHandle: storefront.pages.getByHandle.handler(async ({ input, context }) => {
      const page = await pageService.getPublishedByHandle(context.shop.id, input.handle)
      if (!page) throw new ORPCError('NOT_FOUND')
      return toPage(page)
    }),
  },
  menu: {
    get: storefront.menu.get.handler(async ({ input, context }) => {
      const menu = await menuService.getByHandle(context.shop.id, input.handle)
      if (!menu) throw new ORPCError('NOT_FOUND')
      return {
        id: menu.id,
        handle: menu.handle,
        title: menu.title,
        items: toMenuItems(await menuService.resolve(context.shop.id, menu.items)),
      }
    }),
  },
  theme: {
    current: storefront.theme.current.handler(async ({ input, context }) => {
      // Preview: the draft of the library copy the editor is on
      const copyId = input.previewToken ? verifyPreviewToken(input.previewToken, context.shop.id) : null
      const copy = copyId ? await themeService.get(context.shop.id, copyId) : null
      if (copy) {
        const files = Object.keys(copy.draftFiles).length ? { copyId: copy.id, version: copy.draftFilesVersion } : null
        return { themeId: copy.themeId, document: copy.draft, preview: true, files }
      }
      const live = await themeService.getLive(context.shop.id)
      return {
        themeId: live?.themeId ?? null,
        document: live?.published ?? null,
        preview: false,
        files: live?.hasFiles ? { copyId: live.id, version: live.filesVersion } : null,
      }
    }),
    // Code edits have no draft: the preview and the live theme read the copy's files alike
    files: storefront.theme.files.handler(async ({ input, context }) => {
      const copyId = input.previewToken ? verifyPreviewToken(input.previewToken, context.shop.id) : null
      const copy = copyId ? await themeService.get(context.shop.id, copyId) : null
      if (copy) return { copyId: copy.id, version: copy.draftFilesVersion, files: copy.draftFiles }
      const live = await themeService.getLive(context.shop.id)
      if (!live) return { copyId: null, version: 0, files: {} }
      const row = await themeService.get(context.shop.id, live.id)
      return { copyId: live.id, version: row?.filesVersion ?? 0, files: row?.files ?? {} }
    }),
    get: storefront.theme.get.handler(async ({ input, context }) => {
      // Preview: the draft of the library copy the editor is on (a copy of this storefront's theme)
      const copyId = input.previewToken ? verifyPreviewToken(input.previewToken, context.shop.id) : null
      const copy = copyId ? await themeService.get(context.shop.id, copyId) : null
      if (copy && copy.themeId === input.themeId) return { document: copy.draft, preview: true }
      const live = await themeService.getLive(context.shop.id)
      return { document: live?.themeId === input.themeId ? live.published : null, preview: false }
    }),
  },
  cart: {
    create: storefront.cart.create.handler(async ({ input, context }) =>
      toCart(
        await cartService.create(
          context.shop.id,
          input.lines?.map((l) => ({ variantId: l.merchandiseId, quantity: l.quantity })),
        ),
      ),
    ),
    get: storefront.cart.get.handler(async ({ input, context }) =>
      toCart(await cartService.get(context.shop.id, input.id)),
    ),
    linesAdd: storefront.cart.linesAdd.handler(async ({ input, context }) =>
      toCart(
        await cartService.addLines(
          context.shop.id,
          input.cartId,
          input.lines.map((l) => ({ variantId: l.merchandiseId, quantity: l.quantity })),
        ),
      ),
    ),
    linesUpdate: storefront.cart.linesUpdate.handler(async ({ input, context }) =>
      toCart(
        await cartService.updateLines(
          context.shop.id,
          input.cartId,
          input.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })),
        ),
      ),
    ),
    linesRemove: storefront.cart.linesRemove.handler(async ({ input, context }) =>
      toCart(await cartService.removeLines(context.shop.id, input.cartId, input.lineIds)),
    ),
    discountCodesUpdate: storefront.cart.discountCodesUpdate.handler(async ({ input, context }) =>
      toCart(await cartService.setDiscountCode(context.shop.id, input.cartId, input.discountCodes[0] ?? null)),
    ),
  },
  checkout: {
    options: storefront.checkout.options.handler(async ({ input, context }) => {
      const cart = await cartService.get(context.shop.id, input.cartId)
      const [options, cost] = await Promise.all([
        checkoutService.options(context.shop.id, cart.subtotalCents),
        checkoutService.estimate(context.shop.id, cart, {
          shippingRateId: input.shippingRateId,
          address: input.countryCode ? { countryCode: input.countryCode, province: input.province } : undefined,
        }),
      ])
      const m = (cents: number) => money(cents, cart.currency)
      return {
        cost: {
          subtotalAmount: m(cost.subtotalCents),
          shippingAmount: m(cost.shippingCents),
          discountAmount: m(cost.discountCents),
          totalTaxAmount: cost.taxCents == null ? null : m(cost.taxCents),
          taxesIncluded: cost.taxesIncluded,
          totalAmount: m(cost.totalCents),
        },
        shippingRates: options.shippingRates.map((r) => ({
          id: r.id,
          title: r.title,
          price: money(r.priceCents, cart.currency),
        })),
        paymentMethods: options.paymentMethods,
      }
    }),
    complete: storefront.checkout.complete.handler(({ input: { cartId, shippingAddress, ...buyer }, context }) =>
      checkoutService.complete(
        context.shop.id,
        cartId,
        { ...buyer, shippingAddress: shippingAddress && checkoutService.toMailingAddress(shippingAddress) },
        // The hosted confirmation page shows the payment's outcome
        { returnUrl: `${appUrl()}/checkout/${cartId}` },
      ),
    ),
  },
})
