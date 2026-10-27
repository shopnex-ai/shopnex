// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
// Lifecycle follows Shopify: payment (financialStatus) and shipping (fulfillmentStatus) move independently;
// cancelling is its own fact (cancelledAt) and voids or refunds the payment.
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { variantService } from '@shopnex/catalog'
import { channelService } from '@shopnex/channels'
import { customerService } from '@shopnex/customers'
import { all, db, schema, type Conn } from '@shopnex/db'
import { notify } from '@shopnex/email'
import { calculate, discountService, taxService } from '@shopnex/pricing'
import type { CancelReason, FinancialStatus, FulfillmentStatus, MailingAddress } from '@shopnex/db/schema'
import { emit } from '@shopnex/webhooks'
import { OrderError } from './errors'

export type OrderLineInput =
  | { variantId: string; quantity: number }
  // Shorthand for products with a single variant
  | { productId: string; quantity: number }

export type CreateOrderInput = {
  items: OrderLineInput[]
  // Either an existing customer, or an email (guest — matched/created by email)
  customerId?: string
  email?: string
  name?: string
  phone?: string
  shippingAddress?: MailingAddress
  billingAddress?: MailingAddress
  // Delivery method chosen at checkout; free when the subtotal reaches freeAboveCents
  shipping?: { title: string; code: string | null; priceCents: number; freeAboveCents: number | null }
  // Payment method chosen at checkout (manual methods: paid outside Shopnex, marked as paid by staff)
  payment?: { gateway: string; name: string; instructions: string | null }
  // Case-insensitive. An unusable code fails the order (the buyer was shown the discounted total).
  discountCode?: string
  note?: string
  // The channel the order is placed on (checkout passes the cart's); orders made by staff go to the Online Store
  channelId?: string
}

export type ImportedOrderInput = {
  sourceOrderName: string
  email: string
  name?: string | null
  phone?: string | null
  financialStatus: FinancialStatus
  fulfillmentStatus: FulfillmentStatus
  cancelledAt?: Date | null
  fulfilledAt?: Date | null
  currency: string
  subtotalCents: number
  shippingCents: number
  taxCents: number
  discountCents: number
  totalCents: number
  discountCodes: string[]
  shippingTitle?: string | null
  shippingAddress?: MailingAddress | null
  billingAddress?: MailingAddress | null
  paymentMethodName?: string | null
  note?: string | null
  createdAt: Date
  items: {
    title: string
    variantTitle?: string | null
    sku?: string | null
    vendor?: string | null
    imageUrl?: string | null
    unitPriceCents: number
    quantity: number
    discountCents: number
  }[]
}

export type ListOrdersInput = {
  limit: number
  offset: number
  customerId?: string
  financialStatus?: FinancialStatus
  fulfillmentStatus?: FulfillmentStatus
  /** true: only cancelled; false: only open (not cancelled) */
  cancelled?: boolean
  search?: string
}

// Shipping is free once the subtotal reaches the rate's threshold
export function shippingPrice(rate: { priceCents: number; freeAboveCents: number | null }, subtotalCents: number) {
  return rate.freeAboveCents != null && subtotalCents >= rate.freeAboveCents ? 0 : rate.priceCents
}

// `search` matches the order number (1001 or #1001), the order email or the customer's name
export async function list(shopId: string, opts: ListOrdersInput, conn: Conn = db) {
  const filters: (SQL | undefined)[] = [eq(schema.orders.shopId, shopId)]
  if (opts.customerId) filters.push(eq(schema.orders.customerId, opts.customerId))
  if (opts.financialStatus) filters.push(eq(schema.orders.financialStatus, opts.financialStatus))
  if (opts.fulfillmentStatus) filters.push(eq(schema.orders.fulfillmentStatus, opts.fulfillmentStatus))
  if (opts.cancelled !== undefined) {
    filters.push(opts.cancelled ? isNotNull(schema.orders.cancelledAt) : isNull(schema.orders.cancelledAt))
  }
  if (opts.search) {
    const pattern = `%${opts.search.replace(/[\\%_]/g, '\\$&')}%`
    const number = /^#?(\d{1,9})$/.exec(opts.search.trim())?.[1]
    filters.push(
      or(
        ilike(schema.orders.email, pattern),
        ilike(schema.customers.name, pattern),
        number ? eq(schema.orders.orderNumber, Number(number)) : undefined,
      ),
    )
  }
  const where = and(...filters)
  const [rows, [counted]] = await Promise.all([
    conn
      .select({ order: schema.orders, customerName: schema.customers.name })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(where)
      .orderBy(desc(schema.orders.createdAt))
      .limit(opts.limit)
      .offset(opts.offset),
    conn
      .select({ total: count() })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(where),
  ])
  return { items: rows.map((r) => ({ ...r.order, customerName: r.customerName })), total: counted?.total ?? 0 }
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [order] = await conn
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.orders.id, id)))
  if (!order) return null
  const [items, shippingLines, transactions, fulfillments, customer] = await all(conn, [
    () => conn.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id)),
    () => conn.select().from(schema.orderShippingLines).where(eq(schema.orderShippingLines.orderId, id)),
    () =>
      conn
        .select()
        .from(schema.orderTransactions)
        .where(eq(schema.orderTransactions.orderId, id))
        .orderBy(schema.orderTransactions.processedAt),
    () =>
      conn
        .select()
        .from(schema.fulfillments)
        .where(eq(schema.fulfillments.orderId, id))
        .orderBy(schema.fulfillments.createdAt),
    () => (order.customerId ? customerService.getById(shopId, order.customerId, conn) : Promise.resolve(null)),
  ])

  return { ...order, items, shippingLines, transactions, fulfillments, customer }
}

export async function removeMany(shopId: string, ids: string[]) {
  if (!ids.length) return 0
  const deleted = await db
    .delete(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.id, ids)))
    .returning({ id: schema.orders.id })
  return deleted.length
}

/**
 * Adds historical imported orders without reserving stock, capturing payment, or sending order notifications.
 * Orders whose source name was already imported are skipped, so re-uploading a file is safe.
 */
export async function importHistoricalMany(shopId: string, inputs: ImportedOrderInput[]) {
  return db.transaction(async (tx) => {
    const channel = await channelService.getDefault(shopId, tx)
    const imported = []
    const skipped: string[] = []
    for (const input of inputs) {
      const marker = `[Imported order ${input.sourceOrderName}]`
      const [existing] = await tx
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(and(eq(schema.orders.shopId, shopId), sql`left(${schema.orders.note}, ${marker.length}) = ${marker}`))
        .limit(1)
      if (existing) { skipped.push(input.sourceOrderName); continue }
      const customer = await customerService.findOrCreateByEmail(shopId, {
        email: input.email,
        name: input.name ?? null,
        phone: input.phone ?? null,
        userId: null,
      }, tx)
      const [shop] = await tx
        .update(schema.shops)
        .set({ nextOrderNumber: sql`${schema.shops.nextOrderNumber} + 1` })
        .where(eq(schema.shops.id, shopId))
        .returning({ orderNumber: sql<number>`${schema.shops.nextOrderNumber} - 1` })
      if (!shop) throw new OrderError('CUSTOMER_NOT_FOUND', 'Shop not found')
      const importedNote = `${marker}${input.note ? `\n${input.note}` : ''}`
      const [order] = await tx.insert(schema.orders).values({
        shopId,
        orderNumber: shop.orderNumber,
        channelId: channel.id,
        customerId: customer.id,
        email: input.email,
        phone: input.phone ?? null,
        financialStatus: input.financialStatus,
        fulfillmentStatus: input.fulfillmentStatus,
        cancelledAt: input.cancelledAt ?? null,
        cancelReason: null,
        currency: input.currency,
        subtotalCents: input.subtotalCents,
        shippingCents: input.shippingCents,
        taxCents: input.taxCents,
        discountCents: input.discountCents,
        totalCents: input.totalCents,
        taxesIncluded: false,
        taxLines: [],
        discountCodes: input.discountCodes,
        shippingAddress: input.shippingAddress ?? null,
        billingAddress: input.billingAddress ?? input.shippingAddress ?? null,
        paymentGateway: 'imported',
        paymentMethodName: input.paymentMethodName ?? null,
        note: importedNote,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }).returning()
      await tx.insert(schema.orderItems).values(input.items.map((item) => ({
        orderId: order!.id,
        productId: null,
        variantId: null,
        title: item.title,
        variantTitle: item.variantTitle ?? null,
        sku: item.sku ?? null,
        vendor: item.vendor ?? null,
        imageUrl: item.imageUrl ?? null,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        discountCents: item.discountCents,
      })))
      if (input.shippingTitle && input.shippingCents > 0) {
        await tx.insert(schema.orderShippingLines).values({
          orderId: order!.id,
          title: input.shippingTitle,
          code: null,
          priceCents: input.shippingCents,
          discountCents: 0,
        })
      }
      if (input.fulfillmentStatus === 'fulfilled') {
        await tx.insert(schema.fulfillments).values({ orderId: order!.id, createdAt: input.fulfilledAt ?? input.createdAt })
      }
      imported.push(order!)
    }
    return { imported, skipped }
  })
}

// Pass `conn` to run inside an outer transaction (e.g. checkout completing a cart atomically)
export async function create(shopId: string, input: CreateOrderInput, conn: Conn = db) {
  if (input.items.length === 0) throw new OrderError('EMPTY_ORDER', 'Order has no items')

  return conn.transaction(async (tx) => {
    const customer = input.customerId
      ? await customerService.getById(shopId, input.customerId, tx)
      : input.email
        ? await customerService.findOrCreateByEmail(
            shopId,
            { email: input.email, name: input.name, phone: input.phone ?? input.shippingAddress?.phone ?? null },
            tx,
          )
        : null
    if (!customer) throw new OrderError('CUSTOMER_NOT_FOUND', 'Customer not found (pass customerId or email)')
    const channel = await channelService.resolve(shopId, input.channelId, tx)

    // Resolve every line to a variant. Prices come from the catalog, never from the caller.
    const variantIds = [...new Set(input.items.flatMap((i) => ('variantId' in i ? [i.variantId] : [])))]
    const productIds = [...new Set(input.items.flatMap((i) => ('productId' in i ? [i.productId] : [])))]
    const [byVariant, byProduct] = await all(tx, [
      () => variantService.getManyByIds(shopId, variantIds, tx),
      () => variantService.listForProducts(shopId, productIds, tx),
    ])
    const variants = new Map(byVariant.map((r) => [r.variant.id, r]))
    const missingVariants = variantIds.filter((id) => !variants.has(id))
    if (missingVariants.length) {
      throw new OrderError('VARIANT_NOT_FOUND', `Variants not found: ${missingVariants.join(', ')}`, {
        variantIds: missingVariants,
      })
    }
    const productVariants = new Map<string, typeof byProduct>()
    for (const r of byProduct)
      productVariants.set(r.variant.productId, [...(productVariants.get(r.variant.productId) ?? []), r])
    const missingProducts = productIds.filter((id) => !productVariants.has(id))
    if (missingProducts.length) {
      throw new OrderError('PRODUCT_NOT_FOUND', `Products not found: ${missingProducts.join(', ')}`, {
        productIds: missingProducts,
      })
    }

    const lines = input.items.map((i) => {
      let row
      if ('variantId' in i) {
        row = variants.get(i.variantId)!
      } else {
        const candidates = productVariants.get(i.productId)!
        if (candidates.length !== 1) {
          throw new OrderError('VARIANT_REQUIRED', `Product ${i.productId} has variants: order a variantId`)
        }
        row = candidates[0]!
      }
      const { variant, productTitle, productVendor, imageUrl } = row
      return {
        productId: variant.productId,
        variantId: variant.id,
        title: productTitle,
        // The hidden default variant has no meaningful title
        variantTitle: variant.optionsKey === '' ? null : variant.title,
        sku: variant.sku,
        vendor: productVendor || null,
        imageUrl,
        unitPriceCents: variant.priceCents,
        quantity: i.quantity,
      }
    })
    const subtotalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0)
    const shippingCents = input.shipping ? shippingPrice(input.shipping, subtotalCents) : 0

    // Locks the discount row until commit (usage limit / once per customer under concurrency)
    const discount = input.discountCode
      ? await discountService.checkForOrder(tx, shopId, input.discountCode, customer.id)
      : null
    if (discount?.error) throw new OrderError('DISCOUNT_NOT_APPLICABLE', discount.error)

    // Take stock (per variant, summed across lines); any shortfall rolls back the whole order
    const quantities = new Map<string, number>()
    for (const l of lines) quantities.set(l.variantId, (quantities.get(l.variantId) ?? 0) + l.quantity)
    for (const [variantId, quantity] of quantities) {
      if (!(await variantService.reserveStock(tx, variantId, quantity))) {
        const available =
          variants.get(variantId)?.variant.inventoryQuantity ??
          productVariants.get(lines.find((l) => l.variantId === variantId)!.productId)?.[0]?.variant
            .inventoryQuantity ??
          0
        throw new OrderError('OUT_OF_STOCK', `Not enough stock for variant ${variantId}`, { variantId, available })
      }
    }

    // Next order number, taken under the shop row's lock (concurrent checkouts get consecutive numbers).
    // Prices are in the shop's currency; record it so the order stays correct if the shop changes it later.
    const [shop] = await tx
      .update(schema.shops)
      .set({ nextOrderNumber: sql`${schema.shops.nextOrderNumber} + 1` })
      .where(eq(schema.shops.id, shopId))
      .returning({
        orderNumber: sql<number>`${schema.shops.nextOrderNumber} - 1`,
        currency: schema.shops.currency,
        taxesIncluded: schema.shops.taxesIncluded,
        taxShipping: schema.shops.taxShipping,
      })

    // Tax follows the shipping address (no address, e.g. a manual order: no tax)
    const taxRate = await taxService.rateForAddress(shopId, input.shippingAddress, tx)
    const totals = calculate({
      lines: lines.map((l) => l.unitPriceCents * l.quantity),
      shippingCents,
      discount: discount?.discount,
      taxRate,
      taxesIncluded: shop!.taxesIncluded,
      taxShipping: shop!.taxShipping,
    })
    if (!totals.discountApplicable) {
      throw new OrderError(
        'DISCOUNT_NOT_APPLICABLE',
        `Discount code "${discount!.discount!.code}" needs a subtotal of at least ${new Intl.NumberFormat('en', { style: 'currency', currency: shop!.currency }).format(discount!.discount!.minSubtotalCents! / 100)}`,
      )
    }

    const [order] = await tx
      .insert(schema.orders)
      .values({
        shopId,
        orderNumber: shop!.orderNumber,
        channelId: channel.id,
        customerId: customer.id,
        email: customer.email,
        phone: input.phone ?? input.shippingAddress?.phone ?? null,
        currency: shop!.currency,
        subtotalCents,
        shippingCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        taxesIncluded: totals.taxesIncluded,
        taxLines: totals.taxLines,
        discountCodes: discount?.discount ? [discount.discount.code] : [],
        shippingAddress: input.shippingAddress ?? null,
        billingAddress: input.billingAddress ?? input.shippingAddress ?? null,
        paymentGateway: input.payment?.gateway ?? 'manual',
        paymentMethodName: input.payment?.name ?? null,
        paymentInstructions: input.payment?.instructions ?? null,
        note: input.note ?? null,
      })
      .returning()
    const items = await tx
      .insert(schema.orderItems)
      .values(lines.map((l, i) => ({ ...l, orderId: order!.id, discountCents: totals.lineDiscountCents[i]! })))
      .returning()
    const shippingLines = input.shipping
      ? await tx
          .insert(schema.orderShippingLines)
          .values({
            orderId: order!.id,
            title: input.shipping.title,
            code: input.shipping.code,
            priceCents: shippingCents,
            discountCents: totals.shippingDiscountCents,
          })
          .returning()
      : []
    if (discount?.discount) await discountService.redeem(tx, discount.discount, order!)
    await emit(tx, shopId, 'order.created', () => getById(shopId, order!.id, tx))
    await notify(tx, shopId, 'order.created', () => getById(shopId, order!.id, tx))
    return { ...order!, items, shippingLines }
  })
}

// Locks the order row for a state change. Throws NOT_FOUND when it isn't in this shop.
async function lockOrder(tx: Conn, shopId: string, id: string) {
  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.orders.id, id)))
    .for('update')
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found')
  return order
}

const touch = (tx: Conn, id: string, patch: Partial<typeof schema.orders.$inferInsert>) =>
  tx
    .update(schema.orders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.orders.id, id))
    .returning()
    .then((rows) => rows[0]!)

// Manual payment received (Shopify "Mark as paid"): records a successful sale for the outstanding amount
export async function markAsPaid(shopId: string, id: string) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, shopId, id)
    if (order.cancelledAt) throw new OrderError('ORDER_CANCELLED', 'Order is cancelled')
    if (order.financialStatus !== 'pending' && order.financialStatus !== 'partially_paid') {
      throw new OrderError('INVALID_STATUS_TRANSITION', `Order is already ${order.financialStatus.replace('_', ' ')}`)
    }
    const [paid] = await tx
      .select({ cents: sql<number>`coalesce(sum(${schema.orderTransactions.amountCents}), 0)::int` })
      .from(schema.orderTransactions)
      .where(
        and(
          eq(schema.orderTransactions.orderId, id),
          eq(schema.orderTransactions.kind, 'sale'),
          eq(schema.orderTransactions.status, 'success'),
        ),
      )
    await tx.insert(schema.orderTransactions).values({
      orderId: id,
      kind: 'sale',
      status: 'success',
      gateway: order.paymentGateway ?? 'manual',
      amountCents: order.totalCents - (paid?.cents ?? 0),
      currency: order.currency,
    })
    const updated = await touch(tx, id, { financialStatus: 'paid' })
    await emit(tx, shopId, 'order.paid', () => getById(shopId, id, tx))
    await notify(tx, shopId, 'order.paid', () => getById(shopId, id, tx))
    return updated
  })
}

export type FulfillInput = { trackingCompany?: string; trackingNumber?: string; trackingUrl?: string }

// Ships every item (partial fulfillment comes later). Allowed before payment, as in Shopify.
export async function fulfill(shopId: string, id: string, tracking: FulfillInput = {}) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, shopId, id)
    if (order.cancelledAt) throw new OrderError('ORDER_CANCELLED', 'Order is cancelled')
    if (order.fulfillmentStatus === 'fulfilled') {
      throw new OrderError('INVALID_STATUS_TRANSITION', 'Order is already fulfilled')
    }
    await tx.insert(schema.fulfillments).values({
      orderId: id,
      trackingCompany: tracking.trackingCompany || null,
      trackingNumber: tracking.trackingNumber || null,
      trackingUrl: tracking.trackingUrl || null,
    })
    const updated = await touch(tx, id, { fulfillmentStatus: 'fulfilled' })
    await emit(tx, shopId, 'order.fulfilled', () => getById(shopId, id, tx))
    await notify(tx, shopId, 'order.fulfilled', () => getById(shopId, id, tx))
    return updated
  })
}

export type CancelInput = { reason: CancelReason; restock: boolean }

// Shopify-style cancel: unpaid → voided; paid → refunded (manual methods: money goes back outside Shopnex,
// recorded as a refund transaction). Paid through a payments app: the refund transaction stays pending and the
// order paid until the app confirms it (@shopnex/payments sends it a refund session).
// Fulfilled orders can't be cancelled (returns come later).
export async function cancel(shopId: string, id: string, input: CancelInput) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, shopId, id)
    if (order.cancelledAt) throw new OrderError('ORDER_CANCELLED', 'Order is already cancelled')
    if (order.fulfillmentStatus !== 'unfulfilled') {
      throw new OrderError('INVALID_STATUS_TRANSITION', "Fulfilled orders can't be cancelled")
    }
    if (input.restock) {
      const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id))
      for (const item of items) {
        if (item.variantId) await variantService.restock(tx, item.variantId, item.quantity)
      }
    }
    let financialStatus = order.financialStatus
    if (order.financialStatus === 'paid' || order.financialStatus === 'partially_paid') {
      const [paid] = await tx
        .select({ cents: sql<number>`coalesce(sum(${schema.orderTransactions.amountCents}), 0)::int` })
        .from(schema.orderTransactions)
        .where(
          and(
            eq(schema.orderTransactions.orderId, id),
            eq(schema.orderTransactions.kind, 'sale'),
            eq(schema.orderTransactions.status, 'success'),
          ),
        )
      const manual = (order.paymentGateway ?? 'manual') === 'manual'
      await tx.insert(schema.orderTransactions).values({
        orderId: id,
        kind: 'refund',
        status: manual ? 'success' : 'pending',
        gateway: order.paymentGateway ?? 'manual',
        amountCents: paid?.cents ?? order.totalCents,
        currency: order.currency,
      })
      if (manual) financialStatus = 'refunded'
    } else if (order.financialStatus === 'pending' || order.financialStatus === 'authorized') {
      financialStatus = 'voided'
    }
    const updated = await touch(tx, id, { cancelledAt: new Date(), cancelReason: input.reason, financialStatus })
    await emit(tx, shopId, 'order.cancelled', () => getById(shopId, id, tx))
    await notify(tx, shopId, 'order.cancelled', () => getById(shopId, id, tx))
    return updated
  })
}
