// Partial fulfillments end to end: ship some items, then the rest; each shipment has its own tracking; cancel a
// shipment and its items are unfulfilled again; webhooks for every change. Orders are made through the admin API
// (no payment session, so no payments app is involved).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { Fixtures, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()
let auth: Record<string, string>
let hookId: string
let variants: { id: string }[]

before(async () => {
  await requireApp()
  await fx.init()
  variants = (await sellableVariants(2)) as { id: string }[]
  auth = await fx.token(['write_orders'])
  // Nothing listens here: the deliveries are still queued (outbox), which is what is checked
  const hook = ok(
    await call(
      'POST',
      '/admin/webhooks',
      {
        url: 'http://127.0.0.1:9/unused',
        description: 'e2e fulfillments',
        topics: ['fulfillment.created', 'fulfillment.updated', 'order.fulfilled'],
        active: true,
      },
      auth,
    ),
  )
  hookId = hook.id
})

after(async () => {
  await fx.cleanup()
  if (hookId) await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, hookId))
  await closeDb()
})

type Item = { id: string; quantity: number; fulfilledQuantity: number; fulfillableQuantity: number }
type Fulfillment = { id: string; status: string; items: { orderItemId: string; quantity: number }[] }
type OrderView = {
  id: string
  fulfillmentStatus: string
  items: Item[]
  fulfillments: Fulfillment[]
}

// Three of one variant and one of another
async function newOrder() {
  const placed = ok(
    await call(
      'POST',
      '/admin/orders',
      {
        email: fx.email,
        items: [
          { variantId: variants[0]!.id, quantity: 3 },
          { variantId: variants[1]?.id ?? variants[0]!.id, quantity: 1 },
        ],
      },
      auth,
    ),
  )
  fx.order(placed.id)
  return ok(await call('GET', `/admin/orders/${placed.id}`, undefined, auth)) as OrderView
}

const fulfill = (orderId: string, body: object = {}) =>
  call('POST', `/admin/orders/${orderId}/fulfill`, { notifyCustomer: false, ...body }, auth)
const reload = async (orderId: string) =>
  ok(await call('GET', `/admin/orders/${orderId}`, undefined, auth)) as OrderView
const topicsOf = async (orderId: string) => {
  const rows = await db
    .select({ topic: schema.webhookDeliveries.topic, body: schema.webhookDeliveries.body })
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.endpointId, hookId))
  // Only this order's: the payload names it
  return rows.filter((r) => r.body.includes(orderId)).map((r) => r.topic)
}

describe('fulfillments: ship in parts', () => {
  test('part of an order: partially fulfilled, with what is left to ship', async () => {
    const order = await newOrder()
    const [a] = order.items
    assert.ok(a)
    const done = ok(
      await fulfill(order.id, {
        items: [{ orderItemId: a.id, quantity: 2 }],
        trackingCompany: 'DHL',
        trackingNumber: 'E2E-1',
      }),
    ) as OrderView
    assert.equal(done.fulfillmentStatus, 'partially_fulfilled')
    const item = done.items.find((i) => i.id === a.id)!
    assert.equal(item.fulfilledQuantity, 2)
    assert.equal(item.fulfillableQuantity, a.quantity - 2)
    assert.equal(done.fulfillments.length, 1)
    assert.deepEqual(done.fulfillments[0]!.items, [{ orderItemId: a.id, quantity: 2 }])
    // The whole order hasn't shipped: no order.fulfilled yet, but the shipment was announced
    const topics = await topicsOf(order.id)
    assert.ok(topics.includes('fulfillment.created'))
    assert.ok(!topics.includes('order.fulfilled'))
  })

  test('the rest in a second shipment finishes the order', async () => {
    const order = await newOrder()
    const [a] = order.items
    ok(await fulfill(order.id, { items: [{ orderItemId: a!.id, quantity: 1 }], trackingNumber: 'E2E-A' }))
    const done = ok(await fulfill(order.id, { trackingNumber: 'E2E-B' })) as OrderView
    assert.equal(done.fulfillmentStatus, 'fulfilled')
    assert.equal(done.fulfillments.length, 2)
    assert.ok(done.items.every((i) => i.fulfillableQuantity === 0))
    const topics = await topicsOf(order.id)
    assert.equal(topics.filter((t) => t === 'fulfillment.created').length, 2)
    assert.equal(topics.filter((t) => t === 'order.fulfilled').length, 1)
    // Nothing left to ship
    ok(await fulfill(order.id), 409)
  })

  test('no items given: everything that is left, as before', async () => {
    const order = await newOrder()
    const done = ok(await fulfill(order.id, { trackingNumber: 'E2E-ALL' })) as OrderView
    assert.equal(done.fulfillmentStatus, 'fulfilled')
    assert.equal(done.fulfillments.length, 1)
    const shipped = done.fulfillments[0]!.items.reduce((sum, i) => sum + i.quantity, 0)
    assert.equal(
      shipped,
      order.items.reduce((sum, i) => sum + i.quantity, 0),
    )
  })

  test('items that are not on the order, or more than is left, are refused', async () => {
    const order = await newOrder()
    const [a] = order.items
    ok(await fulfill(order.id, { items: [{ orderItemId: crypto.randomUUID(), quantity: 1 }] }), 400)
    ok(await fulfill(order.id, { items: [{ orderItemId: a!.id, quantity: a!.quantity + 1 }] }), 400)
    ok(await fulfill(order.id, { items: [{ orderItemId: a!.id, quantity: 0 }] }), 400)
    // The same line twice adds up: 2 + 2 is more than the 3 ordered
    ok(
      await fulfill(order.id, {
        items: [
          { orderItemId: a!.id, quantity: 2 },
          { orderItemId: a!.id, quantity: 2 },
        ],
      }),
      400,
    )
    assert.equal((await reload(order.id)).fulfillmentStatus, 'unfulfilled', 'a refused fulfillment changes nothing')
  })
})

describe('fulfillments: change and cancel', () => {
  test('cancelling a shipment puts its items back', async () => {
    const order = await newOrder()
    const [a] = order.items
    const part = ok(await fulfill(order.id, { items: [{ orderItemId: a!.id, quantity: 3 }] })) as OrderView
    const shipment = part.fulfillments[0]!
    const cancelled = ok(
      await call('POST', `/admin/orders/${order.id}/fulfillments/${shipment.id}/cancel`, {}, auth),
    ) as OrderView
    assert.equal(cancelled.fulfillmentStatus, 'unfulfilled')
    assert.equal(cancelled.items.find((i) => i.id === a!.id)!.fulfillableQuantity, 3)
    assert.equal(cancelled.fulfillments[0]!.status, 'cancelled')
    assert.ok((await topicsOf(order.id)).includes('fulfillment.updated'))
    // Already cancelled; and the items can ship again
    ok(await call('POST', `/admin/orders/${order.id}/fulfillments/${shipment.id}/cancel`, {}, auth), 409)
    const again = ok(await fulfill(order.id)) as OrderView
    assert.equal(again.fulfillmentStatus, 'fulfilled')
    // The cancelled shipment stays in the history
    assert.equal(again.fulfillments.length, 2)
  })

  test('tracking and shipment status can be updated; delivered is timestamped', async () => {
    const order = await newOrder()
    const shipment = (ok(await fulfill(order.id)) as OrderView).fulfillments[0]!
    const path = `/admin/orders/${order.id}/fulfillments/${shipment.id}`
    const updated = ok(
      await call(
        'PATCH',
        path,
        { trackingNumber: 'NEW-1', trackingCompany: 'UPS', shipmentStatus: 'in_transit' },
        auth,
      ),
    ) as OrderView & { fulfillments: { trackingNumber: string; shipmentStatus: string; deliveredAt: string | null }[] }
    assert.equal(updated.fulfillments[0]!.trackingNumber, 'NEW-1')
    assert.equal(updated.fulfillments[0]!.shipmentStatus, 'in_transit')
    assert.equal(updated.fulfillments[0]!.deliveredAt, null)

    const delivered = ok(await call('PATCH', path, { shipmentStatus: 'delivered' }, auth)) as typeof updated
    assert.ok(delivered.fulfillments[0]!.deliveredAt)
    assert.equal(delivered.fulfillments[0]!.trackingNumber, 'NEW-1', 'only the fields given change')
    ok(await call('PATCH', path, { shipmentStatus: 'teleported' }, auth), 400)

    // An empty tracking field clears it
    const cleared = ok(await call('PATCH', path, { trackingNumber: '' }, auth)) as typeof updated
    assert.equal(cleared.fulfillments[0]!.trackingNumber, null)

    ok(await call('POST', `${path}/cancel`, {}, auth))
    ok(await call('PATCH', path, { trackingNumber: 'LATE' }, auth), 409)
  })

  test('another order’s or an unknown fulfillment is not found', async () => {
    const [a, b] = [await newOrder(), await newOrder()]
    const shipment = (ok(await fulfill(a.id)) as OrderView).fulfillments[0]!
    ok(await call('PATCH', `/admin/orders/${b.id}/fulfillments/${shipment.id}`, { trackingNumber: 'X' }, auth), 404)
    ok(await call('POST', `/admin/orders/${a.id}/fulfillments/${crypto.randomUUID()}/cancel`, {}, auth), 404)
  })

  test('a partly shipped order can’t be cancelled; a cancelled one can’t ship', async () => {
    const order = await newOrder()
    ok(await fulfill(order.id, { items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] }))
    ok(await call('POST', `/admin/orders/${order.id}/cancel`, { reason: 'staff', restock: false }, auth), 409)

    const other = await newOrder()
    ok(await call('POST', `/admin/orders/${other.id}/cancel`, { reason: 'staff', restock: true }, auth))
    ok(await fulfill(other.id), 409)
  })

  test('tokens without write_orders can’t fulfill', async () => {
    const order = await newOrder()
    ok(await call('POST', `/admin/orders/${order.id}/fulfill`, {}, await fx.token(['read_orders'])), 403)
    const rows = await db
      .select()
      .from(schema.fulfillments)
      .where(and(eq(schema.fulfillments.orderId, order.id), inArray(schema.fulfillments.status, ['success'])))
    assert.equal(rows.length, 0)
  })
})
