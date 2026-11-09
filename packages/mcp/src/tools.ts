// The tools, hand-picked for what people ask a store assistant, not one per endpoint (a flat list of 100+ similar
// tools makes models choose badly). Three rules shape them:
//  - Answers are summaries (top N plus a total, a way to page on), never raw rows: they must fit a context window.
//  - Writes create drafts. Anything that goes live, spends money or tells a customer needs `confirm: true`; without it
//    the tool only says what it would do. The token's scopes are the real limit; this is the habit on top.
//  - `readOnly` removes every write tool, so a read-only setup can't be talked into a write.
import { z } from 'zod'
import type { ShopnexClient } from './client'

export type Tool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string
  title: string
  description: string
  input: S
  /** Changes something in the shop */
  write: boolean
  /** Hard to undo or visible to customers: gated behind `confirm` */
  gated?: boolean
  run: (args: z.infer<z.ZodObject<S>>, client: ShopnexClient) => Promise<unknown>
}

const tool = <S extends z.ZodRawShape>(t: Tool<S>) => t as unknown as Tool

// ---- shared bits ----

const MAX_PAGE = 50
const page = {
  limit: z.number().int().min(1).max(MAX_PAGE).default(20).describe(`How many to return (max ${MAX_PAGE})`),
  offset: z.number().int().min(0).default(0).describe('Skip this many (use nextOffset from the previous answer)'),
}
const id = (what: string) => z.uuid().describe(`The ${what} id`)
const confirm = z
  .boolean()
  .default(false)
  .describe('Must be true to actually do it. Leave false to see what would happen, and ask the user first.')

type Money = { priceCents: number }
// null: stock isn't tracked for this variant
type Variant = Money & { id: string; title: string; sku: string | null; inventoryQuantity: number | null }
type Product = {
  id: string
  title: string
  status: string
  slug: string
  vendor: string
  productType: string
  tags: string[]
  description?: string
  variants: Variant[]
  images: { url: string }[]
  collectionSlugs: string[]
}
type Paged<T> = { items: T[]; total: number }

const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`
const toCents = (amount: number) => Math.round(amount * 100)

/** One answer shape for every list: what came back, how many exist, where to continue */
const paged = <T, R>(res: Paged<T>, offset: number, map: (item: T) => R) => ({
  total: res.total,
  returned: res.items.length,
  nextOffset: offset + res.items.length < res.total ? offset + res.items.length : null,
  items: res.items.map(map),
})

const productRow = (p: Product) => {
  const prices = p.variants.map((v) => v.priceCents)
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    productType: p.productType || undefined,
    priceCents: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : undefined,
    stock: p.variants.some((v) => v.inventoryQuantity !== null)
      ? p.variants.reduce((n, v) => n + (v.inventoryQuantity ?? 0), 0)
      : 'not tracked',
    variants: p.variants.length,
  }
}

type Order = {
  id: string
  orderNumber: number
  email: string
  customerName?: string | null
  financialStatus: string
  fulfillmentStatus: string
  cancelledAt: string | null
  currency: string
  totalCents: number
  createdAt: string
}
const orderRow = (o: Order) => ({
  id: o.id,
  number: o.orderNumber,
  customer: o.customerName || o.email,
  email: o.email,
  total: money(o.totalCents, o.currency),
  paid: o.financialStatus,
  fulfillment: o.fulfillmentStatus,
  cancelled: Boolean(o.cancelledAt),
  placedAt: o.createdAt,
})

/** Gated tools answer with what they would do until the user has said yes */
const preview = (what: string) => ({
  done: false,
  message: `Not done yet. This would ${what}. Ask the user to confirm, then call again with confirm: true.`,
})

// ---- read ----

const getShop = tool({
  name: 'get_shop',
  title: 'Shop details',
  description: 'The shop this token belongs to: name, currency and contact details. Call first to know the currency.',
  input: {},
  write: false,
  run: (_, c) => c.get('/shop'),
})

const salesSummary = tool({
  name: 'sales_summary',
  title: 'Sales summary',
  description:
    'Sales, orders and average order value for the last N days compared with the N days before, the best-selling ' +
    'products, and how many orders need attention (unpaid, unfulfilled). Amounts are in cents.',
  input: { days: z.number().int().min(1).max(365).default(30).describe('Period length in days') },
  write: false,
  run: async ({ days }, c) => {
    const o = await c.get<{
      current: unknown
      previous: unknown
      topProducts: { title: string; salesCents: number; units: number }[]
      attention: unknown
    }>('/analytics/overview', { days })
    return {
      days,
      current: o.current,
      previous: o.previous,
      topProducts: o.topProducts.slice(0, 10),
      attention: o.attention,
    }
  },
})

const listProducts = tool({
  name: 'list_products',
  title: 'Find products',
  description:
    'Search or list products. Returns one short row each (title, status, price range, total stock). ' +
    'Use get_product for the details of one.',
  input: { search: z.string().max(200).optional().describe('Title, SKU or vendor'), ...page },
  write: false,
  run: async ({ search, limit, offset }, c) =>
    paged(await c.get<Paged<Product>>('/products', { search, limit, offset }), offset, productRow),
})

const getProduct = tool({
  name: 'get_product',
  title: 'Product details',
  description: 'One product in full: description, variants with SKU, price and stock, images, collections.',
  input: { id: id('product') },
  write: false,
  run: async ({ id }, c) => {
    const p = await c.get<Product>(`/products/${id}`)
    return {
      ...productRow(p),
      slug: p.slug,
      vendor: p.vendor,
      tags: p.tags,
      description: p.description,
      collections: p.collectionSlugs,
      images: p.images.map((i) => i.url),
      variantList: p.variants.map((v) => ({
        id: v.id,
        title: v.title,
        sku: v.sku,
        priceCents: v.priceCents,
        stock: v.inventoryQuantity,
      })),
    }
  },
})

// There is no inventory endpoint: read products page by page, up to a cap, and say when the scan was cut short.
const SCAN_PAGE = 100
const SCAN_MAX = 1000
const lowStock = tool({
  name: 'low_stock',
  title: 'Low stock',
  description:
    'Variants at or below a stock threshold, lowest first. Scans up to 1000 products; `complete` says whether it saw them all.',
  input: {
    threshold: z.number().int().min(0).max(1000).default(5).describe('Stock at or below this counts as low'),
    limit: page.limit,
  },
  write: false,
  run: async ({ threshold, limit }, c) => {
    const low: {
      product: string
      productId: string
      variant: string
      variantId: string
      sku: string | null
      stock: number
    }[] = []
    let seen = 0
    let total = 0
    while (seen < SCAN_MAX) {
      const res = await c.get<Paged<Product>>('/products', { limit: SCAN_PAGE, offset: seen })
      total = res.total
      for (const p of res.items) {
        if (p.status === 'archived') continue
        for (const v of p.variants) {
          if (v.inventoryQuantity !== null && v.inventoryQuantity <= threshold) {
            low.push({
              product: p.title,
              productId: p.id,
              variant: v.title,
              variantId: v.id,
              sku: v.sku,
              stock: v.inventoryQuantity,
            })
          }
        }
      }
      seen += res.items.length
      if (res.items.length < SCAN_PAGE) break
    }
    low.sort((a, b) => a.stock - b.stock)
    return { threshold, complete: seen >= total, productsScanned: seen, found: low.length, items: low.slice(0, limit) }
  },
})

const listOrders = tool({
  name: 'list_orders',
  title: 'Find orders',
  description:
    'Orders, newest first. Filter by payment or fulfillment status, or search by order number, email or customer name. ' +
    'For "what needs shipping", use paid: "paid" with fulfillment: "unfulfilled".',
  input: {
    search: z.string().max(200).optional().describe('Order number (1001 or #1001), email or name'),
    paid: z
      .enum(['pending', 'authorized', 'partially_paid', 'paid', 'partially_refunded', 'refunded', 'voided'])
      .optional()
      .describe('Payment status'),
    fulfillment: z.enum(['unfulfilled', 'partially_fulfilled', 'fulfilled']).optional(),
    cancelled: z.boolean().optional().describe('true: only cancelled; false: only open'),
    ...page,
  },
  write: false,
  run: async ({ search, paid, fulfillment, cancelled, limit, offset }, c) =>
    paged(
      await c.get<Paged<Order>>('/orders', {
        search,
        financialStatus: paid,
        fulfillmentStatus: fulfillment,
        cancelled,
        limit,
        offset,
      }),
      offset,
      orderRow,
    ),
})

const getOrder = tool({
  name: 'get_order',
  title: 'Order details',
  description: 'One order in full: items, totals, shipping address, payments and fulfillments.',
  input: { id: id('order') },
  write: false,
  run: async ({ id }, c) => {
    const o = await c.get<
      Order & {
        items: { title: string; variantTitle?: string | null; quantity: number; priceCents: number }[]
        shippingAddress: unknown
        discountCodes: string[]
        fulfillments: { trackingNumber?: string | null; trackingCompany?: string | null }[]
        transactions: { kind?: string; status?: string; amountCents?: number }[]
      }
    >(`/orders/${id}`)
    return {
      ...orderRow(o),
      items: o.items.map((i) => ({
        title: i.title,
        variant: i.variantTitle ?? undefined,
        quantity: i.quantity,
        priceCents: i.priceCents,
      })),
      discountCodes: o.discountCodes,
      shippingAddress: o.shippingAddress,
      transactions: o.transactions,
      fulfillments: o.fulfillments,
    }
  },
})

type Customer = { id: string; email: string; name: string | null; ordersCount?: number; totalSpentCents?: number }
const listCustomers = tool({
  name: 'list_customers',
  title: 'Find customers',
  description: 'Search customers by name or email.',
  input: { search: z.string().max(200).optional(), ...page },
  write: false,
  run: async ({ search, limit, offset }, c) =>
    paged(await c.get<Paged<Customer>>('/customers', { search, limit, offset }), offset, (x) => x),
})

const listDiscounts = tool({
  name: 'list_discounts',
  title: 'Discount codes',
  description: 'All discount codes with their type, value, limits and whether they are active.',
  input: {},
  write: false,
  run: async (_, c) => {
    const rows = await c.get<
      {
        id: string
        code: string
        type: string
        value: number
        active: boolean
        usageLimit: number | null
        endsAt: string | null
      }[]
    >('/discounts')
    return rows.map((d) => ({
      id: d.id,
      code: d.code,
      type: d.type,
      value: d.value,
      active: d.active,
      usageLimit: d.usageLimit,
      endsAt: d.endsAt,
    }))
  },
})

const listCollections = tool({
  name: 'list_collections',
  title: 'Collections',
  description: 'Product collections (title, handle).',
  input: { ...page },
  write: false,
  run: async ({ limit, offset }, c) => {
    const rows = await c.get<
      { id: string; title: string; slug: string }[] | Paged<{ id: string; title: string; slug: string }>
    >('/collections', { limit, offset })
    const items = Array.isArray(rows) ? rows : rows.items
    return { returned: items.length, items: items.map((x) => ({ id: x.id, title: x.title, handle: x.slug })) }
  },
})

// ---- write: drafts and reversible edits ----

const createProductDraft = tool({
  name: 'create_product_draft',
  title: 'Create a product as a draft',
  description:
    'Creates a product as a DRAFT: customers cannot see it until publish_product. Price is in the shop currency ' +
    '(e.g. 19.99). For several variants, create the product, then edit it in the admin.',
  input: {
    title: z.string().min(1).max(300),
    description: z.string().max(20_000).optional().describe('Plain text or simple HTML'),
    price: z.number().min(0).describe('Price in the shop currency, e.g. 19.99'),
    vendor: z.string().max(200).optional(),
    productType: z.string().max(200).optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    imageUrls: z.array(z.url()).max(10).optional().describe('Public https image URLs'),
  },
  write: true,
  run: async (a, c) => {
    const p = await c.send<Product>('POST', '/products', {
      title: a.title,
      status: 'draft',
      descriptionHtml: a.description,
      priceCents: toCents(a.price),
      vendor: a.vendor,
      productType: a.productType,
      tags: a.tags,
      images: a.imageUrls?.map((url) => ({ url })),
    })
    return { created: true, ...productRow(p), next: 'Review it, then publish_product to put it on sale.' }
  },
})

const updateProduct = tool({
  name: 'update_product',
  title: 'Edit a product',
  description:
    "Edits a product's text fields. Does not change whether it is on sale (see publish_product / archive_product) " +
    'and does not touch prices or stock (see update_variant). If it is already live the change is live at once.',
  input: {
    id: id('product'),
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(20_000).optional(),
    vendor: z.string().max(200).optional(),
    productType: z.string().max(200).optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    seoTitle: z.string().max(200).optional(),
    seoDescription: z.string().max(500).optional(),
  },
  write: true,
  run: async ({ id, description, seoTitle, seoDescription, ...rest }, c) => {
    const p = await c.send<Product>('PATCH', `/products/${id}`, {
      ...rest,
      ...(description !== undefined && { descriptionHtml: description }),
      ...((seoTitle !== undefined || seoDescription !== undefined) && {
        seo: { title: seoTitle ?? '', description: seoDescription ?? '' },
      }),
    })
    return { updated: true, ...productRow(p) }
  },
})

const updateVariant = tool({
  name: 'update_variant',
  title: "Change a variant's price or stock",
  description:
    'Sets the price and/or the stock of one variant (ids from get_product). Price is in the shop currency. ' +
    'It takes effect on the storefront at once.',
  input: {
    variantId: id('variant'),
    price: z.number().min(0).optional().describe('New price, e.g. 19.99'),
    compareAtPrice: z.number().min(0).nullable().optional().describe('Crossed-out price; null removes it'),
    stock: z.number().int().min(0).optional().describe('New stock quantity'),
  },
  write: true,
  run: async ({ variantId, price, compareAtPrice, stock }, c) => {
    const v = await c.send<Variant>('PATCH', `/variants/${variantId}`, {
      ...(price !== undefined && { priceCents: toCents(price) }),
      ...(compareAtPrice !== undefined && {
        compareAtPriceCents: compareAtPrice === null ? null : toCents(compareAtPrice),
      }),
      ...(stock !== undefined && { inventoryQuantity: stock }),
    })
    return { updated: true, variantId: v.id, priceCents: v.priceCents, stock: v.inventoryQuantity }
  },
})

const createDiscountDraft = tool({
  name: 'create_discount_draft',
  title: 'Create a discount code (inactive)',
  description:
    'Creates a discount code that is NOT active yet; customers cannot use it until activate_discount. ' +
    'percentage: value is 1–100. fixed_amount: value is in the shop currency (e.g. 5 for 5.00 off).',
  input: {
    code: z.string().regex(/^\S+$/, 'No spaces').max(100),
    type: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
    value: z.number().min(0).describe('Percent for percentage; money for fixed_amount; ignored for free_shipping'),
    usageLimit: z.number().int().min(1).optional().describe('Total uses allowed'),
    oncePerCustomer: z.boolean().optional(),
    endsAt: z.iso.datetime().optional().describe('ISO date-time when it stops working'),
  },
  write: true,
  run: async (a, c) => {
    const d = await c.send<{ id: string; code: string; active: boolean }>('POST', '/discounts', {
      code: a.code,
      type: a.type,
      value: a.type === 'fixed_amount' ? toCents(a.value) : a.type === 'free_shipping' ? 0 : Math.round(a.value),
      usageLimit: a.usageLimit,
      oncePerCustomer: a.oncePerCustomer,
      endsAt: a.endsAt,
      active: false,
    })
    return { created: true, id: d.id, code: d.code, active: d.active, next: 'activate_discount makes it usable.' }
  },
})

// ---- write: goes live / touches customers (gated) ----

const publishProduct = tool({
  name: 'publish_product',
  title: 'Put a product on sale',
  description: 'Makes a draft (or archived) product visible and buyable on the storefront.',
  input: { id: id('product'), confirm },
  write: true,
  gated: true,
  run: async ({ id, confirm }, c) => {
    const p = await c.get<Product>(`/products/${id}`)
    if (p.status === 'active') return { done: true, message: `"${p.title}" is already on sale.` }
    if (!confirm) return preview(`put "${p.title}" on sale (${p.variants.length} variant(s), now ${p.status})`)
    await c.send('PATCH', `/products/${id}`, { status: 'active' })
    return { done: true, message: `"${p.title}" is now on sale.` }
  },
})

const archiveProduct = tool({
  name: 'archive_product',
  title: 'Take a product off sale',
  description: 'Hides a product from the storefront. It is kept and can be published again.',
  input: { id: id('product'), confirm },
  write: true,
  gated: true,
  run: async ({ id, confirm }, c) => {
    const p = await c.get<Product>(`/products/${id}`)
    if (p.status === 'archived') return { done: true, message: `"${p.title}" is already archived.` }
    if (!confirm) return preview(`take "${p.title}" off sale`)
    await c.send('PATCH', `/products/${id}`, { status: 'archived' })
    return { done: true, message: `"${p.title}" is archived.` }
  },
})

const activateDiscount = tool({
  name: 'activate_discount',
  title: 'Turn a discount code on or off',
  description: 'Makes a discount code usable by customers (active: true) or stops it (active: false).',
  input: { id: id('discount'), active: z.boolean().default(true), confirm },
  write: true,
  gated: true,
  run: async ({ id, active, confirm }, c) => {
    const d = await c.get<{ code: string; type: string; value: number; active: boolean }>(`/discounts/${id}`)
    if (d.active === active) return { done: true, message: `${d.code} is already ${active ? 'active' : 'off'}.` }
    if (!confirm) return preview(`${active ? 'turn on' : 'turn off'} the code ${d.code} (${d.type} ${d.value})`)
    await c.send('PATCH', `/discounts/${id}`, { active })
    return { done: true, message: `${d.code} is now ${active ? 'active' : 'off'}.` }
  },
})

const markOrderPaid = tool({
  name: 'mark_order_paid',
  title: 'Mark an order as paid',
  description: 'Records an order as paid (for example a bank transfer that arrived). Does not charge anyone.',
  input: { id: id('order'), confirm },
  write: true,
  gated: true,
  run: async ({ id, confirm }, c) => {
    const o = await c.get<Order>(`/orders/${id}`)
    if (o.financialStatus === 'paid') return { done: true, message: `Order #${o.orderNumber} is already paid.` }
    if (!confirm)
      return preview(`mark order #${o.orderNumber} (${money(o.totalCents, o.currency)}, ${o.financialStatus}) as paid`)
    await c.send('POST', `/orders/${id}/mark-as-paid`)
    return { done: true, message: `Order #${o.orderNumber} is marked paid.` }
  },
})

const fulfillOrder = tool({
  name: 'fulfill_order',
  title: 'Mark an order as shipped',
  description: 'Marks an order fulfilled, with optional tracking. The customer may be emailed.',
  input: {
    id: id('order'),
    trackingCompany: z.string().max(100).optional(),
    trackingNumber: z.string().max(100).optional(),
    trackingUrl: z.url().optional(),
    confirm,
  },
  write: true,
  gated: true,
  run: async ({ id, confirm, ...tracking }, c) => {
    const o = await c.get<Order>(`/orders/${id}`)
    if (o.fulfillmentStatus === 'fulfilled')
      return { done: true, message: `Order #${o.orderNumber} is already fulfilled.` }
    if (o.cancelledAt) return { done: false, message: `Order #${o.orderNumber} is cancelled and can't be shipped.` }
    if (!confirm)
      return preview(
        `mark order #${o.orderNumber} for ${o.customerName || o.email} as shipped (the customer may be notified)`,
      )
    await c.send('POST', `/orders/${id}/fulfill`, tracking)
    return { done: true, message: `Order #${o.orderNumber} is fulfilled.` }
  },
})

const cancelOrder = tool({
  name: 'cancel_order',
  title: 'Cancel an order',
  description:
    'Cancels an order and optionally puts its stock back. A paid order is refunded where the payment provider allows. ' +
    'This cannot be undone. Always show the user the order first.',
  input: {
    id: id('order'),
    reason: z.enum(['customer', 'declined', 'fraud', 'inventory', 'staff', 'other']),
    restock: z.boolean().describe('Put the items back in stock'),
    confirm,
  },
  write: true,
  gated: true,
  run: async ({ id, reason, restock, confirm }, c) => {
    const o = await c.get<Order>(`/orders/${id}`)
    if (o.cancelledAt) return { done: true, message: `Order #${o.orderNumber} is already cancelled.` }
    if (!confirm) {
      return preview(
        `cancel order #${o.orderNumber} (${money(o.totalCents, o.currency)}, ${o.financialStatus}) for ${o.customerName || o.email}, reason "${reason}", ${restock ? 'restocking' : 'not restocking'} the items. It cannot be undone`,
      )
    }
    await c.send('POST', `/orders/${id}/cancel`, { reason, restock })
    return { done: true, message: `Order #${o.orderNumber} is cancelled.` }
  },
})

export const TOOLS: Tool[] = [
  getShop,
  salesSummary,
  listProducts,
  getProduct,
  lowStock,
  listOrders,
  getOrder,
  listCustomers,
  listDiscounts,
  listCollections,
  createProductDraft,
  updateProduct,
  updateVariant,
  createDiscountDraft,
  publishProduct,
  archiveProduct,
  activateDiscount,
  markOrderPaid,
  fulfillOrder,
  cancelOrder,
]
