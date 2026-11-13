// ShopNex → app: payment and refund sessions (signed with the instance's key). Kept apart from server.tsx (which starts
// the server on import) so it can be tested with a fake Stripe and a fake ShopNex.
import { Hono, type Context } from 'hono'
import type Stripe from 'stripe'
import type { PaymentSessionRequest, RefundSessionRequest, ShopContext } from '@shopnex/app'

export type PaymentDeps = {
  /** Checks the signature of ShopNex's request and finds its shop (shopnex.verifyPaymentsRequest) */
  verify<K extends 'payment' | 'refund'>(
    c: Context,
    kind: K,
  ): Promise<{ request: K extends 'payment' ? PaymentSessionRequest : RefundSessionRequest; shop: ShopContext }>
  /** The Stripe client of the shop's saved key */
  stripeFor(shop: ShopContext): Promise<Stripe>
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Stripe Checkout sessions last 30 minutes to 24 hours
export const checkoutExpiry = (expiresAt: string) => {
  const now = Math.floor(Date.now() / 1000)
  const wanted = Math.floor(new Date(expiresAt).getTime() / 1000)
  return Math.min(Math.max(wanted, now + 30 * 60 + 60), now + 24 * 3600 - 60)
}

// ShopNex keeps one open payment attempt per order: a new session replaces the old one. Stripe doesn't know that, and
// the buyer may still have the old Checkout page open and pay it as well as the new one (charged twice). So the old
// open Checkout Sessions of the order are ended first. One that is being paid right now can't be expired, and that is
// fine: it is the buyer's payment in flight, and the order shows it if both go through.
export async function expireReplaced(stripe: Stripe, request: PaymentSessionRequest) {
  const dayAgo = Math.floor(Date.now() / 1000) - 24 * 3600
  try {
    // Stripe can't filter Checkout Sessions by metadata; open ones are few and all newer than the longest expiry
    for await (const open of stripe.checkout.sessions.list({ status: 'open', created: { gte: dayAgo }, limit: 100 })) {
      const { shopnex_order_id: orderId, shopnex_session_id: sessionId } = open.metadata ?? {}
      if (orderId !== request.orderId || sessionId === request.id) continue
      await stripe.checkout.sessions.expire(open.id).catch((error: unknown) => {
        console.error(`[stripe] expire replaced checkout ${open.id}:`, message(error))
      })
    }
  } catch (error) {
    // Starting the new payment matters more than cleaning up the old one
    console.error(`[stripe] list open checkouts of order ${request.orderId}:`, message(error))
  }
}

export function paymentRoutes(deps: PaymentDeps) {
  const routes = new Hono()

  routes.post('/payments/session', async (c) => {
    const { request, shop } = await deps.verify(c, 'payment')
    try {
      const metadata = {
        shopnex_session_id: request.id,
        shopnex_instance: shop.instance,
        shopnex_shop_id: shop.shopId,
        shopnex_order_id: request.orderId,
        // What this session must collect: the webhook checks Stripe's amount against it before marking the order paid
        shopnex_amount_cents: String(request.amount.cents),
        shopnex_currency: request.amount.currency.toLowerCase(),
      }
      const stripe = await deps.stripeFor(shop)
      await expireReplaced(stripe, request)
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          // Tags ShopNex checkouts in the Stripe Dashboard
          integration_identifier: 'shopnex_checkout_qmvkzrtd',
          client_reference_id: request.id,
          customer_email: request.customer.email,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: request.amount.currency.toLowerCase(),
                unit_amount: request.amount.cents,
                product_data: { name: `Order #${request.orderNumber}` },
              },
            },
          ],
          success_url: request.returnUrl,
          cancel_url: request.returnUrl,
          expires_at: checkoutExpiry(request.expiresAt),
          metadata,
          payment_intent_data: { metadata },
        },
        // ShopNex retrying the same session gets the same Checkout Session
        { idempotencyKey: `shopnex-payment-${request.id}` },
      )
      return c.json({ redirectUrl: session.url })
    } catch (error) {
      console.error(`[stripe] payment session ${request.id}:`, message(error))
      return c.json({ error: message(error) }, 502)
    }
  })

  // Answers right away; the refund is made and reported to ShopNex in the background
  routes.post('/payments/refund', async (c) => {
    const { request, shop } = await deps.verify(c, 'refund')
    void refund(deps, shop, request)
    return c.body(null, 202)
  })

  return routes
}

export async function refund(deps: PaymentDeps, shop: ShopContext, request: RefundSessionRequest) {
  try {
    if (!request.payment.externalId) throw new Error('No Stripe payment to refund')
    const result = await (
      await deps.stripeFor(shop)
    ).refunds.create(
      {
        payment_intent: request.payment.externalId,
        amount: request.amount.cents,
        metadata: { shopnex_session_id: request.id, shopnex_order_id: request.orderId },
      },
      { idempotencyKey: `shopnex-refund-${request.id}` },
    )
    if (result.status === 'failed' || result.status === 'canceled') {
      await shop.payments.reject(request.id, `Stripe refund ${result.status}`)
    } else {
      await shop.payments.resolve(request.id, result.id)
    }
  } catch (error) {
    console.error(`[stripe] refund ${request.id}:`, message(error))
    await shop.payments
      .reject(request.id, message(error))
      .catch((e) => console.error(`[stripe] reject refund ${request.id}:`, message(e)))
  }
}
