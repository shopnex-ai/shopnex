// Hyperswitch for Shopnex: a bundled payments app on @shopnex/app, charging through Hyperswitch Prism (one API over
// Stripe, Adyen…). Runs next to Shopnex (its own process) and keeps its data in DATA_DIR (SQLite): the merchant's
// credentials are stored there, encrypted with this app's key.
//
//   GET  /                         Embedded settings page (session token)
//   POST /api/settings             Save the connector + credentials, register "Credit card"
//   POST /payments/session         Shopnex: start paying a session → this app's card page
//   GET|POST /pay/:token           The buyer: card page → authorize through Prism → back to the shop
//   POST /payments/refund          Shopnex: refund a session's payment
//   POST /hyperswitch/webhook      Processor: 3D Secure / delayed payment outcomes → resolve / reject
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { PaymentClient, types } from 'hyperswitch-prism'
import { createShopnexApp, type RefundSessionRequest, type ShopContext } from '@shopnex/app'
import { openLocalStore } from '@shopnex/app/store'
import { ICONS } from './connectors.generated'
import { CheckoutPage, MessagePage, RedirectForm } from './checkout'
import {
  CONNECTORS,
  connectorConfig,
  currencyOf,
  errorText,
  checkCredentials,
  isConnector,
  outcomeOf,
  fieldsOf,
  missingFields,
  type ConnectorId,
  type Credentials,
} from './prism'
import { icon, SettingsPage } from './settings'
import { webhookRoutes } from './webhook'

// Public origin Shopnex, the admin (iframe), buyers and the processor reach this app at
const APP_URL = (process.env.HYPERSWITCH_APP_URL || 'http://localhost:4800').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 4800)

const store = await openLocalStore()
const shopnex = createShopnexApp({
  clientId: 'app_hyperswitch',
  appUrl: APP_URL,
  appKey: store.appKey,
  data: store.dataFor,
  // Installed from the discovery page or Settings → Payments: list "Credit card" (Setup needed) right away
  onInstalled: async (shop) => void (await configure(shop, (await view(shop)).ready)),
})

// One row per Shopnex payment session. The card never lands here: only what's needed to finish the payment later.
store.db.exec(`
  CREATE TABLE IF NOT EXISTS checkouts (
    token TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    instance TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    order_number INTEGER NOT NULL,
    cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    email TEXT,
    return_url TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    connector_txn TEXT
  );
  CREATE INDEX IF NOT EXISTS checkouts_session ON checkouts (instance, shop_id, session_id);
  CREATE INDEX IF NOT EXISTS checkouts_txn ON checkouts (connector_txn);
`)
type Checkout = {
  token: string
  session_id: string
  instance: string
  shop_id: string
  order_number: number
  cents: number
  currency: string
  email: string | null
  return_url: string
  expires_at: number
  status: 'open' | 'processing' | 'pending' | 'paid'
  connector_txn: string | null
}
const db = {
  insert: store.db.prepare(
    `INSERT INTO checkouts (token, session_id, instance, shop_id, order_number, cents, currency, email, return_url, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  byToken: store.db.prepare('SELECT * FROM checkouts WHERE token = ?'),
  byTxn: store.db.prepare('SELECT * FROM checkouts WHERE instance = ? AND shop_id = ? AND connector_txn = ?'),
  bySession: store.db.prepare('SELECT * FROM checkouts WHERE instance = ? AND shop_id = ? AND session_id = ?'),
  // Only one request at a time gets to charge a checkout (a double click must not charge twice)
  claim: store.db.prepare("UPDATE checkouts SET status = 'processing' WHERE token = ? AND status = 'open'"),
  setStatus: store.db.prepare(
    'UPDATE checkouts SET status = ?, connector_txn = COALESCE(?, connector_txn) WHERE token = ?',
  ),
}
const checkoutOf = (token: string) => db.byToken.get(token) as Checkout | undefined

// --- the shop's connection (app data) ---

type Connection = { connector: ConnectorId; testMode: boolean }

const settings = (shop: ShopContext) => ({
  connection: () => shop.data.get<Connection>('hyperswitch'),
  values: async () => {
    const raw = await shop.data.getSecret('hyperswitch_credentials')
    return raw ? (JSON.parse(raw) as Record<string, string>) : null
  },
  webhookSecret: () => shop.data.getSecret('hyperswitch_webhook_secret'),
})

async function credentialsFor(shop: ShopContext): Promise<Credentials | null> {
  const [connection, values] = await Promise.all([settings(shop).connection(), settings(shop).values()])
  return connection && values ? { ...connection, values } : null
}

const webhookUrl = (shop: ShopContext) =>
  `${APP_URL}/hyperswitch/webhook?${new URLSearchParams({ instance: shop.instance, shop: shop.shopId })}`

async function view(shop: ShopContext) {
  const [connection, webhookSecret, values] = await Promise.all([
    settings(shop).connection(),
    settings(shop).webhookSecret(),
    settings(shop).values(),
  ])
  return {
    connection,
    // Which fields are saved (never their values): the form says so in their placeholders
    saved: Object.keys(values ?? {}),
    ready: Boolean(connection && webhookSecret),
    webhookUrl: webhookUrl(shop),
  }
}

/** Registers (or updates) this shop's "Credit card" method; ready once the processor can tell us about payments */
const configure = (shop: ShopContext, ready: boolean) =>
  shop.payments.configure({
    name: 'Credit card',
    gateway: 'hyperswitch',
    paymentSessionUrl: `${APP_URL}/payments/session`,
    refundSessionUrl: `${APP_URL}/payments/refund`,
    ready,
  })

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const app = new Hono()
app.route('/', shopnex.routes)
app.get('/icon.svg', (c) => c.body(icon, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }))

// Processor logos (icons/, from the Hyperswitch Control Center). Third-party SVGs: shown as <img> only, and served
// with a policy that stops them running or loading anything even if opened directly.
app.get('/icons/:file', async (c) => {
  const id = c.req.param('file').replace(/\.svg$/, '')
  if (!ICONS.includes(id)) return c.notFound()
  return c.body(await readFile(new URL(`../icons/${id}.svg`, import.meta.url)), 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  })
})

// --- settings (embedded page) ---

app.get('/', async (c) => c.html(<SettingsPage {...await view(await shopnex.authenticate(c))} />))

app.post('/api/settings', async (c) => {
  const shop = await shopnex.authenticate(c)
  const s = settings(shop)
  const body = (await c.req.json().catch(() => ({}))) as Record<string, string | boolean | undefined>
  const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '')
  const previous = await s.connection()

  const connector = text('connector') || previous?.connector
  if (!isConnector(connector)) return c.json({ error: 'Choose a processor' }, 400)
  const testMode = body.testMode === true || body.testMode === 'on'

  // Fields left empty keep what was saved (values are never sent back to the page)
  const saved = previous?.connector === connector ? ((await s.values()) ?? {}) : {}
  const values: Record<string, string> = {}
  for (const { name } of fieldsOf(connector)) {
    const entered = text(`field_${name}`) || saved[name]
    if (entered) values[name] = entered
  }
  const missing = missingFields(connector, values)
  if (missing) return c.json({ error: missing }, 400)
  if (!Object.keys(values).length) return c.json({ error: 'Enter your credentials' }, 400)
  const incomplete = await checkCredentials({ connector, testMode, values })
  if (incomplete) return c.json({ error: incomplete }, 400)

  await shop.data.setSecret('hyperswitch_credentials', JSON.stringify(values))
  await shop.data.set('hyperswitch', { connector, testMode } satisfies Connection)
  if (previous && previous.connector !== connector) await shop.data.delete('hyperswitch_webhook_secret')
  if (text('webhookSecret')) await shop.data.setSecret('hyperswitch_webhook_secret', text('webhookSecret'))

  const { ready } = await view(shop)
  try {
    await configure(shop, ready)
  } catch (error) {
    return c.json({ error: `Saved, but Shopnex didn't accept the payment method: ${message(error)}` }, 502)
  }
  return c.json({ ready, message: ready ? `${CONNECTORS[connector]!.label} is ready to take payments` : 'Saved' })
})

// --- Shopnex → app: payment / refund sessions (signed with the instance's key) ---

app.post('/payments/session', async (c) => {
  const { request, shop } = await shopnex.verifyPaymentsRequest(c, 'payment')
  if (!currencyOf(request.amount.currency))
    return c.json({ error: `Unsupported currency ${request.amount.currency}` }, 400)
  if (!(await credentialsFor(shop))) return c.json({ error: 'Hyperswitch is not connected for this shop' }, 502)
  // Shopnex retrying the same session gets the same card page
  const existing = db.bySession.get(shop.instance, shop.shopId, request.id) as Checkout | undefined
  const token = existing?.token ?? randomBytes(24).toString('base64url')
  if (!existing) {
    db.insert.run(
      token,
      request.id,
      shop.instance,
      shop.shopId,
      request.orderNumber,
      request.amount.cents,
      request.amount.currency.toUpperCase(),
      request.customer.email,
      request.returnUrl,
      new Date(request.expiresAt).getTime(),
    )
  }
  return c.json({ redirectUrl: `${APP_URL}/pay/${token}` })
})

// --- the buyer ---

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100)

const page = (row: Checkout, error?: string) => (
  <CheckoutPage
    token={row.token}
    orderNumber={row.order_number}
    amount={money(row.cents, row.currency)}
    error={error}
  />
)
const noStore = { 'cache-control': 'no-store' }

app.get('/pay/:token', (c) => {
  const row = checkoutOf(c.req.param('token'))
  if (!row) return c.html(<MessagePage message="This payment link isn't valid." />, 404)
  if (row.status !== 'open') return c.redirect(row.return_url)
  if (row.expires_at < Date.now()) return c.redirect(row.return_url)
  return c.html(page(row), 200, noStore)
})

// 3D Secure and other redirects come back here; the outcome itself arrives by webhook
app.all('/pay/:token/return', (c) => {
  const row = checkoutOf(c.req.param('token'))
  return row ? c.redirect(row.return_url, 303) : c.html(<MessagePage message="This payment link isn't valid." />, 404)
})

const luhn = (digits: string) => {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1 && (d *= 2) > 9) d -= 9
    sum += d
  }
  return sum % 10 === 0
}

/** The card as typed → Prism's card, or what to tell the buyer */
function parseCard(form: Record<string, unknown>) {
  const str = (k: string) => (typeof form[k] === 'string' ? (form[k] as string).trim() : '')
  const number = str('number').replace(/[\s-]/g, '')
  if (!/^\d{12,19}$/.test(number) || !luhn(number)) return { error: 'Check the card number' }
  const exp = /^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/.exec(str('expiry'))
  const month = exp ? Number(exp[1]) : 0
  if (!exp || month < 1 || month > 12) return { error: 'Check the expiry date (MM/YY)' }
  const yearText = exp[2] ?? ''
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
  const now = new Date()
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return { error: 'This card has expired' }
  }
  const cvc = str('cvc')
  if (!/^\d{3,4}$/.test(cvc)) return { error: 'Check the security code' }
  if (!str('name')) return { error: 'Enter the name on the card' }
  return {
    card: {
      cardNumber: { value: number },
      cardExpMonth: { value: String(month).padStart(2, '0') },
      cardExpYear: { value: String(year) },
      cardCvc: { value: cvc },
      cardHolderName: { value: str('name') },
    },
  }
}

app.post('/pay/:token', async (c) => {
  const row = checkoutOf(c.req.param('token'))
  if (!row) return c.html(<MessagePage message="This payment link isn't valid." />, 404)
  if (row.status !== 'open' || row.expires_at < Date.now()) return c.redirect(row.return_url, 303)
  const parsed = parseCard(await c.req.parseBody())
  if (!parsed.card) return c.html(page(row, parsed.error), 200, noStore)
  if (db.claim.run(row.token).changes === 0) return c.redirect(row.return_url, 303)

  const shop = await shopnex.forShop(row.instance, row.shop_id)
  const credentials = await credentialsFor(shop)
  if (!credentials) {
    db.setStatus.run('open', null, row.token)
    return c.html(page(row, 'Payments are unavailable right now. Please try again later.'), 200, noStore)
  }
  try {
    const response = await new PaymentClient(connectorConfig(credentials)).authorize({
      merchantTransactionId: row.session_id,
      merchantOrderId: String(row.order_number),
      amount: { minorAmount: row.cents, currency: currencyOf(row.currency) },
      captureMethod: types.CaptureMethod.AUTOMATIC,
      paymentMethod: { card: parsed.card },
      customer: row.email ? { email: { value: row.email } } : undefined,
      address: { billingAddress: {} },
      authType: types.AuthenticationType.NO_THREE_DS,
      returnUrl: `${APP_URL}/pay/${row.token}/return`,
      webhookUrl: webhookUrl(shop),
      browserInfo: {
        userAgent: c.req.header('user-agent'),
        acceptHeader: c.req.header('accept'),
        language: c.req.header('accept-language')?.split(',')[0],
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
        javaScriptEnabled: true,
      },
      description: `Order #${row.order_number}`,
      testMode: credentials.testMode,
    })
    const txn = response.connectorTransactionId ?? null
    const outcome = outcomeOf(response.status)
    if (outcome === 'failed') {
      db.setStatus.run('open', txn, row.token)
      const reason = errorText(response.error, 'The payment was declined')
      await shop.payments.attemptFailed(row.session_id, reason).catch(() => {})
      return c.html(page(row, reason), 200, noStore)
    }
    if (outcome === 'paid') {
      db.setStatus.run('paid', txn, row.token)
      await shop.payments.resolve(row.session_id, txn ?? undefined)
      return c.redirect(row.return_url, 303)
    }
    // 3D Secure or a delayed method: the buyer goes on to the processor, the webhook reports the outcome
    db.setStatus.run('pending', txn, row.token)
    const redirect = response.redirectionData
    if (redirect?.uri?.uri) return c.redirect(redirect.uri.uri, 303)
    if (redirect?.form?.endpoint) {
      return c.html(
        <RedirectForm endpoint={redirect.form.endpoint} fields={redirect.form.formFields ?? {}} />,
        200,
        noStore,
      )
    }
    return c.redirect(row.return_url, 303)
  } catch (error) {
    console.error(`[hyperswitch] payment ${row.session_id}:`, message(error))
    // A request that never got an answer may still have charged: leave it to the webhook instead of offering a retry
    if (error instanceof Error && error.constructor.name === 'IntegrationError') {
      db.setStatus.run('open', null, row.token)
      return c.html(
        page(row, 'We couldn’t process this payment. Please check your details and try again.'),
        200,
        noStore,
      )
    }
    db.setStatus.run('pending', null, row.token)
    return c.redirect(row.return_url, 303)
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
    const txn = request.payment.externalId
    if (!txn) throw new Error('No payment to refund')
    const paid = db.byTxn.get(shop.instance, shop.shopId, txn) as Checkout | undefined
    const credentials = await credentialsFor(shop)
    if (!paid || !credentials) throw new Error(paid ? 'Hyperswitch is not connected for this shop' : 'Unknown payment')
    const result = await new PaymentClient(connectorConfig(credentials)).refund({
      merchantRefundId: request.id,
      connectorTransactionId: txn,
      paymentAmount: paid.cents,
      refundAmount: { minorAmount: request.amount.cents, currency: currencyOf(request.amount.currency) },
      reason: 'RETURN',
      testMode: credentials.testMode,
    })
    // Pending is a normal success for many processors
    if (result.status === types.RefundStatus.REFUND_SUCCESS || result.status === types.RefundStatus.REFUND_PENDING) {
      await shop.payments.resolve(request.id, result.connectorRefundId ?? undefined)
    } else {
      await shop.payments.reject(request.id, errorText(result.error, 'The refund failed'))
    }
  } catch (error) {
    console.error(`[hyperswitch] refund ${request.id}:`, message(error))
    await shop.payments
      .reject(request.id, message(error))
      .catch((e) => console.error(`[hyperswitch] reject refund ${request.id}:`, message(e)))
  }
}

// --- processor → app ---

app.route(
  '/',
  webhookRoutes({
    forShop: shopnex.forShop,
    secrets: async (shop) => ({
      credentials: await credentialsFor(shop),
      webhookSecret: await settings(shop).webhookSecret(),
    }),
    sessionFor: (shop, txn, merchantId) =>
      (
        (txn && (db.byTxn.get(shop.instance, shop.shopId, txn) as Checkout | undefined)) ||
        (merchantId && (db.bySession.get(shop.instance, shop.shopId, merchantId) as Checkout | undefined)) ||
        undefined
      )?.session_id ?? null,
  }),
)

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error('[hyperswitch]', error)
  return c.json({ error: message(error) }, 500)
})

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Hyperswitch app on ${APP_URL} (port ${PORT})`))
