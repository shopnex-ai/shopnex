// Turns a cart into an order: contact, shipping address, a shipping rate and a payment method.
// Manual payment methods leave the order `pending` (financially) until staff mark it as paid; a payments app
// method (Stripe…) also starts a payment session, and the buyer is sent to its paymentUrl to pay.
import { variantService } from '@shopnex/catalog'
import { eq, inArray } from 'drizzle-orm'
import { all, type Conn } from '@shopnex/db'
import { orderService } from '@shopnex/orders'
import { PaymentError, paymentMethodService, paymentService } from '@shopnex/payments'
import { calculate, taxRateFor, taxService } from '@shopnex/pricing'
import * as cartService from './cart'
import type { CartView } from './cart'
import * as carrierService from './carrier-services'
import type { QuoteInput } from './carrier-services'
import { listShippingRates } from './checkout-settings'
import { CartError } from './cart.errors'
import { shops } from '@shopnex/core/schema'
import { products } from '@shopnex/catalog/schema'
import { checkoutCredit, type CheckoutCredit } from './cart.hooks'
import { type MailingAddress, orders } from '@shopnex/orders/schema'

export type CheckoutInput = {
  email: string
  name?: string
  phone?: string
  shippingAddress?: MailingAddress
  /** Defaults to the shop's first active rate */
  shippingRateId?: string
  /** Defaults to the shop's first active method */
  paymentMethodId?: string
  note?: string
  /** A gift card code: pays what it can of the order (see checkoutCredit) */
  giftCardCode?: string
}

type AddressFields = {
  firstName?: string
  lastName: string
  company?: string
  address1: string
  address2?: string
  city: string
  province?: string
  countryCode: string
  zip?: string
  phone?: string
}

// Form/API input → stored MailingAddress (blank optional fields become null)
export function toMailingAddress(a: AddressFields): MailingAddress {
  const opt = (v?: string) => (v?.trim() ? v.trim() : null)
  return {
    firstName: opt(a.firstName),
    lastName: opt(a.lastName),
    company: opt(a.company),
    address1: a.address1.trim(),
    address2: opt(a.address2),
    city: a.city.trim(),
    province: opt(a.province),
    countryCode: a.countryCode.toUpperCase(),
    zip: opt(a.zip),
    phone: opt(a.phone),
  }
}

/** Where the cart ships to, as far as the buyer has said. Carrier services need at least the country. */
export type QuoteAddress = {
  countryCode: string
  province?: string | null
  city?: string | null
  zip?: string | null
  address1?: string | null
  address2?: string | null
}

// What a carrier service is told about the cart and where it goes
function quoteInput(cart: CartView, address: QuoteAddress): QuoteInput {
  return {
    currency: cart.currency,
    subtotalCents: cart.subtotalCents,
    destination: {
      countryCode: address.countryCode.toUpperCase(),
      province: address.province ?? null,
      city: address.city ?? null,
      zip: address.zip ?? null,
      address1: address.address1 ?? null,
      address2: address.address2 ?? null,
    },
    items: cart.lines.map((l) => ({
      sku: l.sku,
      fulfilledBy: l.fulfilledBy,
      title: l.isDefaultVariant ? l.title : `${l.title} - ${l.variantTitle}`,
      quantity: l.quantity,
      priceCents: l.unitPriceCents,
    })),
  }
}

// What the buyer can choose for this subtotal: shipping rates (with free-shipping thresholds applied)
// and payment methods. Hosted checkout and the Storefront API both use this. With the cart and a destination
// it also asks the shop's carrier services (apps) for live rates, which replace the shop's flat rates when they
// price the cart.
export async function options(
  shopId: string,
  subtotalCents: number,
  conn: Conn,
  quote?: { cart: CartView; address?: QuoteAddress },
) {
  const [rates, methods, carrierServices, carrierRates] = await all(conn, [
    () => listShippingRates(shopId, { activeOnly: true }, conn),
    () => paymentMethodService.list(shopId, { activeOnly: true }, conn),
    () => carrierService.list(shopId, { usableOnly: true }, conn),
    async () =>
      quote?.address?.countryCode
        ? carrierService.quote(shopId, quoteInput(quote.cart, quote.address), conn)
        : Promise.resolve([]),
  ])
  return {
    // Carrier services quote once the buyer's address is known: the checkout asks again as they type it
    liveRates: carrierServices.length > 0,
    // When a carrier app prices the cart, only its rates are on offer. Otherwise (no carrier, no address yet, or the
    // carrier can't price this cart or destination) the shop's own flat rates are.
    shippingRates:
      carrierRates.length > 0
        ? carrierRates.map((r) => ({
            id: r.id,
            title: r.title,
            priceCents: r.priceCents,
            freeAboveCents: null,
            description: r.description,
            carrier: r.carrier,
          }))
        : rates.map((r) => ({
            id: r.id,
            title: r.name,
            priceCents: orderService.shippingPrice(r, subtotalCents),
            freeAboveCents: r.freeAboveCents,
            description: null as string | null,
            carrier: null as string | null,
          })),
    paymentMethods: methods.map((m) => ({
      id: m.id,
      name: m.name,
      additionalDetails: m.additionalDetails,
      offsite: m.provider === 'app',
    })),
  }
}

// What tax depends on besides the cart: the shop's rates (public — they're shown at checkout) and settings.
// The hosted checkout passes this to the browser to update totals as the buyer types the address.
export async function taxContext(shopId: string, conn: Conn) {
  const [[shop], rates] = await all(conn, [
    () =>
      conn
        .select({ taxesIncluded: shops.taxesIncluded, taxShipping: shops.taxShipping })
        .from(shops)
        .where(eq(shops.id, shopId)),
    () => taxService.list(shopId, conn),
  ])
  return {
    taxesIncluded: shop?.taxesIncluded ?? false,
    taxShipping: shop?.taxShipping ?? false,
    taxRates: rates.map((r) => ({
      countryCode: r.countryCode,
      province: r.province,
      name: r.name,
      ratePercent: r.ratePercent,
    })),
  }
}

// Totals the buyer would pay for this cart with a shipping rate (default: the first) and address.
// Without an address tax is unknown: taxCents is null and the total excludes it.
export async function estimate(
  shopId: string,
  cart: CartView,
  conn: Conn,
  input: { shippingRateId?: string; address?: QuoteAddress; giftCardCode?: string; visitorIp?: string | null } = {},
) {
  const [{ shippingRates }, tax] = await all(conn, [
    () => options(shopId, cart.subtotalCents, conn, { cart, address: input.address }),
    () => taxContext(shopId, conn),
  ])
  const rate = input.shippingRateId ? shippingRates.find((r) => r.id === input.shippingRateId) : shippingRates[0]
  if (input.shippingRateId && !rate) throw new CartError('INVALID_SHIPPING_RATE', 'Choose an available shipping method')
  const totals = calculate({
    lines: cart.lines.map((l) => l.lineTotalCents),
    shippingCents: rate?.priceCents ?? 0,
    discount: cart.discount,
    taxRate: taxRateFor(tax.taxRates, input.address),
    taxesIncluded: tax.taxesIncluded,
    taxShipping: tax.taxShipping,
  })
  // What a gift card would pay. Without an address tax is unknown, so this is the total without it.
  const giftCardLinesCents = cart.lines.reduce(
    (sum, l, i) => sum + (l.isGiftCard ? l.lineTotalCents - totals.lineDiscountCents[i]! : 0),
    0,
  )
  const credit = input.giftCardCode?.trim()
    ? await runCredit(conn, {
        shopId,
        code: input.giftCardCode,
        currency: cart.currency,
        ip: input.visitorIp ?? null,
        eligibleCents: Math.max(0, totals.totalCents - giftCardLinesCents),
        orderId: null,
      })
    : { credits: [], error: null }
  const creditCents = credit.credits.reduce((sum, c) => sum + c.amountCents, 0)
  return {
    ...totals,
    taxCents: input.address ? totals.taxCents : null,
    credits: credit.credits,
    creditError: credit.error,
    /** What is left for a payment method to take */
    dueCents: totals.totalCents - creditCents,
  }
}

// What the order's gift card products cost (after their share of discounts): a gift card can't pay for another gift card
async function giftCardLines(
  tx: Conn,
  items: { productId: string | null; unitPriceCents: number; quantity: number; discountCents: number }[],
) {
  const productIds = items.flatMap((i) => (i.productId ? [i.productId] : []))
  if (productIds.length === 0) return 0
  const gift = new Set(
    (
      await tx
        .select({ id: products.id, isGiftCard: products.isGiftCard })
        .from(products)
        .where(inArray(products.id, productIds))
    )
      .filter((p) => p.isGiftCard)
      .map((p) => p.id),
  )
  return items.reduce(
    (sum, i) => (i.productId && gift.has(i.productId) ? sum + i.unitPriceCents * i.quantity - i.discountCents : sum),
    0,
  )
}

async function runCredit(
  conn: Conn,
  payload: {
    shopId: string
    code: string
    currency: string
    ip: string | null
    eligibleCents: number
    orderId: string | null
  },
): Promise<{ credits: CheckoutCredit[]; error: string | null }> {
  const state = { ...payload, credits: [] as CheckoutCredit[], error: null as string | null }
  await checkoutCredit.run(conn, state)
  return { credits: state.credits, error: state.error }
}

export type CompleteOptions = {
  /** Where a payments app sends the buyer back after paying: the order's confirmation page */
  returnUrl: string
  /** The visitor's address, for limits on guessing gift card codes */
  visitorIp?: string | null
}

/**
 * Places the order, then (payments app methods) starts its payment. `paymentUrl` is where the buyer pays;
 * null for manual methods, or when the app couldn't be reached (`paymentError`): the order is placed and
 * unpaid, and completing again retries. Completing an unpaid, already completed cart picks the payment up again.
 */
export async function complete(shopId: string, token: string, input: CheckoutInput, opts: CompleteOptions, conn: Conn) {
  // A gift card code is checked before the order is placed, outside its transaction: wrong guesses are counted against the
  // visitor there (the counters use the shared connection), and a code that can't be used says so before anything is created
  if (input.giftCardCode?.trim()) {
    const found = await cartService.findByToken(shopId, token, conn)
    if (found && found.status !== 'completed') {
      const check = await runCredit(conn, {
        shopId,
        code: input.giftCardCode,
        currency: (await cartService.view(found, conn)).currency,
        ip: opts.visitorIp ?? null,
        eligibleCents: Number.MAX_SAFE_INTEGER,
        orderId: null,
      })
      if (check.error) throw new CartError('GIFT_CARD_NOT_APPLICABLE', check.error)
    }
  }
  const placed = await placeOrder(shopId, token, input, conn)
  const [order] = await conn
    .select({
      paymentGateway: orders.paymentGateway,
      financialStatus: orders.financialStatus,
      cancelledAt: orders.cancelledAt,
    })
    .from(orders)
    .where(eq(orders.id, placed.orderId))
  // Partly paid (a gift card took some): the rest is paid with the method. Fully paid: nothing to start.
  const payable =
    order &&
    (order.paymentGateway ?? 'manual') !== 'manual' &&
    (order.financialStatus === 'pending' || order.financialStatus === 'partially_paid') &&
    !order.cancelledAt
  if (!payable) return { ...placed, paymentUrl: null, paymentError: null }
  try {
    const session = await paymentService.startPayment(
      shopId,
      placed.orderId,
      {
        returnUrl: opts.returnUrl,
        paymentMethodId: placed.paymentMethodId ?? undefined,
      },
      conn,
    )
    return { ...placed, paymentUrl: session.redirectUrl, paymentError: null }
  } catch (error) {
    if (error instanceof PaymentError) return { ...placed, paymentUrl: null, paymentError: error.message }
    throw error
  }
}

// One transaction: lock cart → create order (prices snapshotted, stock reserved) → mark cart completed.
// Idempotent: completing an already-completed cart returns the same order instead of creating another.
// A shop without shipping rates charges no shipping; a shop with payment methods requires one.
async function placeOrder(shopId: string, token: string, input: CheckoutInput, conn: Conn) {
  // The rule of `options` applies here too: when a carrier app prices the cart only its rates are on offer, and the
  // price is its answer now (asked again here, outside the transaction since it calls another server), whatever the
  // browser showed
  let carrierRate: Awaited<ReturnType<typeof carrierService.quote>>[number] | null = null
  const found = await cartService.findByToken(shopId, token, conn)
  if (found && found.status !== 'completed') {
    const chose = input.shippingRateId
    if (input.shippingAddress?.countryCode) {
      const quoted = await carrierService.quote(
        shopId,
        quoteInput(await cartService.view(found, conn), input.shippingAddress),
        conn,
      )
      if (quoted.length > 0) {
        carrierRate = (chose ? quoted.find((r) => r.id === chose) : quoted[0]) ?? null
        if (!carrierRate) throw new CartError('INVALID_SHIPPING_RATE', 'Choose an available shipping method')
      }
    }
    if (!carrierRate && chose && carrierService.isCarrierRateId(chose)) {
      throw new CartError(
        'INVALID_SHIPPING_RATE',
        input.shippingAddress
          ? 'Choose an available shipping method'
          : 'Enter your address to choose a shipping method',
      )
    }
  }
  return conn.transaction(async (tx) => {
    const cart = await cartService.lockForCheckout(tx, shopId, token)
    if (!cart) throw new CartError('CART_NOT_FOUND', 'Cart not found or expired')
    if (cart.status === 'completed' && cart.orderId) {
      const [order] = await tx
        .select({ orderNumber: orders.orderNumber })
        .from(orders)
        .where(eq(orders.id, cart.orderId))
      return {
        orderId: cart.orderId,
        orderNumber: order!.orderNumber,
        alreadyCompleted: true,
        // Retrying: the method of the last attempt
        paymentMethodId: null as string | null,
      }
    }

    const items = await cartService.lineInputs(tx, cart.id)
    if (items.length === 0) throw new CartError('EMPTY_CART', 'Cart is empty')

    // A product may have been unpublished (from this channel) or archived since it was added
    const sellable = new Set(
      (
        await variantService.getManyByIds(
          shopId,
          items.map((i) => i.variantId),
          tx,
          { channelId: cart.channelId },
        )
      )
        .filter((r) => r.productStatus === 'active')
        .map((r) => r.variant.id),
    )
    const unsellable = items.map((i) => i.variantId).filter((id) => !sellable.has(id))
    if (unsellable.length) {
      throw new CartError('VARIANT_NOT_FOUND', 'Some items are no longer available', { variantIds: unsellable })
    }

    const [rates, methods] = await all(tx, [
      () => listShippingRates(shopId, { activeOnly: true }, tx),
      () => paymentMethodService.list(shopId, { activeOnly: true }, tx),
    ])
    const rate = carrierRate
      ? { name: carrierRate.title, id: carrierRate.id, priceCents: carrierRate.priceCents, freeAboveCents: null }
      : input.shippingRateId
        ? rates.find((r) => r.id === input.shippingRateId)
        : rates[0]
    if (input.shippingRateId && !rate)
      throw new CartError('INVALID_SHIPPING_RATE', 'Choose an available shipping method')
    // Shipping that comes from carrier apps is charged for: with no method chosen, or none offered for this address,
    // the order would ship for free
    if (!rate && (await carrierService.list(shopId, { usableOnly: true }, tx)).length > 0) {
      throw new CartError('INVALID_SHIPPING_RATE', "We can't ship to this address: no shipping method is available")
    }
    const method = input.paymentMethodId ? methods.find((m) => m.id === input.paymentMethodId) : methods[0]
    if (input.paymentMethodId && !method)
      throw new CartError('INVALID_PAYMENT_METHOD', 'Choose an available payment method')

    const order = await orderService.create(
      shopId,
      {
        email: input.email,
        name: input.name,
        phone: input.phone,
        shippingAddress: input.shippingAddress,
        note: input.note,
        items,
        shipping: rate && {
          title: rate.name,
          code: rate.id,
          priceCents: rate.priceCents,
          freeAboveCents: rate.freeAboveCents,
        },
        payment: method && {
          gateway: method.provider === 'app' ? (method.gateway ?? 'app') : 'manual',
          name: method.name,
          instructions: method.instructions,
        },
        discountCode: cart.discountCode ?? undefined,
        channelId: cart.channelId,
      },
      tx,
    )
    // A gift card pays first; what is left goes to the payment method. A code that can't be used refuses the order.
    if (input.giftCardCode?.trim()) {
      const giftCardLinesCents = await giftCardLines(tx, order.items)
      const spend = await runCredit(tx, {
        shopId,
        code: input.giftCardCode,
        currency: order.currency,
        ip: null,
        eligibleCents: Math.max(0, order.totalCents - giftCardLinesCents),
        orderId: order.id,
      })
      if (spend.error) throw new CartError('GIFT_CARD_NOT_APPLICABLE', spend.error)
    }
    await cartService.markCompleted(tx, cart.id, order)
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      alreadyCompleted: false,
      paymentMethodId: method?.id ?? null,
    }
  })
}
