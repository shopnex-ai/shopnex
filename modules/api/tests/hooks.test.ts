// The hooks are only as good as the listeners that are loaded: one that is not does nothing, silently. With the whole API loaded,
// every hook must have the listeners it is there for, and an order change must really end up in the email queue.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { emailDeliveries, emailSettings } from '@shopnex/email/schema'
import { orders } from '@shopnex/orders/schema'
import { channels } from '@shopnex/channels/schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
// What the API itself loads: its router mounts every module
await import('../src/router')
const { appUninstalled } = await import('@shopnex/apps')
const { orderCreditRefunded, orderEvent, orderFullyRefunded, orderService } = await import('@shopnex/orders')
const { checkoutCredit } = await import('@shopnex/cart')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'
const orderIds: string[] = []

before(async () => {
  await prepareDatabase()
  await db.insert(emailSettings).values({
    shopId: SHOP,
    active: true,
    config: {
      preset: 'other',
      host: 'localhost',
      port: 1025,
      username: '',
      fromName: 'Shop',
      fromEmail: 'shop@example.test',
    },
  })
})
after(async () => {
  await db.delete(emailDeliveries).where(eq(emailDeliveries.shopId, SHOP))
  await db.delete(emailSettings).where(eq(emailSettings.shopId, SHOP))
  for (const id of orderIds) await db.delete(orders).where(eq(orders.id, id))
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('who listens', () => {
  test('appUninstalled: payments takes the app’s method out of checkout, ai its capabilities, cart its carrier service', () => {
    assert.deepEqual([...appUninstalled.listeners].sort(), ['ai.providers', 'cart.carrier-services', 'payments.method'])
  })

  test('orderEvent: email queues the order’s emails, gift cards issues the cards a paid order bought', () => {
    assert.deepEqual([...orderEvent.listeners].sort(), ['email.notifications', 'gift-cards.issue'])
  })

  test('checkoutCredit and orderCreditRefunded: gift cards spends a code at checkout and gets refunds back onto the card', () => {
    assert.deepEqual([...checkoutCredit.listeners], ['gift-cards.pay'])
    assert.deepEqual([...orderCreditRefunded.listeners], ['gift-cards.refund'])
    assert.deepEqual([...orderFullyRefunded.listeners], ['gift-cards.revoke'])
  })
})

describe('an order change reaches the email queue', () => {
  test('fulfilling an order queues the shipping confirmation, in the same transaction', async () => {
    const [channel] = await db.select().from(channels).where(eq(channels.shopId, SHOP))
    const [order] = await db
      .insert(orders)
      .values({
        shopId: SHOP,
        orderNumber: 600_001,
        channelId: channel!.id,
        email: 'buyer@example.test',
        subtotalCents: 1000,
        totalCents: 1000,
      })
      .returning()
    orderIds.push(order!.id)
    await orderService.fulfill(SHOP, order!.id, db, { trackingNumber: 'T-1' })
    const queued = await db.select().from(emailDeliveries).where(eq(emailDeliveries.orderId, order!.id))
    assert.deepEqual(
      queued.map((d) => [d.notification, d.to]),
      [['shipping_confirmation', 'buyer@example.test']],
    )
  })
})
