// Stripe for Shopnex: a bundled payments app on @shopnex/app. Runs next to Shopnex (its own process) and keeps
// its data in DATA_DIR (SQLite): the merchant's Stripe keys are stored there, encrypted with this app's key.
//
//   GET  /                      Embedded settings page (session token)
//   POST /api/settings          Save the Stripe key (+ webhook secret when local), register "Credit card"
//   POST /payments/session      Shopnex: start paying a session → Stripe Checkout URL
//   POST /payments/refund       Shopnex: refund a session's payment
//   POST /stripe/webhook        Stripe: checkout completed / expired, async payments → resolve / reject
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import Stripe from 'stripe'
import { ShopnexError, createShopnexApp, type RefundSessionRequest, type ShopContext } from '@shopnex/app'
import { openLocalStore } from '@shopnex/app/store'
import { icon, SettingsPage } from './settings'

// Public origin Shopnex, the admin (iframe) and Stripe reach this app at
const APP_URL = (process.env.STRIPE_APP_URL || 'http://localhost:4600').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 4600)

// The app's identity and the shops' settings live in DATA_DIR (a volume in Docker). Shopnex reads the public key
// from /.well-known/shopnex-app.json (bundled app): see registerBundledApps in @shopnex/apps
const store = await openLocalStore()
const shopnex = createShopnexApp({
  clientId: 'app_stripe',
  appUrl: APP_URL,
  appKey: store.appKey,
  data: store.dataFor,
  // Installed from the discovery page or Settings → Payments: list "Credit card" (Setup needed) right away
  onInstalled: async (shop) => void (await configure(shop, (await view(shop)).ready)),
})

// --- the shop's Stripe connection (app data) ---

type Connection = {
  accountId: string
  accountName: string | null
  livemode: boolean
  // Created by the app when its URL is public (https); null when the merchant forwards events themselves
  webhookEndpointId: string | null
}

const settings = (shop: ShopContext) => ({
  connection: () => shop.data.get<Connection>('stripe'),
  secretKey: () => shop.data.getSecret('stripe_secret_key'),
  webhookSecret: () => shop.data.getSecret('stripe_webhook_secret'),
})

// Stripe only delivers events to public https URLs; anything else needs `stripe listen`
const publicUrl = APP_URL.startsWith('https://')
const webhookUrl = (shop: ShopContext) =>
  `${APP_URL}/stripe/webhook?${new URLSearchParams({ instance: shop.instance, shop: shop.shopId })}`

async function stripeFor(shop: ShopContext) {
  const key = await settings(shop).secretKey()
  if (!key) throw new Error('Stripe is not connected for this shop')
  return new Stripe(key)
}

async function view(shop: ShopContext) {
  const s = settings(shop)
  const [connection, webhookSecret] = await Promise.all([s.connection(), s.webhookSecret()])
  return {
    connection,
    ready: Boolean(connection && webhookSecret),
    canCreateWebhook: publicUrl,
    webhookUrl: webhookUrl(shop),
  }
}

/** Registers (or updates) this shop's "Credit card" method; ready once Stripe can tell us about payments */
const configure = (shop: ShopContext, ready: boolean) =>
  shop.payments.configure({
    name: 'Credit card',
    gateway: 'stripe',
    paymentSessionUrl: `${APP_URL}/payments/session`,
    refundSessionUrl: `${APP_URL}/payments/refund`,
    ready,
  })

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const app = new Hono()
app.route('/', shopnex.routes)
app.get('/icon.svg', (c) => c.body(icon, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }))

// --- settings (embedded page) ---

app.get('/', async (c) => {
  const shop = await shopnex.authenticate(c)
  return c.html(<SettingsPage {...await view(shop)} />)
})

// Checks the key against Stripe, then makes sure Stripe can tell us about payments: a webhook endpoint we
// create (public https URL) or the signing secret of the merchant's own forwarding (`stripe listen`).
app.post('/api/settings', async (c) => {
  const shop = await shopnex.authenticate(c)
  const s = settings(shop)
  const body = (await c.req.json().catch(() => ({}))) as { secretKey?: string; webhookSecret?: string }
  const secretKey = body.secretKey?.trim()
  const webhookSecret = body.webhookSecret?.trim()
  let connection = await s.connection()

  if (secretKey) {
    if (!/^(sk|rk)_(test|live)_\w+$/.test(secretKey)) {
      return c.json({ error: 'Enter a restricted key (rk_…) or a secret key (sk_…)' }, 400)
    }
    let account: Stripe.Account
    try {
      account = await new Stripe(secretKey).accounts.retrieveCurrent()
    } catch (error) {
      return c.json({ error: `Stripe rejected this key: ${message(error)}` }, 400)
    }
    // A different account (or mode) means a different webhook endpoint
    const previous = await s.secretKey()
    if (previous !== secretKey) {
      if (previous && connection?.webhookEndpointId) {
        await new Stripe(previous).webhookEndpoints.del(connection.webhookEndpointId).catch(() => {})
      }
      await shop.data.delete('stripe_webhook_secret')
      connection = { accountId: '', accountName: null, livemode: false, webhookEndpointId: null }
    }
    connection = {
      ...connection!,
      accountId: account.id,
      accountName: account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? null,
      livemode: secretKey.includes('_live_'),
    }
    await shop.data.setSecret('stripe_secret_key', secretKey)
    await shop.data.set('stripe', connection)
  }
  if (!connection) return c.json({ error: 'Enter your Stripe API key' }, 400)

  if (webhookSecret) {
    if (!webhookSecret.startsWith('whsec_')) return c.json({ error: 'The signing secret starts with whsec_' }, 400)
    await shop.data.setSecret('stripe_webhook_secret', webhookSecret)
  } else if (!(await s.webhookSecret()) && publicUrl) {
    try {
      const endpoint = await (
        await stripeFor(shop)
      ).webhookEndpoints.create({
        url: webhookUrl(shop),
        description: `Shopnex (${shop.instance})`,
        enabled_events: [
          'checkout.session.completed',
          'checkout.session.async_payment_succeeded',
          'checkout.session.async_payment_failed',
          'checkout.session.expired',
        ],
      })
      await shop.data.setSecret('stripe_webhook_secret', endpoint.secret!)
      await shop.data.set('stripe', { ...connection, webhookEndpointId: endpoint.id })
    } catch (error) {
      return c.json({ error: `Couldn't create the Stripe webhook: ${message(error)}` }, 400)
    }
  }

  const { ready } = await view(shop)
  try {
    await configure(shop, ready)
  } catch (error) {
    return c.json({ error: `Saved, but Shopnex didn't accept the payment method: ${message(error)}` }, 502)
  }
  return c.json({ ready, message: ready ? 'Stripe is ready to take payments' : 'Saved' })
})

// --- Shopnex → app: payment / refund sessions (signed with the instance's key) ---

// Stripe Checkout sessions last 30 minutes to 24 hours
const checkoutExpiry = (expiresAt: string) => {
  const now = Math.floor(Date.now() / 1000)
  const wanted = Math.floor(new Date(expiresAt).getTime() / 1000)
  return Math.min(Math.max(wanted, now + 30 * 60 + 60), now + 24 * 3600 - 60)
}

app.post('/payments/session', async (c) => {
  const { request, shop } = await shopnex.verifyPaymentsRequest(c, 'payment')
  try {
    const metadata = {
      shopnex_session_id: request.id,
      shopnex_instance: shop.instance,
      shopnex_shop_id: shop.shopId,
      shopnex_order_id: request.orderId,
    }
    const session = await (
      await stripeFor(shop)
    ).checkout.sessions.create(
      {
        mode: 'payment',
        // Tags Shopnex checkouts in the Stripe Dashboard
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
      // Shopnex retrying the same session gets the same Checkout Session
      { idempotencyKey: `shopnex-payment-${request.id}` },
    )
    return c.json({ redirectUrl: session.url })
  } catch (error) {
    console.error(`[stripe] payment session ${request.id}:`, message(error))
    return c.json({ error: message(error) }, 502)
  }
})

// Answers right away; the refund is made and reported to Shopnex in the background
app.post('/payments/refund', async (c) => {
  const { request, shop } = await shopnex.verifyPaymentsRequest(c, 'refund')
  void refund(shop, request)
  return c.body(null, 202)
})

async function refund(shop: ShopContext, request: RefundSessionRequest) {
  try {
    if (!request.payment.externalId) throw new Error('No Stripe payment to refund')
    const result = await (
      await stripeFor(shop)
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

// --- Stripe → app ---

// The URL names the shop (?instance=…&shop=…); its own webhook secret proves the event is Stripe's
app.post('/stripe/webhook', async (c) => {
  const { instance, shop: shopId } = c.req.query()
  const signature = c.req.header('stripe-signature')
  if (!instance || !shopId || !signature) return c.text('Unknown shop', 400)
  let shop: ShopContext
  try {
    shop = await shopnex.forShop(instance, shopId)
  } catch (error) {
    console.warn(`[stripe] webhook for ${instance} ${shopId}:`, message(error))
    return c.text('Unknown shop', 400)
  }
  const [secretKey, webhookSecret] = await Promise.all([settings(shop).secretKey(), settings(shop).webhookSecret()])
  if (!secretKey || !webhookSecret) return c.text('Unknown shop', 400)
  const body = await c.req.text()
  let event: Stripe.Event
  try {
    event = await new Stripe(secretKey).webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch {
    return c.text('Invalid signature', 400)
  }
  if (!event.type.startsWith('checkout.session.')) return c.body(null, 204)
  const session = event.data.object as Stripe.Checkout.Session
  const id = session.metadata?.shopnex_session_id
  // Not one of ours (the same Stripe account may serve other systems or shops)
  if (!id || session.metadata?.shopnex_instance !== shop.instance || session.metadata?.shopnex_shop_id !== shopId) {
    return c.body(null, 204)
  }
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        // Delayed methods (bank debits…) complete unpaid and settle later
        if (session.payment_status === 'paid') await shop.payments.resolve(id, paymentIntent)
        break
      case 'checkout.session.async_payment_succeeded':
        await shop.payments.resolve(id, paymentIntent)
        break
      case 'checkout.session.async_payment_failed':
        await shop.payments.reject(id, 'The payment failed')
        break
      case 'checkout.session.expired':
        await shop.payments.reject(id, 'Checkout expired without payment')
        break
    }
  } catch (error) {
    // Already settled the other way (409) or gone (404): nothing to retry. Anything else: Stripe retries.
    if (error instanceof ShopnexError && (error.status === 409 || error.status === 404)) {
      console.warn(`[stripe] ${event.type} for session ${id}:`, error.message)
      return c.body(null, 204)
    }
    console.error(`[stripe] ${event.type} for session ${id}:`, message(error))
    return c.text('Shopnex unavailable', 503)
  }
  return c.body(null, 204)
})

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error('[stripe]', error)
  return c.json({ error: message(error) }, 500)
})

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Stripe app on ${APP_URL} (port ${PORT})`))
