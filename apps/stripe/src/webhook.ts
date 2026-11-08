// Stripe → app: turns signed Checkout events into resolve / reject calls on ShopNex payment sessions.
// Kept apart from server.tsx (which starts the server on import) so it can be tested with signed fake events.
import { Hono } from 'hono'
import Stripe from 'stripe'
import { ShopnexError, type ShopContext } from '@shopnex/app'

export type WebhookDeps = {
  forShop(instance: string, shopId: string): Promise<ShopContext>
  secrets(shop: ShopContext): Promise<{ secretKey: string | null; webhookSecret: string | null }>
}

/** The events the app needs Stripe to send */
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
] as const

/**
 * Endpoints this app created earlier don't list events added since (e.g. payment_intent.payment_failed): adds
 * the missing ones, keeping whatever else the merchant enabled. Returns true when it changed the endpoint.
 */
export async function ensureWebhookEvents(stripe: Stripe, endpointId: string) {
  const endpoint = await stripe.webhookEndpoints.retrieve(endpointId)
  const enabled = endpoint.enabled_events as string[]
  // '*' already receives everything
  if (enabled.includes('*') || WEBHOOK_EVENTS.every((e) => enabled.includes(e))) return false
  await stripe.webhookEndpoints.update(endpointId, {
    enabled_events: [...new Set([...enabled, ...WEBHOOK_EVENTS])] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
  })
  return true
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The amount and currency ShopNex asked Stripe to collect travel in the Checkout Session's metadata. What Stripe
 * reports must match them before an order is marked paid. Today a Checkout with one fixed line item charges exactly
 * that; this keeps it true if promotion codes, an adjustable quantity or another flow are added later, and stops a
 * shortfall from being booked as a full sale. Sessions created before this check carry no amount and pass as before.
 * Returns what differs, or null.
 */
export function amountMismatch(session: Stripe.Checkout.Session): string | null {
  const wantCents = session.metadata?.shopnex_amount_cents
  const wantCurrency = session.metadata?.shopnex_currency
  if (wantCents === undefined || wantCurrency === undefined) return null
  const gotCents = session.amount_total
  const gotCurrency = session.currency?.toLowerCase()
  if (String(gotCents) === wantCents && gotCurrency === wantCurrency) return null
  return `expected ${wantCents} ${wantCurrency}, Stripe reports ${gotCents ?? 'no amount'} ${gotCurrency ?? 'no currency'}`
}

// The URL names the shop (?instance=…&shop=…); its own webhook secret proves the event is Stripe's
export function webhookRoutes({ forShop, secrets }: WebhookDeps) {
  const app = new Hono()
  app.post('/stripe/webhook', async (c) => {
    const { instance, shop: shopId } = c.req.query()
    const signature = c.req.header('stripe-signature')
    if (!instance || !shopId || !signature) return c.text('Unknown shop', 400)
    let shop: ShopContext
    try {
      shop = await forShop(instance, shopId)
    } catch (error) {
      console.warn(`[stripe] webhook for ${instance} ${shopId}:`, message(error))
      return c.text('Unknown shop', 400)
    }
    const { secretKey, webhookSecret } = await secrets(shop)
    if (!secretKey || !webhookSecret) return c.text('Unknown shop', 400)
    const body = await c.req.text()
    let event: Stripe.Event
    try {
      event = await new Stripe(secretKey).webhooks.constructEventAsync(body, signature, webhookSecret)
    } catch {
      return c.text('Invalid signature', 400)
    }
    if (!event.type.startsWith('checkout.session.') && event.type !== 'payment_intent.payment_failed') {
      return c.body(null, 204)
    }
    // Checkout Sessions and the PaymentIntents behind them both carry our metadata
    const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent
    const id = object.metadata?.shopnex_session_id
    // Not one of ours (the same Stripe account may serve other systems or shops)
    if (!id || object.metadata?.shopnex_instance !== shop.instance || object.metadata?.shopnex_shop_id !== shopId) {
      return c.body(null, 204)
    }
    const session = object as Stripe.Checkout.Session
    const paymentIntent =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id

    // An event that says the money arrived must also carry the amount ShopNex asked for. If it doesn't, don't mark
    // the order paid: fail loudly (like an unknown session, below) so Stripe retries and flags the endpoint
    const claimsPaid =
      event.type === 'checkout.session.async_payment_succeeded' ||
      (event.type === 'checkout.session.completed' && session.payment_status === 'paid')
    const mismatch = claimsPaid ? amountMismatch(session) : null
    if (mismatch) {
      console.error(
        `[stripe] AMOUNT MISMATCH on session ${id} (payment ${paymentIntent ?? 'unknown'}, ${event.type}): ${mismatch}. Order NOT marked paid: check it in Stripe, refund or fix by hand`,
      )
      return c.text('Paid amount does not match the order', 500)
    }

    // Events that say the money arrived: a session ShopNex can't find for one of these is a payment nobody sees
    let paidEvent = false
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          // Delayed methods (bank debits…) complete unpaid and settle later
          if (session.payment_status === 'paid') {
            paidEvent = true
            await shop.payments.resolve(id, paymentIntent)
          }
          break
        case 'checkout.session.async_payment_succeeded':
          paidEvent = true
          await shop.payments.resolve(id, paymentIntent)
          break
        case 'checkout.session.async_payment_failed':
          await shop.payments.reject(id, 'The payment failed')
          break
        case 'payment_intent.payment_failed':
          // Declined / 3DS failed: Stripe keeps Checkout open for another try, so only note why
          await shop.payments.attemptFailed(
            id,
            (object as Stripe.PaymentIntent).last_payment_error?.message ?? 'The payment attempt failed',
          )
          break
        case 'checkout.session.expired':
          await shop.payments.reject(id, 'Checkout expired without payment')
          break
      }
    } catch (error) {
      // A payment for a session ShopNex doesn't have: the buyer was charged and no order will show it. Fail loudly
      // (Stripe retries for days and flags the endpoint in the merchant's Dashboard) instead of dropping it.
      if (paidEvent && error instanceof ShopnexError && error.status === 404) {
        console.error(
          `[stripe] PAID but no ShopNex session ${id} (payment ${paymentIntent ?? 'unknown'}, ${event.type}): refund or fix by hand`,
        )
        return c.text('Payment received for an unknown ShopNex session', 500)
      }
      // Already settled the other way (409) or a decline/expiry for a session that is gone (404): nothing to retry
      if (error instanceof ShopnexError && (error.status === 409 || error.status === 404)) {
        console.warn(`[stripe] ${event.type} for session ${id}:`, error.message)
        return c.body(null, 204)
      }
      console.error(`[stripe] ${event.type} for session ${id}:`, message(error))
      return c.text('ShopNex unavailable', 503)
    }
    return c.body(null, 204)
  })
  return app
}
