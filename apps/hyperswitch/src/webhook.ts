// Processor → app: Prism verifies the signed event and normalises it; this turns it into resolve / reject calls on
// Shopnex payment sessions. Kept apart from server.tsx (which starts the server on import) so it can be tested.
import { Hono } from 'hono'
import { EventClient, types } from 'hyperswitch-prism'
import { ShopnexError, type ShopContext } from '@shopnex/app'
import { connectorConfig, errorText, outcomeOf, type Credentials } from './prism'

export type WebhookDeps = {
  forShop(instance: string, shopId: string): Promise<ShopContext>
  secrets(shop: ShopContext): Promise<{ credentials: Credentials | null; webhookSecret: string | null }>
  /** The Shopnex session of a payment: by the processor's transaction id, else by the id we sent as merchant id */
  sessionFor(
    shop: ShopContext,
    connectorTransactionId?: string | null,
    merchantTransactionId?: string | null,
  ): string | null
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function webhookRoutes({ forShop, secrets, sessionFor }: WebhookDeps) {
  const app = new Hono()
  app.post('/hyperswitch/webhook', async (c) => {
    const { instance, shop: shopId } = c.req.query()
    if (!instance || !shopId) return c.text('Unknown shop', 400)
    let shop: ShopContext
    try {
      shop = await forShop(instance, shopId)
    } catch (error) {
      console.warn(`[hyperswitch] webhook for ${instance} ${shopId}:`, message(error))
      return c.text('Unknown shop', 400)
    }
    const { credentials, webhookSecret } = await secrets(shop)
    if (!credentials || !webhookSecret) return c.text('Unknown shop', 400)

    const body = new Uint8Array(await c.req.arrayBuffer())
    let event: types.EventServiceHandleResponse
    try {
      event = await new EventClient(connectorConfig(credentials)).handleEvent({
        requestDetails: {
          method: types.HttpMethod.HTTP_METHOD_POST,
          uri: c.req.url,
          headers: Object.fromEntries(c.req.raw.headers),
          body,
        },
        webhookSecrets: { secret: webhookSecret },
      })
    } catch (error) {
      console.warn(`[hyperswitch] webhook for ${instance} ${shopId}:`, message(error))
      return c.text('Invalid event', 400)
    }
    if (!event.sourceVerified) return c.text('Invalid signature', 400)

    const payment = event.eventContent?.paymentsResponse
    if (!payment) return c.body(null, 204)
    const id = sessionFor(shop, payment.connectorTransactionId, payment.merchantTransactionId)
    // Not one of ours (the same processor account may serve other systems or shops)
    if (!id) return c.body(null, 204)

    const outcome = outcomeOf(payment.status)
    try {
      if (outcome === 'paid') await shop.payments.resolve(id, payment.connectorTransactionId ?? undefined)
      else if (outcome === 'failed') await shop.payments.reject(id, errorText(payment.error, 'The payment failed'))
    } catch (error) {
      // The buyer was charged and no order will show it: fail loudly so the processor retries and flags the endpoint
      if (outcome === 'paid' && error instanceof ShopnexError && error.status === 404) {
        console.error(
          `[hyperswitch] PAID but no Shopnex session ${id} (${payment.connectorTransactionId}): refund or fix by hand`,
        )
        return c.text('Payment received for an unknown Shopnex session', 500)
      }
      // Already settled the other way (409), or a failure for a session that is gone (404): nothing to retry
      if (error instanceof ShopnexError && (error.status === 409 || error.status === 404)) {
        console.warn(`[hyperswitch] event for session ${id}:`, error.message)
        return c.body(null, 204)
      }
      console.error(`[hyperswitch] event for session ${id}:`, message(error))
      return c.text('Shopnex unavailable', 503)
    }
    return c.body(null, 204)
  })
  return app
}
