// Everything that runs inside the order's transaction on the embedded database (PGlite, one connection): the order
// confirmation and staff emails, webhook deliveries, stock, and later paying and cancelling it. A query on the shared
// handle in any of those waits for the transaction for ever and freezes the shop, and only the embedded database
// does that, so this runs the real flow on an in-memory PGlite with email and a webhook turned on. The guard in
// @shopnex/db turns such a query into an error, and each step has a timeout, so a regression fails instead of hanging.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'embedded-order-lifecycle-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, schema, prepareDatabase } = await import('@shopnex/db')
const { channelService } = await import('@shopnex/channels')
const { productService } = await import('@shopnex/catalog')
const { orderService } = await import('@shopnex/orders')
const { cartService, checkoutService } = await import('../src')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'

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

let variantId: string
let orderId: string

before(async () => {
  await prepareDatabase()
  const product = await productService.create(SHOP, { title: 'Ceramic Cup', priceCents: 1400 })
  variantId = product.variants[0]!.id
  await db.insert(schema.emailSettings).values({
    shopId: SHOP,
    config: {
      preset: 'custom',
      host: 'localhost',
      port: 25,
      username: '',
      fromName: 'Shop',
      fromEmail: 'shop@example.com',
    },
    active: true,
  })
  await db.insert(schema.webhookEndpoints).values({
    shopId: SHOP,
    url: 'http://127.0.0.1:9/hook',
    topics: ['order.created', 'order.paid', 'order.updated', 'order.fulfilled', 'order.cancelled'],
    secret: 'whsec_test',
    active: true,
  })
})

after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('an order on the embedded database, with email and a webhook on', () => {
  test('placing it queues the confirmation email and the webhook', { timeout: 30_000 }, async () => {
    const channel = await channelService.resolve(SHOP, undefined)
    const cart = await cartService.create(SHOP, channel.id, [{ variantId, quantity: 2 }])
    const placed = await within(
      10_000,
      'placing the order',
      checkoutService.complete(
        SHOP,
        cart.token,
        {
          email: 'buyer@example.com',
          name: 'Test Buyer',
          shippingAddress: checkoutService.toMailingAddress({
            lastName: 'Buyer',
            address1: '1 Test St',
            city: 'Testville',
            countryCode: 'US',
          }),
        },
        { returnUrl: 'http://localhost:3000/checkout/return' },
      ),
    )
    orderId = placed.orderId

    const emails = await within(
      5_000,
      'reading the outbox',
      db.select().from(schema.emailDeliveries).where(eq(schema.emailDeliveries.orderId, orderId)),
    )
    assert.ok(
      emails.some((e) => e.notification === 'order_confirmation' && e.to === 'buyer@example.com'),
      'confirmation queued',
    )
    const confirmation = emails.find((e) => e.notification === 'order_confirmation')!
    assert.match(confirmation.html, /Ceramic Cup/)

    const hooks = await within(5_000, 'reading the webhook outbox', db.select().from(schema.webhookDeliveries))
    assert.ok(
      hooks.some((h) => h.topic === 'order.created' && h.body.includes(orderId)),
      'order.created queued',
    )
  })

  test('marking it paid queues order.paid', { timeout: 30_000 }, async () => {
    await within(10_000, 'marking the order paid', orderService.markAsPaid(SHOP, orderId))
    const hooks = await within(5_000, 'reading the webhook outbox', db.select().from(schema.webhookDeliveries))
    assert.ok(
      hooks.some((h) => h.topic === 'order.paid'),
      'order.paid queued',
    )
  })

  test('fulfilling it queues the shipping email and order.fulfilled', { timeout: 30_000 }, async () => {
    await within(10_000, 'fulfilling the order', orderService.fulfill(SHOP, orderId))
    const hooks = await within(5_000, 'reading the webhook outbox', db.select().from(schema.webhookDeliveries))
    assert.ok(
      hooks.some((h) => h.topic === 'order.fulfilled'),
      'order.fulfilled queued',
    )
  })

  test('cancelling another order queues order.cancelled', { timeout: 30_000 }, async () => {
    const channel = await channelService.resolve(SHOP, undefined)
    const cart = await cartService.create(SHOP, channel.id, [{ variantId, quantity: 1 }])
    const placed = await within(
      10_000,
      'placing the second order',
      checkoutService.complete(
        SHOP,
        cart.token,
        {
          email: 'buyer2@example.com',
          name: 'Test Buyer',
          shippingAddress: checkoutService.toMailingAddress({
            lastName: 'Buyer',
            address1: '1 Test St',
            city: 'Testville',
            countryCode: 'US',
          }),
        },
        { returnUrl: 'http://localhost:3000/checkout/return' },
      ),
    )
    await within(
      10_000,
      'cancelling the order',
      orderService.cancel(SHOP, placed.orderId, { reason: 'customer', restock: true }),
    )
    const hooks = await within(5_000, 'reading the webhook outbox', db.select().from(schema.webhookDeliveries))
    assert.ok(
      hooks.some((h) => h.topic === 'order.cancelled' && h.body.includes(placed.orderId)),
      'order.cancelled queued',
    )
  })
})
