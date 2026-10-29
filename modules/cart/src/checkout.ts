// Turns a cart into an order: contact, shipping address, a shipping rate and a payment method.
// Manual payment methods leave the order `pending` (financially) until staff mark it as paid; a payments app
// method (Stripe…) also starts a payment session, and the buyer is sent to its paymentUrl to pay.
import { variantService } from '@shopnex/catalog'
import { eq } from 'drizzle-orm'
import { all, db, schema } from '@shopnex/db'
import type { MailingAddress } from '@shopnex/db/schema'
import { orderService } from '@shopnex/orders'
import { PaymentError, paymentService } from '@shopnex/payments'
import { calculate, taxRateFor, taxService } from '@shopnex/pricing'
import * as cartService from './cart'
import type { CartView } from './cart'
import * as carrierService from './carrier-services'
import type { QuoteInput } from './carrier-services'
import { listPaymentMethods, listShippingRates } from './checkout-settings'
import { CartError } from './errors'

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
      title: l.isDefaultVariant ? l.title : `${l.title} - ${l.variantTitle}`,
      quantity: l.quantity,
      priceCents: l.unitPriceCents,
    })),
  }
}

// What the buyer can choose for this subtotal: shipping rates (with free-shipping thresholds applied)
// and payment methods. Hosted checkout and the Storefront API both use this. With the cart and a destination
// it also asks the shop's carrier services (apps) for live rates, which follow the shop's flat rates.
export async function options(
  shopId: string,
  subtotalCents: number,
  quote?: { cart: CartView; address?: QuoteAddress },
) {
  const [rates, methods, carrierServices, carrierRates] = await Promise.all([
    listShippingRates(shopId, { activeOnly: true }),
    listPaymentMethods(shopId, { activeOnly: true }),
    carrierService.list(shopId, { usableOnly: true }),
    quote?.address?.countryCode
      ? carrierService.quote(shopId, quoteInput(quote.cart, quote.address))
      : Promise.resolve([]),
  ])
  return {
    // Carrier services quote once the buyer's address is known: the checkout asks again as they type it
    liveRates: carrierServices.length > 0,
    shippingRates: [
      ...rates.map((r) => ({
        id: r.id,
        title: r.name,
        priceCents: orderService.shippingPrice(r, subtotalCents),
        freeAboveCents: r.freeAboveCents,
        description: null as string | null,
        carrier: null as string | null,
      })),
      ...carrierRates.map((r) => ({
        id: r.id,
        title: r.title,
        priceCents: r.priceCents,
        freeAboveCents: null,
        description: r.description,
        carrier: r.carrier,
      })),
    ],
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
export async function taxContext(shopId: string) {
  const [[shop], rates] = await Promise.all([
    db
      .select({ taxesIncluded: schema.shops.taxesIncluded, taxShipping: schema.shops.taxShipping })
      .from(schema.shops)
      .where(eq(schema.shops.id, shopId)),
    taxService.list(shopId),
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
  input: { shippingRateId?: string; address?: QuoteAddress } = {},
) {
  const [{ shippingRates }, tax] = await Promise.all([
    options(shopId, cart.subtotalCents, { cart, address: input.address }),
    taxContext(shopId),
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
  return { ...totals, taxCents: input.address ? totals.taxCents : null }
}

export type CompleteOptions = {
  /** Where a payments app sends the buyer back after paying: the order's confirmation page */
  returnUrl: string
}

/**
 * Places the order, then (payments app methods) starts its payment. `paymentUrl` is where the buyer pays;
 * null for manual methods, or when the app couldn't be reached (`paymentError`): the order is placed and
 * unpaid, and completing again retries. Completing an unpaid, already completed cart picks the payment up again.
 */
export async function complete(shopId: string, token: string, input: CheckoutInput, opts: CompleteOptions) {
  const placed = await placeOrder(shopId, token, input)
  const [order] = await db
    .select({
      paymentGateway: schema.orders.paymentGateway,
      financialStatus: schema.orders.financialStatus,
      cancelledAt: schema.orders.cancelledAt,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, placed.orderId))
  const payable =
    order &&
    (order.paymentGateway ?? 'manual') !== 'manual' &&
    order.financialStatus === 'pending' &&
    !order.cancelledAt
  if (!payable) return { ...placed, paymentUrl: null, paymentError: null }
  try {
    const session = await paymentService.startPayment(shopId, placed.orderId, {
      returnUrl: opts.returnUrl,
      paymentMethodId: placed.paymentMethodId ?? undefined,
    })
    return { ...placed, paymentUrl: session.redirectUrl, paymentError: null }
  } catch (error) {
    if (error instanceof PaymentError) return { ...placed, paymentUrl: null, paymentError: error.message }
    throw error
  }
}

// One transaction: lock cart → create order (prices snapshotted, stock reserved) → mark cart completed.
// Idempotent: completing an already-completed cart returns the same order instead of creating another.
// A shop without shipping rates charges no shipping; a shop with payment methods requires one.
async function placeOrder(shopId: string, token: string, input: CheckoutInput) {
  // A carrier's rate is asked for again here, outside the transaction (it calls another server): the price is
  // the app's answer now, whatever the browser showed
  let carrierRate: Awaited<ReturnType<typeof carrierService.resolve>> | null = null
  if (input.shippingRateId && carrierService.isCarrierRateId(input.shippingRateId)) {
    const found = await cartService.findByToken(shopId, token)
    if (found && found.status !== 'completed') {
      if (!input.shippingAddress)
        throw new CartError('INVALID_SHIPPING_RATE', 'Enter your address to choose a shipping method')
      carrierRate = await carrierService.resolve(
        shopId,
        input.shippingRateId,
        quoteInput(await cartService.view(found), input.shippingAddress),
      )
    }
  }
  return db.transaction(async (tx) => {
    const cart = await cartService.lockForCheckout(tx, shopId, token)
    if (!cart) throw new CartError('CART_NOT_FOUND', 'Cart not found or expired')
    if (cart.status === 'completed' && cart.orderId) {
      const [order] = await tx
        .select({ orderNumber: schema.orders.orderNumber })
        .from(schema.orders)
        .where(eq(schema.orders.id, cart.orderId))
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
      () => listPaymentMethods(shopId, { activeOnly: true }, tx),
    ])
    const rate = carrierRate
      ? { name: carrierRate.title, id: carrierRate.id, priceCents: carrierRate.priceCents, freeAboveCents: null }
      : input.shippingRateId
        ? rates.find((r) => r.id === input.shippingRateId)
        : rates[0]
    if (input.shippingRateId && !rate)
      throw new CartError('INVALID_SHIPPING_RATE', 'Choose an available shipping method')
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
    await cartService.markCompleted(tx, cart.id, order)
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      alreadyCompleted: false,
      paymentMethodId: method?.id ?? null,
    }
  })
}
