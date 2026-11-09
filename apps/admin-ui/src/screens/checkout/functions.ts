import { publicFn } from '@/lib/server-fn'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { CartError, cartService, checkoutService } from '@shopnex/cart'
import { abandonedCartService } from '@shopnex/email'
import { OrderError, orderService } from '@shopnex/orders'
import { PaymentError, paymentService } from '@shopnex/payments'
import { discountService } from '@shopnex/pricing'
import { getShopById } from '@shopnex/tenancy'
import { countryOptions } from '@/lib/countries'
import { checkoutBranding } from './branding'
import { buyer, checkoutFieldNames } from './buyer-schema'

const tokenValidator = (token: string) => token

export const getCheckout = publicFn({ method: 'GET' })
  .validator(tokenValidator)
  .handler(async ({ data: token }) => {
    const found = await cartService.findByToken(null, token)
    if (!found) return null
    const shop = await getShopById(found.shopId)
    if (!shop) return null
    const branding = await checkoutBranding(found.shopId, shop.storefrontUrl)
    if (found.status === 'completed' && found.orderId) {
      const [order, payment] = await Promise.all([
        orderService.getById(found.shopId, found.orderId),
        paymentService.latestPayment(found.shopId, found.orderId),
      ])
      return order
        ? {
            kind: 'confirmation' as const,
            token,
            shopName: shop.name,
            storefrontUrl: shop.storefrontUrl,
            branding,
            order,
            // Payments app orders: the latest attempt (null for manual methods)
            payment: payment && { status: payment.status, error: payment.errorMessage },
          }
        : null
    }
    const cart = await cartService.view(found)
    const [options, tax, offerReminder] = await Promise.all([
      checkoutService.options(found.shopId, cart.subtotalCents),
      checkoutService.taxContext(found.shopId),
      abandonedCartService.offered(found.shopId),
    ])
    const lang = getRequest().headers.get('accept-language') ?? ''
    const defaultCountry = /^[a-z]{2,3}-([A-Z]{2})\b/.exec(lang)?.[1] ?? 'US'
    return {
      kind: 'checkout' as const,
      shopName: shop.name,
      storefrontUrl: shop.storefrontUrl,
      branding,
      cart,
      options,
      tax,
      defaultCountry,
      offerReminder,
      // Built here, once: Intl names and their order differ between this server and the browser, and a
      // list the browser computes itself fails hydration, which throws away what the buyer already typed
      countries: countryOptions,
    }
  })

export type RatesAddress = {
  countryCode: string
  province?: string
  city?: string
  zip?: string
  address1?: string
}

/** The shipping methods for the address typed so far: the shop's flat rates plus its carrier services' live rates */
export const quoteRates = publicFn({ method: 'POST' })
  .validator((input: { token: string; address: RatesAddress }) => input)
  .handler(async ({ data }) => {
    const found = await cartService.findByToken(null, data.token)
    if (!found || found.status === 'completed') return null
    if (!/^[A-Z]{2}$/.test(data.address.countryCode)) return null
    const cart = await cartService.view(found)
    const { shippingRates } = await checkoutService.options(found.shopId, cart.subtotalCents, {
      cart,
      address: data.address,
    })
    return shippingRates
  })

/**
 * Keeps the buyer's email on the cart while they fill in the form, if they asked to be reminded (and un-keeps it
 * if they change their mind). Does nothing unless the shop sends abandoned cart emails.
 */
export const saveReminderContact = publicFn({ method: 'POST' })
  .validator((input: { token: string; email: string; consent: boolean }) => input)
  .handler(async ({ data }) => {
    const email = z.string().trim().email().max(254).safeParse(data.email)
    if (!email.success) return
    const cart = await cartService.findByToken(null, data.token)
    if (!cart || cart.status !== 'active') return
    if (!(await abandonedCartService.offered(cart.shopId))) return
    await cartService.setReminderContact(data.token, email.data, data.consent === true)
  })

// Anything that isn't meant for the buyer (a failed query, a bug) is logged and replaced by a generic message:
// the raw error can carry SQL and internal details
const unexpected = (action: string, error: unknown) => {
  console.error(`[checkout] ${action}:`, error)
  return `Could not ${action}. Please try again.`
}

export type CheckoutFields = Record<string, string>
export type PlaceOrderState = {
  error?: string
  fieldErrors?: Record<string, string>
  values?: CheckoutFields
  redirectTo?: string
}

export const placeOrder = publicFn({ method: 'POST' })
  .validator((input: { token: string; values: CheckoutFields }) => input)
  .handler(async ({ data }): Promise<PlaceOrderState> => {
    const values = Object.fromEntries(checkoutFieldNames.map((field) => [field, String(data.values[field] ?? '')]))
    const parsed = buyer.safeParse({ ...values, shippingRateId: values.shippingRateId || undefined })
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message
      return { error: 'Check the highlighted fields.', fieldErrors, values }
    }
    const cart = await cartService.findByToken(null, data.token)
    if (!cart) return { error: 'This cart has expired.', values }
    const { email, phone, shippingRateId, paymentMethodId, note, ...address } = parsed.data
    let paymentUrl: string | null
    try {
      ;({ paymentUrl } = await checkoutService.complete(
        cart.shopId,
        data.token,
        {
          email,
          name: [address.firstName, address.lastName].filter(Boolean).join(' '),
          phone,
          shippingAddress: checkoutService.toMailingAddress({ ...address, phone }),
          shippingRateId,
          paymentMethodId,
          note,
        },
        { returnUrl: confirmationUrl(data.token) },
      ))
    } catch (error) {
      if (error instanceof OrderError || error instanceof CartError) return { error: error.message, values }
      return { error: unexpected('place the order', error), values }
    }
    // Payments app: pay on the provider's page, which sends the buyer back to the confirmation
    return { redirectTo: paymentUrl ?? `/checkout/${data.token}` }
  })

// This page's public URL (APP_URL, as the Storefront API's checkoutUrl)
const confirmationUrl = (token: string) =>
  `${(process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/checkout/${token}`

/** Confirmation page "Pay now": a new attempt for an unpaid payments app order */
export const payNow = publicFn({ method: 'POST' })
  .validator(tokenValidator)
  .handler(async ({ data: token }): Promise<{ redirectTo?: string; error?: string }> => {
    const cart = await cartService.findByToken(null, token)
    if (!cart?.orderId) return { error: 'This order is no longer available.' }
    try {
      const session = await paymentService.startPayment(cart.shopId, cart.orderId, {
        returnUrl: confirmationUrl(token),
      })
      return { redirectTo: session.redirectUrl! }
    } catch (error) {
      if (error instanceof PaymentError) return { error: error.message }
      return { error: unexpected('start the payment', error) }
    }
  })

export type DiscountCodeState = { error?: string }
export const applyDiscountCode = publicFn({ method: 'POST' })
  .validator((input: { token: string; code: string }) => input)
  .handler(async ({ data }): Promise<DiscountCodeState> => {
    const code = data.code.trim()
    if (!code) return { error: 'Enter a discount code' }
    const cart = await cartService.findByToken(null, data.token)
    if (!cart) return { error: 'This cart has expired.' }
    try {
      const view = await cartService.setDiscountCode(cart.shopId, data.token, code)
      if (!view.discountCode?.applicable) {
        await cartService.setDiscountCode(cart.shopId, data.token, null)
        const discount = await discountService.findByCode(cart.shopId, code)
        return {
          error: !discount
            ? 'Enter a valid discount code'
            : (discountService.unavailableReason(discount) ?? `Your order doesn't qualify for "${discount.code}" yet`),
        }
      }
    } catch (error) {
      if (error instanceof CartError) return { error: error.message }
      return { error: unexpected('apply this code', error) }
    }
    return {}
  })

export const removeDiscountCode = publicFn({ method: 'POST' })
  .validator(tokenValidator)
  .handler(async ({ data: token }) => {
    const cart = await cartService.findByToken(null, token)
    if (!cart) return
    try {
      await cartService.setDiscountCode(cart.shopId, token, null)
    } catch (error) {
      if (!(error instanceof CartError)) throw error
    }
  })
