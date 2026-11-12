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
      const session = await (
        await deps.stripeFor(shop)
      ).checkout.sessions.create(
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
