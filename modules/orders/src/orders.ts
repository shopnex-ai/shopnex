// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
// Lifecycle follows Shopify: payment (financialStatus) and shipping (fulfillmentStatus) move independently;
// cancelling is its own fact (cancelledAt) and voids or refunds the payment.
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { variantService } from '@shopnex/catalog'
import { channelService } from '@shopnex/channels'
import { customerService } from '@shopnex/customers'
import { all, db, schema, type Conn } from '@shopnex/db'
import { customFieldService, type CustomFieldUpdates } from '@shopnex/custom-fields'
import { calculate, taxService } from '@shopnex/pricing'
import { checkDiscount, redeemDiscount } from './discount-redemptions'
import { formatMoney } from '@shopnex/storefront-sdk/money'
import { emit } from '@shopnex/webhooks'
import { OrderError } from './orders.errors'
import { orderEvent } from './orders.hooks'
import { shops } from '@shopnex/core/schema'
import {
  type CancelReason,
  type FinancialStatus,
  fulfillments as fulfillmentsTable,
  type FulfillmentStatus,
  type MailingAddress,
  orderItems,
  orders,
  orderShippingLines,
  orderTransactions,
} from './orders.schema'
import { customers } from '@shopnex/customers/schema'

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
  // Payment method chosen at checkout (manual methods: paid outside ShopNex, marked as paid by staff)
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
  const filters: (SQL | undefined)[] = [eq(orders.shopId, shopId)]
  if (opts.customerId) filters.push(eq(orders.customerId, opts.customerId))
  if (opts.financialStatus) filters.push(eq(orders.financialStatus, opts.financialStatus))
  if (opts.fulfillmentStatus) filters.push(eq(orders.fulfillmentStatus, opts.fulfillmentStatus))
  if (opts.cancelled !== undefined) {
    filters.push(opts.cancelled ? isNotNull(orders.cancelledAt) : isNull(orders.cancelledAt))
  }
  if (opts.search) {
    const pattern = `%${opts.search.replace(/[\\%_]/g, '\\$&')}%`
    const number = /^#?(\d{1,9})$/.exec(opts.search.trim())?.[1]
    filters.push(
      or(
        ilike(orders.email, pattern),
        ilike(customers.name, pattern),
        number ? eq(orders.orderNumber, Number(number)) : undefined,
      ),
    )
  }
  const where = and(...filters)
  const [rows, [counted]] = await Promise.all([
    conn
      .select({ order: orders, customerName: customers.name })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(opts.limit)
      .offset(opts.offset),
    conn.select({ total: count() }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId)).where(where),
  ])
  return { items: rows.map((r) => ({ ...r.order, customerName: r.customerName })), total: counted?.total ?? 0 }
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [order] = await conn
    .select()
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.id, id)))
  if (!order) return null
  const [items, shippingLines, transactions, fulfillments, customer] = await all(conn, [
    () => conn.select().from(orderItems).where(eq(orderItems.orderId, id)),
    () => conn.select().from(orderShippingLines).where(eq(orderShippingLines.orderId, id)),
    () =>
      conn
        .select()
        .from(orderTransactions)
        .where(eq(orderTransactions.orderId, id))
        .orderBy(orderTransactions.processedAt),
    () =>
      conn
        .select()
        .from(fulfillmentsTable)
        .where(eq(fulfillmentsTable.orderId, id))
        .orderBy(fulfillmentsTable.createdAt),
    () => (order.customerId ? customerService.getById(shopId, order.customerId, conn) : Promise.resolve(null)),
  ])

  return { ...order, items, shippingLines, transactions, fulfillments, customer }
}

export async function removeMany(shopId: string, ids: string[]) {
  if (!ids.length) return 0
  const deleted = await db
    .delete(orders)
    .where(and(eq(orders.shopId, shopId), inArray(orders.id, ids)))
    .returning({ id: orders.id })
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
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.shopId, shopId), sql`left(${orders.note}, ${marker.length}) = ${marker}`))
        .limit(1)
      if (existing) {
        skipped.push(input.sourceOrderName)
        continue
      }
      const customer = await customerService.findOrCreateByEmail(
        shopId,
        {
          email: input.email,
          name: input.name ?? null,
          phone: input.phone ?? null,
          userId: null,
        },
        tx,
      )
      const [shop] = await tx
        .update(shops)
        .set({ nextOrderNumber: sql`${shops.nextOrderNumber} + 1` })
        .where(eq(shops.id, shopId))
        .returning({ orderNumber: sql<number>`${shops.nextOrderNumber} - 1` })
      if (!shop) throw new OrderError('CUSTOMER_NOT_FOUND', 'Shop not found')
      const importedNote = `${marker}${input.note ? `\n${input.note}` : ''}`
      const [order] = await tx
        .insert(orders)
        .values({
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
        })
        .returning()
      await tx.insert(orderItems).values(
        input.items.map((item) => ({
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
        })),
      )
      if (input.shippingTitle && input.shippingCents > 0) {
        await tx.insert(orderShippingLines).values({
          orderId: order!.id,
          title: input.shippingTitle,
          code: null,
          priceCents: input.shippingCents,
          discountCents: 0,
        })
      }
      if (input.fulfillmentStatus === 'fulfilled') {
        await tx
          .insert(fulfillmentsTable)
          .values({ orderId: order!.id, createdAt: input.fulfilledAt ?? input.createdAt })
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
    const discount = input.discountCode ? await checkDiscount(tx, shopId, input.discountCode, customer.id) : null
    if (discount?.error) throw new OrderError('DISCOUNT_NOT_APPLICABLE', discount.error)

    // Take stock (per variant, summed across lines); any shortfall rolls back the whole order
    const quantities = new Map<string, number>()
    for (const l of lines) quantities.set(l.variantId, (quantities.get(l.variantId) ?? 0) + l.quantity)
    for (const [variantId, quantity] of quantities) {
      if (!(await variantService.reserveStock(shopId, variantId, quantity, tx))) {
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
      .update(shops)
      .set({ nextOrderNumber: sql`${shops.nextOrderNumber} + 1` })
      .where(eq(shops.id, shopId))
      .returning({
        orderNumber: sql<number>`${shops.nextOrderNumber} - 1`,
        currency: shops.currency,
        taxesIncluded: shops.taxesIncluded,
        taxShipping: shops.taxShipping,
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
        `Discount code "${discount!.discount!.code}" needs a subtotal of at least ${formatMoney({ amountMinor: discount!.discount!.minSubtotalCents!, currencyCode: shop!.currency })}`,
      )
    }

    const [order] = await tx
      .insert(orders)
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
      .insert(orderItems)
      .values(lines.map((l, i) => ({ ...l, orderId: order!.id, discountCents: totals.lineDiscountCents[i]! })))
      .returning()
    const shippingLines = input.shipping
      ? await tx
          .insert(orderShippingLines)
          .values({
            orderId: order!.id,
            title: input.shipping.title,
            code: input.shipping.code,
            priceCents: shippingCents,
            discountCents: totals.shippingDiscountCents,
          })
          .returning()
      : []
    if (discount?.discount) await redeemDiscount(tx, discount.discount, order!)
    await emit(tx, shopId, 'order.created', () => getById(shopId, order!.id, tx))
    await orderEvent.run(tx, { shopId, event: 'order.created', load: () => getById(shopId, order!.id, tx) })
    return { ...order!, items, shippingLines }
  })
}

// Locks the order row for a state change. Throws NOT_FOUND when it isn't in this shop.
async function lockOrder(tx: Conn, shopId: string, id: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.id, id)))
    .for('update')
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found')
  return order
}

const touch = (tx: Conn, id: string, patch: Partial<typeof orders.$inferInsert>) =>
  tx
    .update(orders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(orders.id, id))
    .returning()
    .then((rows) => rows[0]!)

// Sets the order's custom field values (null clears one); throws ORDER_NOT_FOUND
export async function setCustomFields(shopId: string, id: string, updates: CustomFieldUpdates) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, shopId, id)
    const customFields = await customFieldService.merge(shopId, 'order', updates, order.customFields, tx)
    await touch(tx, id, { customFields })
    await emit(tx, shopId, 'order.updated', () => getById(shopId, id, tx))
    return (await getById(shopId, id, tx))!
  })
}

// Manual payment received (Shopify "Mark as paid"): records a successful sale for the outstanding amount
export async function markAsPaid(shopId: string, id: string) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, shopId, id)
    if (order.cancelledAt) throw new OrderError('ORDER_CANCELLED', 'Order is cancelled')
    if (order.financialStatus !== 'pending' && order.financialStatus !== 'partially_paid') {
      throw new OrderError('INVALID_STATUS_TRANSITION', `Order is already ${order.financialStatus.replace('_', ' ')}`)
    }
    const [paid] = await tx
      .select({ cents: sql<number>`coalesce(sum(${orderTransactions.amountCents}), 0)::int` })
      .from(orderTransactions)
      .where(
        and(
          eq(orderTransactions.orderId, id),
          eq(orderTransactions.kind, 'sale'),
          eq(orderTransactions.status, 'success'),
        ),
      )
    await tx.insert(orderTransactions).values({
      orderId: id,
      kind: 'sale',
      status: 'success',
      gateway: order.paymentGateway ?? 'manual',
      amountCents: order.totalCents - (paid?.cents ?? 0),
      currency: order.currency,
    })
    const updated = await touch(tx, id, { financialStatus: 'paid' })
    await emit(tx, shopId, 'order.paid', () => getById(shopId, id, tx))
    await orderEvent.run(tx, { shopId, event: 'order.paid', load: () => getById(shopId, id, tx) })
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
    await tx.insert(fulfillmentsTable).values({
      orderId: id,
      trackingCompany: tracking.trackingCompany || null,
      trackingNumber: tracking.trackingNumber || null,
      trackingUrl: tracking.trackingUrl || null,
    })
    const updated = await touch(tx, id, { fulfillmentStatus: 'fulfilled' })
    await emit(tx, shopId, 'order.fulfilled', () => getById(shopId, id, tx))
    await orderEvent.run(tx, { shopId, event: 'order.fulfilled', load: () => getById(shopId, id, tx) })
    return updated
  })
}

export type CancelInput = {
  reason: CancelReason
  restock: boolean
  /** Automatic cancellations: give up (INVALID_STATUS_TRANSITION) when the order was paid since it was picked, instead of refunding it */
  onlyIfUnpaid?: boolean
}

// Shopify-style cancel: unpaid → voided; paid → refunded (manual methods: money goes back outside ShopNex,
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
    if (input.onlyIfUnpaid && order.financialStatus !== 'pending') {
      throw new OrderError('INVALID_STATUS_TRANSITION', 'The order is no longer unpaid')
    }
    if (input.restock) {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id))
      for (const item of items) {
        if (item.variantId) await variantService.restock(shopId, item.variantId, item.quantity, tx)
      }
    }
    let financialStatus = order.financialStatus
    if (
      order.financialStatus === 'paid' ||
      order.financialStatus === 'partially_paid' ||
      order.financialStatus === 'partially_refunded'
    ) {
      // Gives back what is still with the shop: earlier partial refunds, sent or on their way, are not repeated
      const money = await moneyOf(tx, id)
      const manual = (order.paymentGateway ?? 'manual') === 'manual'
      if (money.left > 0) {
        await tx.insert(orderTransactions).values({
          orderId: id,
          kind: 'refund',
          status: manual ? 'success' : 'pending',
          gateway: order.paymentGateway ?? 'manual',
          amountCents: money.left,
          currency: order.currency,
        })
      }
      if (manual) financialStatus = 'refunded'
    } else if (order.financialStatus === 'pending' || order.financialStatus === 'authorized') {
      financialStatus = 'voided'
    }
    const updated = await touch(tx, id, { cancelledAt: new Date(), cancelReason: input.reason, financialStatus })
    await emit(tx, shopId, 'order.cancelled', () => getById(shopId, id, tx))
    await orderEvent.run(tx, { shopId, event: 'order.cancelled', load: () => getById(shopId, id, tx) })
    return updated
  })
}

/**
 * What the shop took for an order and has given back. `left` is what can still be refunded: taken, minus refunds that
 * went through, minus refunds on their way (a pending one is already spoken for).
 */
export async function moneyOf(tx: Conn, orderId: string) {
  const rows = await tx
    .select({
      kind: orderTransactions.kind,
      status: orderTransactions.status,
      cents: sql<number>`coalesce(sum(${orderTransactions.amountCents}), 0)::int`,
    })
    .from(orderTransactions)
    .where(eq(orderTransactions.orderId, orderId))
    .groupBy(orderTransactions.kind, orderTransactions.status)
  const sum = (kind: string[], status: string) =>
    rows.filter((r) => kind.includes(r.kind) && r.status === status).reduce((n, r) => n + r.cents, 0)
  const taken = sum(['sale', 'capture'], 'success')
  const refunded = sum(['refund'], 'success')
  const refunding = sum(['refund'], 'pending')
  return { taken, refunded, refunding, left: Math.max(0, taken - refunded - refunding) }
}

/**
 * Gives back part of what an order took, and leaves the order as it is (stock and fulfilment are not touched).
 * Manual payment methods: recorded as refunded at once, staff send the money back themselves. Paid through a payments
 * app: a pending refund is booked and the order changes only when the app confirms (@shopnex/payments sends it).
 */
export async function refund(shopId: string, id: string, input: { amountCents: number }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new OrderError('INVALID_REFUND', 'Refund an amount above zero, in whole cents')
  }
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, shopId, id)
    const money = await moneyOf(tx, id)
    if (money.left <= 0) throw new OrderError('INVALID_REFUND', 'Nothing is left to refund on this order')
    if (input.amountCents > money.left) {
      throw new OrderError(
        'INVALID_REFUND',
        `At most ${formatMoney({ amountMinor: money.left, currencyCode: order.currency })} can be refunded`,
      )
    }
    const manual = (order.paymentGateway ?? 'manual') === 'manual'
    await tx.insert(orderTransactions).values({
      orderId: id,
      kind: 'refund',
      status: manual ? 'success' : 'pending',
      gateway: order.paymentGateway ?? 'manual',
      amountCents: input.amountCents,
      currency: order.currency,
    })
    if (!manual) return order
    return touch(tx, id, {
      financialStatus: money.refunded + input.amountCents >= money.taken ? 'refunded' : 'partially_refunded',
    })
  })
}
