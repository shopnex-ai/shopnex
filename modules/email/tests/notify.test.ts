// What an order event sends: which emails each event queues, to whom, once only, never when the shop's email is off, and never
// failing the order change that caused it.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { user as userTable } from '@shopnex/core/schema'
import { emailDeliveries, emailSettings, emailTemplates } from '../src/email.schema'
import { orders } from '@shopnex/orders/schema'
import { channels } from '@shopnex/channels/schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { notify } = await import('../src/notifications')
type View = import('../src/notifications').OrderView
const { shopMembers } = await import('@shopnex/tenancy/schema')

const SHOP = 'default'
let orderNumber = 700_000
let counter = 0
const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const made = { orders: [] as string[], users: [] as string[] }

before(prepareDatabase)
beforeEach(cleanup)
after(async () => {
  await cleanup()
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

async function cleanup() {
  await db.delete(emailDeliveries).where(eq(emailDeliveries.shopId, SHOP))
  await db.delete(emailSettings).where(eq(emailSettings.shopId, SHOP))
  await db.delete(emailTemplates).where(eq(emailTemplates.shopId, SHOP))
  if (made.users.length) await db.delete(shopMembers).where(inArray(shopMembers.userId, made.users))
  if (made.orders.length) await db.delete(orders).where(inArray(orders.id, made.orders))
  if (made.users.length) await db.delete(userTable).where(inArray(userTable.id, made.users))
  for (const list of Object.values(made)) list.length = 0
}

const turnOn = (active = true) =>
  db.insert(emailSettings).values({
    shopId: SHOP,
    active,
    config: {
      preset: 'other',
      host: 'localhost',
      port: 1025,
      username: '',
      fromName: 'Shop',
      fromEmail: 'shop@example.test',
    },
  })

async function owner() {
  const id = `u-${unique()}`
  await db.insert(userTable).values({ id, name: 'Owner', email: `${id}@shop.test`, emailVerified: true })
  await db.insert(shopMembers).values({ id: `m-${unique()}`, organizationId: SHOP, userId: id, role: 'owner' })
  made.users.push(id)
  return `${id}@shop.test`
}

async function order(patch: Partial<typeof orders.$inferInsert> = {}) {
  const [channel] = await db.select().from(channels).where(eq(channels.shopId, SHOP))
  const [row] = await db
    .insert(orders)
    .values({
      shopId: SHOP,
      orderNumber: ++orderNumber,
      channelId: channel!.id,
      email: 'buyer@example.test',
      subtotalCents: 1000,
      totalCents: 1000,
      ...patch,
    })
    .returning()
  made.orders.push(row!.id)
  return row!
}

// The shape orders hand over: the order with its lines
const view = (o: Awaited<ReturnType<typeof order>>) =>
  ({ ...o, items: [], shippingLines: [], fulfillments: [], customer: null }) as unknown as View
const sent = async () =>
  (await db.select().from(emailDeliveries).where(eq(emailDeliveries.shopId, SHOP)))
    .map((d) => [d.notification, d.to] as const)
    .sort()

describe('which emails an event queues', () => {
  test('a new order with a manual payment: the buyer’s confirmation and the shop owners’ new-order mail', async () => {
    await turnOn()
    const to = await owner()
    const o = await order()
    await notify(db, SHOP, 'order.created', () => Promise.resolve(view(o)))
    assert.deepEqual(
      await sent(),
      [
        ['order_confirmation', 'buyer@example.test'],
        ['staff_order', to],
      ].sort(),
    )
  })

  test('an order paid through an app is confirmed when it is paid, not when it is created', async () => {
    await turnOn()
    await owner()
    const o = await order({ paymentGateway: 'stripe' })
    await notify(db, SHOP, 'order.created', () => Promise.resolve(view(o)))
    assert.deepEqual(await sent(), [])
    await notify(db, SHOP, 'order.paid', () => Promise.resolve(view(o)))
    assert.deepEqual(
      (await sent()).map((s) => s[0]),
      ['order_confirmation', 'staff_order'],
    )
  })

  test('a manual payment being marked paid sends nothing more', async () => {
    await turnOn()
    const o = await order()
    await notify(db, SHOP, 'order.paid', () => Promise.resolve(view(o)))
    assert.deepEqual(await sent(), [])
  })

  test('fulfilling sends the shipping confirmation to the buyer', async () => {
    await turnOn()
    const o = await order()
    await notify(db, SHOP, 'order.fulfilled', () => Promise.resolve(view(o)))
    assert.deepEqual(await sent(), [['shipping_confirmation', 'buyer@example.test']])
  })

  test('cancelling tells only a buyer who heard about the order', async () => {
    await turnOn()
    const quiet = await order({ paymentGateway: 'stripe' })
    await notify(db, SHOP, 'order.cancelled', () => Promise.resolve(view(quiet)))
    assert.deepEqual(await sent(), [])
    const heard = await order()
    await notify(db, SHOP, 'order.created', () => Promise.resolve(view(heard)))
    await notify(db, SHOP, 'order.cancelled', () => Promise.resolve(view(heard)))
    assert.ok((await sent()).some(([n, to]) => n === 'order_cancelled' && to === 'buyer@example.test'))
  })

  test('a notification the shop turned off is not queued', async () => {
    await turnOn()
    const o = await order()
    await db
      .insert(emailTemplates)
      .values({ shopId: SHOP, notification: 'order_confirmation', subject: 's', body: 'b', enabled: false })
    await notify(db, SHOP, 'order.created', () => Promise.resolve(view(o)))
    assert.deepEqual(
      (await sent()).map((s) => s[0]),
      [],
    )
  })
})

describe('when nothing is queued', () => {
  test('a shop with email off, or never set up, queues nothing and does not even load the order', async () => {
    const o = await order()
    let loaded = 0
    const load = () => {
      loaded++
      return Promise.resolve(view(o))
    }
    await notify(db, SHOP, 'order.created', load)
    await turnOn(false)
    await notify(db, SHOP, 'order.created', load)
    assert.deepEqual([await sent(), loaded], [[], 0])
  })

  test('an order that is gone queues nothing', async () => {
    await turnOn()
    await notify(db, SHOP, 'order.created', () => Promise.resolve(null))
    assert.deepEqual(await sent(), [])
  })
})

describe('being called twice and failing', () => {
  test('the same event again queues no duplicate', async () => {
    await turnOn()
    const o = await order()
    for (let i = 0; i < 2; i++) await notify(db, SHOP, 'order.fulfilled', () => Promise.resolve(view(o)))
    assert.equal((await sent()).length, 1)
  })

  test('a failure while loading is logged, not thrown, and the surrounding transaction carries on', async () => {
    await turnOn()
    const o = await order()
    await db.transaction(async (tx) => {
      await notify(tx, SHOP, 'order.created', () => Promise.reject(new Error('load failed')))
      await tx.update(orders).set({ note: 'still written' }).where(eq(orders.id, o.id))
    })
    const [after] = await db.select().from(orders).where(eq(orders.id, o.id))
    assert.equal(after?.note, 'still written')
  })

  test('the emails are only queued if the order change commits', async () => {
    await turnOn()
    const o = await order()
    await assert.rejects(
      db.transaction(async (tx) => {
        await notify(tx, SHOP, 'order.fulfilled', () => Promise.resolve(view(o)))
        throw new Error('rolled back')
      }),
      /rolled back/,
    )
    assert.deepEqual(await sent(), [])
  })
})
