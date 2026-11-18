// The dashboard numbers: sales and orders per day over a period with the one before it, what counts as a sale, returning customers, the
// five best sellers, and the work waiting on staff.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { orders } from '../src/orders.schema'
import { products } from '@shopnex/catalog/schema'
import { channels } from '@shopnex/channels/schema'

const { db, eq, SHOP, OTHER_SHOP } = fx
const { orderAnalytics } = await import('../src')

const DAY = 86_400_000
const ago = (days: number, hours = 12) => new Date(Date.now() - days * DAY - (hours - 12) * 3_600_000)

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

/** An order of this total, placed this many days ago */
async function order(
  daysAgo: number,
  patch: Partial<typeof orders.$inferInsert> & { customerId?: string | null; shopId?: string } = {},
) {
  const shopId = patch.shopId ?? SHOP
  await fx.onlineStore(shopId)
  const [channel] = await db.select().from(channels).where(eq(channels.shopId, shopId))
  const [o] = await db
    .insert(orders)
    .values({
      shopId,
      orderNumber: Math.floor(Math.random() * 1e8),
      channelId: channel!.id,
      email: 'a@example.test',
      subtotalCents: 1000,
      totalCents: 1000,
      createdAt: ago(daysAgo),
      ...patch,
    })
    .returning()
  return o!
}
const overview = (days = 7, timezone = 'UTC') => orderAnalytics.overview(SHOP, { days, timezone })

describe('the period', () => {
  test('one entry per day, oldest first, ending today, each with the same day of the period before', async () => {
    const { series } = await overview(7)
    assert.equal(series.length, 7)
    const today = new Date().toISOString().slice(0, 10)
    assert.equal(series.at(-1)?.date, today)
    assert.equal(series[0]?.date, new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10))
    assert.equal(series[0]?.previousDate, new Date(Date.now() - 13 * DAY).toISOString().slice(0, 10))
    assert.ok(
      series.every((d) => d.salesCents === 0 && d.orders === 0 && d.previousSalesCents === 0 && d.previousOrders === 0),
    )
  })

  test('sales and orders land on their day and in the right period; older orders are left out', async () => {
    await order(0, { totalCents: 1000 })
    await order(0, { totalCents: 500 })
    await order(3, { totalCents: 2000 })
    await order(8, { totalCents: 4000 })
    await order(30, { totalCents: 9999 })
    const o = await overview(7)
    assert.deepEqual([o.current.salesCents, o.current.orders, o.current.averageOrderCents], [3500, 3, 1167])
    assert.deepEqual([o.previous.salesCents, o.previous.orders, o.previous.averageOrderCents], [4000, 1, 4000])
    assert.deepEqual(o.series.at(-1) && [o.series.at(-1)!.salesCents, o.series.at(-1)!.orders], [1500, 2])
  })

  test('the days are cut in the timezone asked for: the last day is today there, and an order placed now is on it', async () => {
    await order(0, { totalCents: 700 })
    for (const timezone of ['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12', 'America/Los_Angeles']) {
      const { series, current } = await overview(3, timezone)
      assert.equal(
        series.at(-1)?.date,
        new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()),
        timezone,
      )
      assert.deepEqual([series.at(-1)?.salesCents, current.salesCents], [700, 700], timezone)
    }
  })
})

describe('what counts as a sale', () => {
  test('every order that is not cancelled, voided or fully refunded; a partial refund still counts in full', async () => {
    await order(0, { totalCents: 100 })
    await order(0, { totalCents: 200, financialStatus: 'paid' })
    await order(0, { totalCents: 400, financialStatus: 'partially_refunded' })
    await order(0, { totalCents: 800, financialStatus: 'voided' })
    await order(0, { totalCents: 1600, financialStatus: 'refunded' })
    await order(0, { totalCents: 3200, cancelledAt: new Date() })
    assert.deepEqual([(await overview(1)).current.salesCents, (await overview(1)).current.orders], [700, 3])
  })

  test('only this shop’s orders', async () => {
    await order(0, { totalCents: 100 })
    await order(0, { totalCents: 900, shopId: OTHER_SHOP })
    assert.equal((await overview(1)).current.salesCents, 100)
  })
})

describe('returning customers', () => {
  test('the share of the period’s customers who had a counted order before it', async () => {
    const [returning, fresh, gone] = [await fx.customer(), await fx.customer(), await fx.customer()]
    await order(20, { customerId: returning.id })
    await order(20, { customerId: gone.id, cancelledAt: new Date() })
    await order(1, { customerId: returning.id })
    await order(1, { customerId: fresh.id })
    await order(1, { customerId: gone.id })
    const o = await overview(7)
    assert.equal(o.current.returningCustomerRate, 1 / 3, 'a cancelled earlier order does not make a customer returning')
  })

  test('no customers is 0', async () => {
    assert.equal((await overview(7)).current.returningCustomerRate, 0)
  })
})

describe('best sellers and work waiting', () => {
  test('the five products with the most sales in the period, with their current title, image and what they sold', async () => {
    const hits = []
    for (let i = 1; i <= 6; i++)
      hits.push(
        await fx.product({
          title: `P${String(i)}`,
          priceCents: i * 100,
          images: [{ url: `https://example.com/p${String(i)}.png` }],
        }),
      )
    for (const [i, p] of hits.entries()) {
      const o = await fx.orderService.create(SHOP, {
        email: 'a@example.test',
        items: [{ productId: p.id, quantity: 2 }],
      })
      void i
      void o
    }
    await db.update(products).set({ title: 'Renamed' }).where(eq(products.id, hits[5]!.id))
    const top = (await overview(7)).topProducts
    assert.equal(top.length, 5)
    assert.deepEqual(
      top.map((t) => [t.title, t.salesCents, t.units]),
      [
        ['Renamed', 1200, 2],
        ['P5', 1000, 2],
        ['P4', 800, 2],
        ['P3', 600, 2],
        ['P2', 400, 2],
      ],
    )
    assert.equal(top[0]?.imageUrl, 'https://example.com/p6.png')
    assert.equal(top[0]?.productId, hits[5]!.id)
  })

  test('a product deleted since is shown as it was ordered', async () => {
    const p = await fx.product({ title: 'Gone soon', priceCents: 500 })
    await fx.orderService.create(SHOP, { email: 'a@example.test', items: [{ productId: p.id, quantity: 1 }] })
    await db.delete(products).where(eq(products.id, p.id))
    const [top] = (await overview(7)).topProducts
    assert.deepEqual([top?.title, top?.productId, top?.salesCents], ['Gone soon', null, 500])
  })

  test('the unfulfilled and unpaid orders waiting, whatever the period, not counting cancelled ones', async () => {
    await order(60)
    await order(0, { financialStatus: 'paid' })
    await order(0, { fulfillmentStatus: 'fulfilled', financialStatus: 'paid' })
    await order(0, { cancelledAt: new Date() })
    assert.deepEqual((await overview(1)).attention, { unfulfilled: 2, unpaid: 1 })
  })

  test('nothing at all is zeros', async () => {
    const o = await overview(30)
    assert.deepEqual([o.current.salesCents, o.topProducts, o.attention], [0, [], { unfulfilled: 0, unpaid: 0 }])
  })
})
