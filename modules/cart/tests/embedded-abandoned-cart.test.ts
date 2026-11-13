// The abandoned cart email job on the embedded database (PGlite, one connection). Queueing a reminder runs in a
// transaction; reading the cart's lines through the shared handle inside it waits for that transaction for ever and
// freezes the whole shop. This runs the real job on an in-memory PGlite and fails (instead of hanging) if it blocks.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'embedded-abandoned-cart-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, schema, prepareDatabase } = await import('@shopnex/db')
const { channelService } = await import('@shopnex/channels')
const { productService } = await import('@shopnex/catalog')
const { queueAbandonedCartEmails } = await import('@shopnex/email')
const { cartService } = await import('../src')
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

let cartId: string

before(async () => {
  await prepareDatabase()
  const product = await productService.create(SHOP, { title: 'Ceramic Cup', priceCents: 1400 })
  // Email on, abandoned cart reminders on with no delay: a cart with an email is due at once
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
  await db.insert(schema.abandonedCartSettings).values({ shopId: SHOP, enabled: true, delayMinutes: 0 })

  const channel = await channelService.resolve(SHOP, undefined)
  const cart = await cartService.create(SHOP, channel.id, [{ variantId: product.variants[0]!.id, quantity: 2 }])
  await cartService.setReminderContact(cart.token, 'walked-away@example.com')
  const [row] = await db.select({ id: schema.carts.id }).from(schema.carts).where(eq(schema.carts.token, cart.token))
  cartId = row!.id
})

after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('abandoned cart emails on the embedded database', () => {
  test('queues the reminder for a due cart instead of freezing', { timeout: 20_000 }, async () => {
    const handled = await within(10_000, 'queueing the reminders', queueAbandonedCartEmails())
    assert.equal(handled, 1)

    const [delivery] = await within(
      5_000,
      'reading the outbox',
      db.select().from(schema.emailDeliveries).where(eq(schema.emailDeliveries.cartId, cartId)),
    )
    assert.ok(delivery, 'a reminder is queued for the cart')
    assert.equal(delivery.notification, 'abandoned_cart')
    assert.equal(delivery.to, 'walked-away@example.com')
    // Queued, not skipped as "nothing left in the cart": its lines were read
    assert.notEqual(delivery.status, 'skipped', delivery.lastError ?? '')
    assert.match(delivery.html, /Ceramic Cup/)
  })

  test('a cart is reminded once: a second pass queues nothing', { timeout: 20_000 }, async () => {
    const handled = await within(10_000, 'the second pass', queueAbandonedCartEmails())
    assert.equal(handled, 0)
  })
})
