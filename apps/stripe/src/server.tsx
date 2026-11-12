// Stripe for ShopNex: a bundled payments app on @shopnex/app. Runs next to ShopNex (its own process) and keeps
// its data in ShopNex (shop.data): the merchant's Stripe keys are stored there, encrypted with this app's key.
//
//   GET  /                      Embedded settings page (session token)
//   POST /api/settings          Save the Stripe key (+ webhook secret when local), register "Credit card"
//   POST /payments/session      ShopNex: start paying a session → Stripe Checkout URL
//   POST /payments/refund       ShopNex: refund a session's payment
//   POST /stripe/webhook        Stripe: checkout completed / expired, async payments → resolve / reject
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import Stripe from 'stripe'
import { createShopnexApp, type ShopContext } from '@shopnex/app'
import { icon, SettingsPage } from './settings'
import { paymentRoutes } from './payments'
import { ensureWebhookEvents, WEBHOOK_EVENTS, webhookRoutes } from './webhook'

// Public origin ShopNex, the admin (iframe) and Stripe reach this app at
const APP_URL = (process.env.STRIPE_APP_URL || 'http://localhost:4600').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 4600)

// Its identity is STRIPE_APP_KEY (env only); ShopNex stores the shops' settings and sealed secrets (shop.data). ShopNex reads the public key
// from /.well-known/shopnex-app.json (bundled app): see registerBundledApps in @shopnex/apps
const shopnex = createShopnexApp({
  clientId: 'app_stripe',
  appUrl: APP_URL,
  appKey: process.env.STRIPE_APP_KEY,
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

// Opening the settings also brings an endpoint created by an older version up to date (best effort)
async function refreshWebhook(shop: ShopContext) {
  const [connection, key] = await Promise.all([settings(shop).connection(), settings(shop).secretKey()])
  if (!connection?.webhookEndpointId || !key) return
  try {
    if (await ensureWebhookEvents(new Stripe(key), connection.webhookEndpointId)) {
      console.log(`[stripe] added the missing events to the webhook endpoint of ${shop.instance} ${shop.shopId}`)
    }
  } catch (error) {
    console.warn(`[stripe] couldn't update the webhook events of ${shop.instance} ${shop.shopId}:`, message(error))
  }
}

app.get('/', async (c) => {
  const shop = await shopnex.authenticate(c)
  await refreshWebhook(shop)
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
        description: `ShopNex (${shop.instance})`,
        enabled_events: [...WEBHOOK_EVENTS],
      })
      await shop.data.setSecret('stripe_webhook_secret', endpoint.secret!)
      await shop.data.set('stripe', { ...connection, webhookEndpointId: endpoint.id })
    } catch (error) {
      return c.json({ error: `Couldn't create the Stripe webhook: ${message(error)}` }, 400)
    }
  }

  await refreshWebhook(shop)
  const { ready } = await view(shop)
  try {
    await configure(shop, ready)
  } catch (error) {
    return c.json({ error: `Saved, but ShopNex didn't accept the payment method: ${message(error)}` }, 502)
  }
  return c.json({ ready, message: ready ? 'Stripe is ready to take payments' : 'Saved' })
})

// --- ShopNex → app: payment / refund sessions (signed with the instance's key), see payments.ts ---

app.route('/', paymentRoutes({ verify: shopnex.verifyPaymentsRequest, stripeFor }))

// --- Stripe → app ---

app.route(
  '/',
  webhookRoutes({
    forShop: shopnex.forShop,
    secrets: async (shop) => ({
      secretKey: await settings(shop).secretKey(),
      webhookSecret: await settings(shop).webhookSecret(),
    }),
  }),
)

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error('[stripe]', error)
  return c.json({ error: message(error) }, 500)
})

serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST || undefined }, () =>
  console.log(`Stripe app on ${APP_URL} (port ${PORT})`),
)
