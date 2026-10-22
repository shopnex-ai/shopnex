import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { CartError, cartService, checkoutService } from '@shopnex/cart'
import { OrderError, orderService } from '@shopnex/orders'
import { PaymentError, paymentService } from '@shopnex/payments'
import { discountService } from '@shopnex/pricing'
import { getShopById } from '@shopnex/tenancy'

const tokenValidator = (token: string) => token

export const getCheckout = createServerFn({ method: 'GET' })
  .validator(tokenValidator)
  .handler(async ({ data: token }) => {
    const found = await cartService.findByToken(null, token)
    if (!found) return null
    const shop = await getShopById(found.shopId)
    if (!shop) return null
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
            order,
            // Payments app orders: the latest attempt (null for manual methods)
            payment: payment && { status: payment.status, error: payment.errorMessage },
          }
        : null
    }
    const cart = await cartService.view(found)
    const [options, tax] = await Promise.all([
      checkoutService.options(found.shopId, cart.subtotalCents),
      checkoutService.taxContext(found.shopId),
    ])
    const lang = getRequest().headers.get('accept-language') ?? ''
    const defaultCountry = /^[a-z]{2,3}-([A-Z]{2})\b/.exec(lang)?.[1] ?? 'US'
    return {
      kind: 'checkout' as const,
      shopName: shop.name,
      storefrontUrl: shop.storefrontUrl,
      cart,
      options,
      tax,
      defaultCountry,
    }
  })

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
const buyer = z.object({
  email: z.email('Enter a valid email'),
  firstName: optional(100),
  lastName: z.string().trim().min(1, 'Enter a last name').max(100),
  company: optional(200),
  address1: z.string().trim().min(1, 'Enter an address').max(200),
  address2: optional(200),
  city: z.string().trim().min(1, 'Enter a city').max(100),
  province: optional(100),
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'Choose a country'),
  zip: optional(20),
  phone: optional(40),
  shippingRateId: z.uuid().optional(),
  paymentMethodId: z.uuid('Choose a payment method'),
  note: optional(1000),
})
const fields = Object.keys(buyer.shape)
export type CheckoutFields = Record<string, string>
export type PlaceOrderState = {
  error?: string
  fieldErrors?: Record<string, string>
  values?: CheckoutFields
  redirectTo?: string
}

export const placeOrder = createServerFn({ method: 'POST' })
  .validator((input: { token: string; values: CheckoutFields }) => input)
  .handler(async ({ data }): Promise<PlaceOrderState> => {
    const values = Object.fromEntries(fields.map((field) => [field, String(data.values[field] ?? '')]))
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
      throw error
    }
    // Payments app: pay on the provider's page, which sends the buyer back to the confirmation
    return { redirectTo: paymentUrl ?? `/checkout/${data.token}` }
  })

// This page's public URL (APP_URL, as the Storefront API's checkoutUrl)
const confirmationUrl = (token: string) =>
  `${(process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/checkout/${token}`

/** Confirmation page "Pay now": a new attempt for an unpaid payments app order */
export const payNow = createServerFn({ method: 'POST' })
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
      throw error
    }
  })

export type DiscountCodeState = { error?: string }
export const applyDiscountCode = createServerFn({ method: 'POST' })
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
      throw error
    }
    return {}
  })

export const removeDiscountCode = createServerFn({ method: 'POST' })
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
