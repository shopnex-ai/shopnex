// Refunding part of an order, end to end, for a manual payment method (bank transfer): the refund is recorded at once.
// Refunds through a payments app are in payments.test.ts. Uses orders it makes itself and removes them at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { orderService } from '@shopnex/orders'
import { Fixtures, SHOP, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()

let admin: Record<string, string>
let variantId: string

before(async () => {
  await requireApp()
  await fx.init()
  admin = await fx.token(['read_orders', 'write_orders'])
  const [variant] = await sellableVariants(1)
  variantId = variant!.id
})

after(async () => {
  await fx.cleanup()
  await closeDb()
})

/** A paid order for two units, paid by a manual method */
async function paidOrder() {
  const placed = await orderService.create(SHOP, { email: fx.email, items: [{ variantId, quantity: 2 }] })
  fx.order(placed.id)
  await orderService.markAsPaid(SHOP, placed.id)
  return { id: placed.id, total: placed.totalCents }
}

const refund = (id: string, amountCents: number) => call('POST', `/admin/orders/${id}/refund`, { amountCents }, admin)
const row = async (id: string) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0]!
const refunds = async (id: string) =>
  (await db.select().from(schema.orderTransactions).where(eq(schema.orderTransactions.orderId, id)))
    .filter((t) => t.kind === 'refund')
    .map((t) => ({ cents: t.amountCents, status: t.status }))

describe('partial refunds', () => {
  test('part of the money goes back and the order stays open', async () => {
    const { id, total } = await paidOrder()
    const half = Math.floor(total / 2)
    const res = ok(await refund(id, half))
    assert.equal(res.financialStatus, 'partially_refunded')
    assert.equal(res.cancelledAt, null, 'not cancelled')
    assert.equal(res.fulfillmentStatus, 'unfulfilled')
    assert.deepEqual(await refunds(id), [{ cents: half, status: 'success' }])
  })

  test('refunding the rest makes it refunded; there is nothing left after that', async () => {
    const { id, total } = await paidOrder()
    ok(await refund(id, 100))
    const res = ok(await refund(id, total - 100))
    assert.equal(res.financialStatus, 'refunded')
    const again = await refund(id, 1)
    assert.equal(again.status, 400, JSON.stringify(again.body))
    assert.equal(again.body.data?.code, 'INVALID_REFUND')
  })

  test('more than is left, zero, a fraction of a cent and a negative amount are refused and record nothing', async () => {
    const { id, total } = await paidOrder()
    ok(await refund(id, 100))
    for (const bad of [total - 100 + 1, total, 0, -5, 1.5]) {
      const res = await refund(id, bad)
      assert.equal(res.status, 400, `${bad}: ${JSON.stringify(res.body)}`)
    }
    assert.deepEqual(await refunds(id), [{ cents: 100, status: 'success' }])
    assert.equal((await row(id)).financialStatus, 'partially_refunded')
  })

  test('an order that was not paid has nothing to refund', async () => {
    const placed = await orderService.create(SHOP, { email: fx.email, items: [{ variantId, quantity: 1 }] })
    fx.order(placed.id)
    const res = await refund(placed.id, 100)
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.deepEqual(await refunds(placed.id), [])
  })

  test('cancelling after a partial refund gives back only what is left', async () => {
    const { id, total } = await paidOrder()
    ok(await refund(id, 300))
    ok(await call('POST', `/admin/orders/${id}/cancel`, { reason: 'customer', restock: true }, admin))
    const all = await refunds(id)
    assert.equal(
      all.reduce((sum, r) => sum + r.cents, 0),
      total,
      'the refunds add up to what was paid, never more',
    )
    assert.deepEqual(
      all.map((r) => r.cents).sort((a, b) => a - b),
      [300, total - 300].sort((a, b) => a - b),
    )
    assert.equal((await row(id)).financialStatus, 'refunded')
  })

  test('a token without the orders scope cannot refund; another shop’s order is not found', async () => {
    const { id } = await paidOrder()
    const readOnly = await fx.token(['read_orders'])
    const denied = await call('POST', `/admin/orders/${id}/refund`, { amountCents: 100 }, readOnly)
    assert.equal(denied.status, 403, JSON.stringify(denied.body))

    const other = await fx.shop()
    const otherAdmin = await fx.token(['write_orders'], other.id)
    const missing = await call('POST', `/admin/orders/${id}/refund`, { amountCents: 100 }, otherAdmin)
    assert.equal(missing.status, 404, JSON.stringify(missing.body))
    assert.deepEqual(await refunds(id), [])
  })
})
