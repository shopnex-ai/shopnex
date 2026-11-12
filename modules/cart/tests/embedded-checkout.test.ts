// Checkout on the embedded database (PGlite), the one `npx create-shopnex` runs on.
//
// PGlite has ONE connection. A query that doesn't go through the open transaction waits for that transaction, which
// then waits for the query: the whole shop freezes (no request that touches the database is ever answered again).
// PostgreSQL hands such a query a second pool connection, so this only shows on the embedded database and the usual
// suites, which run on PostgreSQL, can't catch it. This file runs the real checkout, paying through a payments app,
// on a fresh in-memory PGlite, and fails (instead of hanging for ever) if anything blocks.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import type { PaymentSessionRequest } from '@shopnex/marketplace-sdk/payments'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'embedded-checkout-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, schema, prepareDatabase } = await import('@shopnex/db')
const { appService } = await import('@shopnex/apps')
const { channelService } = await import('@shopnex/channels')
const { productService } = await import('@shopnex/catalog')
const { paymentService, paymentsAppService } = await import('@shopnex/payments')
const { cartService, checkoutService } = await import('../src')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'
const RETURN_URL = 'http://localhost:3000/checkout/return'
const ADDRESS = checkoutService.toMailingAddress({
  firstName: 'Test',
  lastName: 'Buyer',
  address1: '1 Test St',
  city: 'Testville',
  countryCode: 'US',
  zip: '10001',
})

/** Fails the test, instead of hanging it, when `work` doesn't finish: on the embedded database that is the bug */
async function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const frozen = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms: the database is blocked`)), ms)
  })
  try {
    return await Promise.race([work, frozen])
  } finally {
    clearTimeout(timer)
  }
}

let provider: Server
let providerUrl: string
// What the stand-in payments app was asked (its install hook included), and how it answers
const asked: { url: string; body: PaymentSessionRequest }[] = []
let providerAnswers: 'redirect' | 'down' = 'redirect'
let methodId: string
let variantId: string

async function newCart() {
  const channel = await channelService.resolve(SHOP, undefined)
  const cart = await cartService.create(SHOP, channel.id, [{ variantId, quantity: 1 }])
  return cart.token
}

before(async () => {
  await prepareDatabase()

  provider = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    asked.push({ url: req.url ?? '', body: body ? JSON.parse(body) : null })
    if (providerAnswers === 'down') return res.writeHead(503).end('down')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ redirectUrl: `${providerUrl}/pay/${asked.length}` }))
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`

  const product = await productService.create(SHOP, { title: 'Ceramic Cup', priceCents: 1400 })
  variantId = product.variants[0]!.id

  const { app } = await appService.registerApp(
    {
      name: 'Embedded test payments',
      appUrl: `${providerUrl}/app`,
      redirectUrls: [],
      scopes: ['write_payment_sessions'],
    },
    null,
  )
  await appService.installManaged({
    appId: app.id,
    shopId: SHOP,
    userId: null as unknown as string,
    scopes: ['write_payment_sessions'],
  })
  await paymentsAppService.configure(SHOP, app.id, {
    name: 'Credit card',
    gateway: 'test-provider',
    paymentSessionUrl: `${providerUrl}/session`,
    refundSessionUrl: `${providerUrl}/refund`,
    ready: true,
  })
  const [method] = await db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.appId, app.id))
  methodId = method!.id
})

after(async () => {
  await new Promise((resolve) => provider?.close(resolve))
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('checkout with a payments app on the embedded database', () => {
  test('places the order and hands back the provider page instead of freezing', { timeout: 20_000 }, async () => {
    const token = await newCart()
    const placed = await within(
      10_000,
      'completing the checkout',
      checkoutService.complete(
        SHOP,
        token,
        { email: 'buyer@example.com', name: 'Test Buyer', shippingAddress: ADDRESS, paymentMethodId: methodId },
        { returnUrl: RETURN_URL },
      ),
    )
    assert.match(placed.paymentUrl ?? '', new RegExp(`^${providerUrl}/pay/`))
    assert.equal(placed.paymentError, null)
    assert.equal(placed.alreadyCompleted, false)

    // The provider was asked once to start a payment, for this order and the amount of the cart
    const sessions = asked.filter((a) => a.url === '/session')
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0]!.body.orderId, placed.orderId)
    assert.equal(sessions[0]!.body.amount.cents, 1400)
    assert.equal(sessions[0]!.body.returnUrl, RETURN_URL)
    // The URL apps see is this instance's, read before the transaction opened
    assert.equal(sessions[0]!.body.instance, 'http://localhost:3000')
  })

  test('the database still answers afterwards', { timeout: 20_000 }, async () => {
    const orders = await within(5_000, 'reading the orders', db.select().from(schema.orders))
    assert.ok(orders.length >= 1)
    const again = await within(
      5_000,
      'starting a second payment',
      (async () => {
        const [order] = orders
        return paymentService.latestPayment(SHOP, order!.id)
      })(),
    )
    assert.ok(again)
  })

  test(
    'a provider that is down leaves the order placed and unpaid, and the shop responsive',
    { timeout: 20_000 },
    async () => {
      providerAnswers = 'down'
      const token = await newCart()
      const placed = await within(
        10_000,
        'completing the checkout',
        checkoutService.complete(
          SHOP,
          token,
          { email: 'buyer2@example.com', name: 'Test Buyer', shippingAddress: ADDRESS, paymentMethodId: methodId },
          { returnUrl: RETURN_URL },
        ),
      )
      assert.equal(placed.paymentUrl, null)
      assert.match(placed.paymentError ?? '', /couldn't be started/i)
      const [order] = await within(
        5_000,
        'reading the order',
        db.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId)),
      )
      assert.equal(order!.financialStatus, 'pending')
      assert.equal(order!.cancelledAt, null)
      // And completing again retries the payment
      providerAnswers = 'redirect'
      const retried = await within(
        10_000,
        'retrying the payment',
        checkoutService.complete(
          SHOP,
          token,
          { email: 'buyer2@example.com', name: 'Test Buyer', shippingAddress: ADDRESS, paymentMethodId: methodId },
          { returnUrl: RETURN_URL },
        ),
      )
      assert.equal(retried.alreadyCompleted, true)
      assert.equal(retried.orderId, placed.orderId)
      assert.match(retried.paymentUrl ?? '', new RegExp(`^${providerUrl}/pay/`))
    },
  )

  test('completing a cart twice returns the same order', { timeout: 20_000 }, async () => {
    providerAnswers = 'redirect'
    const token = await newCart()
    const input = {
      email: 'buyer3@example.com',
      name: 'Test Buyer',
      shippingAddress: ADDRESS,
      paymentMethodId: methodId,
    }
    const first = await within(
      10_000,
      'the first completion',
      checkoutService.complete(SHOP, token, input, { returnUrl: RETURN_URL }),
    )
    const second = await within(
      10_000,
      'the second completion',
      checkoutService.complete(SHOP, token, input, { returnUrl: RETURN_URL }),
    )
    assert.equal(second.orderId, first.orderId)
    assert.equal(second.alreadyCompleted, true)
    // The same open payment session is handed out again
    assert.equal(second.paymentUrl, first.paymentUrl)
  })
})
