import type { Conn } from '@shopnex/db'
// After an order is placed: marking it paid, shipping it, cancelling it (with or without the stock back, with the money back) and refunding
// part of it. Each step is one change that stands or falls whole, tells webhooks, and refuses what does not make sense.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { fulfillments, orders, orderTransactions } from '../src/orders.schema'
import { productVariants } from '@shopnex/catalog/schema'

const { db, eq, orderService, SHOP } = fx
const { OrderError } = await import('../src')
const { customFieldService } = await import('@shopnex/custom-fields')

const refused = (code: string) => (e: unknown) => e instanceof OrderError && e.code === code
const MISSING = '00000000-0000-4000-8000-000000000000'
const row = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!
const transactions = (id: string) => db.select().from(orderTransactions).where(eq(orderTransactions.orderId, id))
const stockOf = async (variantId: string) =>
  (await db.select().from(productVariants).where(eq(productVariants.id, variantId)))[0]!.inventoryQuantity
const asPaid = (id: string) => db.update(orders).set({ financialStatus: 'paid' }).where(eq(orders.id, id))
const sale = (orderId: string, amountCents: number, gateway = 'manual') =>
  db
    .insert(orderTransactions)
    .values({ orderId, kind: 'sale', status: 'success', gateway, amountCents, currency: 'USD' })

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('marking an order paid', () => {
  test('records a successful sale for the whole amount in the order’s gateway and currency, and the order is paid', async () => {
    const o = await fx.place({ payment: { gateway: 'bank', name: 'Bank', instructions: null } })
    const paid = await orderService.markAsPaid(SHOP, o.id, db)
    assert.equal(paid.financialStatus, 'paid')
    const [t] = await transactions(o.id)
    assert.deepEqual(
      [t?.kind, t?.status, t?.gateway, t?.amountCents, t?.currency],
      ['sale', 'success', 'bank', 2500, 'USD'],
    )
  })

  test('a partly paid order records only what is outstanding', async () => {
    const o = await fx.place()
    await sale(o.id, 1000)
    await db.update(orders).set({ financialStatus: 'partially_paid' }).where(eq(orders.id, o.id))
    await orderService.markAsPaid(SHOP, o.id, db)
    assert.deepEqual(
      (await transactions(o.id)).map((t) => t.amountCents).sort((a, b) => a - b),
      [1000, 1500],
    )
  })

  test('an order that is paid, cancelled or not found is refused, and records nothing', async () => {
    const o = await fx.place()
    await orderService.markAsPaid(SHOP, o.id, db)
    await assert.rejects(orderService.markAsPaid(SHOP, o.id, db), refused('INVALID_STATUS_TRANSITION'))
    const c = await fx.place()
    await orderService.cancel(SHOP, c.id, { reason: 'customer', restock: false }, db)
    await assert.rejects(orderService.markAsPaid(SHOP, c.id, db), refused('ORDER_CANCELLED'))
    await assert.rejects(orderService.markAsPaid(SHOP, MISSING, db), refused('ORDER_NOT_FOUND'))
    assert.equal((await transactions(o.id)).length, 1)
    assert.equal((await transactions(c.id)).length, 0)
  })

  test('another shop’s order is not found', async () => {
    const o = await fx.place()
    await assert.rejects(orderService.markAsPaid('another-shop', o.id, db), refused('ORDER_NOT_FOUND'))
  })

  test('tells webhooks order.paid', async () => {
    const o = await fx.place()
    const sent = await fx.hook(['order.paid'])
    await orderService.markAsPaid(SHOP, o.id, db)
    assert.deepEqual(
      (await sent()).map((d) => [d.topic, d.data.id, d.data.financialStatus]),
      [['order.paid', o.id, 'paid']],
    )
  })

  test('two clicks at once record one sale', async () => {
    const o = await fx.place()
    const results = await Promise.allSettled([
      orderService.markAsPaid(SHOP, o.id, db),
      orderService.markAsPaid(SHOP, o.id, db),
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
    assert.equal((await transactions(o.id)).length, 1)
  })
})

describe('shipping an order', () => {
  test('records the fulfillment with its tracking and marks the order fulfilled, paid or not', async () => {
    const o = await fx.place()
    const shipped = await orderService.fulfill(SHOP, o.id, db, {
      trackingCompany: 'UPS',
      trackingNumber: '1Z999',
      trackingUrl: 'https://ups.example/1Z999',
    })
    assert.deepEqual([shipped.fulfillmentStatus, shipped.financialStatus], ['fulfilled', 'pending'])
    const [f] = await db.select().from(fulfillments).where(eq(fulfillments.orderId, o.id))
    assert.deepEqual(
      [f?.status, f?.trackingCompany, f?.trackingNumber, f?.trackingUrl],
      ['success', 'UPS', '1Z999', 'https://ups.example/1Z999'],
    )
  })

  test('blank tracking is none', async () => {
    const o = await fx.place()
    await orderService.fulfill(SHOP, o.id, db, { trackingCompany: '', trackingNumber: '' })
    const [f] = await db.select().from(fulfillments).where(eq(fulfillments.orderId, o.id))
    assert.deepEqual([f?.trackingCompany, f?.trackingNumber, f?.trackingUrl], [null, null, null])
  })

  test('twice, a cancelled order or an unknown one is refused', async () => {
    const o = await fx.place()
    await orderService.fulfill(SHOP, o.id, db)
    await assert.rejects(orderService.fulfill(SHOP, o.id, db), refused('INVALID_STATUS_TRANSITION'))
    const c = await fx.place()
    await orderService.cancel(SHOP, c.id, { reason: 'other', restock: false }, db)
    await assert.rejects(orderService.fulfill(SHOP, c.id, db), refused('ORDER_CANCELLED'))
    await assert.rejects(orderService.fulfill(SHOP, MISSING, db), refused('ORDER_NOT_FOUND'))
    assert.equal((await db.select().from(fulfillments).where(eq(fulfillments.orderId, o.id))).length, 1)
  })

  test('tells webhooks order.fulfilled', async () => {
    const o = await fx.place()
    const sent = await fx.hook(['order.fulfilled'])
    await orderService.fulfill(SHOP, o.id, db)
    assert.deepEqual(
      (await sent()).map((d) => [d.topic, d.data.id]),
      [['order.fulfilled', o.id]],
    )
  })
})

describe('cancelling an order', () => {
  test('an unpaid order is voided, with the reason and the time', async () => {
    const o = await fx.place()
    const c = await orderService.cancel(SHOP, o.id, { reason: 'customer', restock: false }, db)
    assert.deepEqual([c.financialStatus, c.cancelReason, c.cancelledAt instanceof Date], ['voided', 'customer', true])
    assert.equal((await transactions(o.id)).length, 0)
  })

  test('a paid manual order is refunded in full at once, and records the refund', async () => {
    const o = await fx.place()
    await orderService.markAsPaid(SHOP, o.id, db)
    const c = await orderService.cancel(SHOP, o.id, { reason: 'declined', restock: false }, db)
    assert.equal(c.financialStatus, 'refunded')
    const refund = (await transactions(o.id)).find((t) => t.kind === 'refund')
    assert.deepEqual([refund?.status, refund?.amountCents], ['success', 2500])
  })

  test('a paid order from a payments app books a pending refund and stays paid until the app confirms', async () => {
    const o = await fx.place({ payment: { gateway: 'stripe', name: 'Card', instructions: null } })
    await asPaid(o.id)
    await sale(o.id, 2500, 'stripe')
    const c = await orderService.cancel(SHOP, o.id, { reason: 'customer', restock: false }, db)
    assert.equal(c.financialStatus, 'paid')
    const refund = (await transactions(o.id)).find((t) => t.kind === 'refund')
    assert.deepEqual([refund?.status, refund?.amountCents, refund?.gateway], ['pending', 2500, 'stripe'])
  })

  test('only what is still with the shop goes back: an earlier partial refund is not repeated', async () => {
    const o = await fx.place()
    await orderService.markAsPaid(SHOP, o.id, db)
    await orderService.refund(SHOP, o.id, { amountCents: 1000 }, db)
    await orderService.cancel(SHOP, o.id, { reason: 'customer', restock: false }, db)
    const refunds = (await transactions(o.id))
      .filter((t) => t.kind === 'refund')
      .map((t) => t.amountCents)
      .sort((a, b) => a - b)
    assert.deepEqual(refunds, [1000, 1500])
    assert.equal((await row(o.id)).financialStatus, 'refunded')
  })

  test('with restock the stock comes back, per line; without it stays taken; untracked variants stay untracked', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 10 }] })
    const free = await fx.product()
    const keep = await orderService.create(
      SHOP,
      {
        email: 'a@example.test',
        items: [
          { productId: p.id, quantity: 4 },
          { productId: free.id, quantity: 2 },
        ],
      },
      db,
    )
    assert.equal(await stockOf(p.variants[0]!.id), 6)
    await orderService.cancel(SHOP, keep.id, { reason: 'other', restock: false }, db)
    assert.equal(await stockOf(p.variants[0]!.id), 6)
    const back = await orderService.create(
      SHOP,
      {
        email: 'a@example.test',
        items: [
          { productId: p.id, quantity: 3 },
          { productId: free.id, quantity: 2 },
        ],
      },
      db,
    )
    await orderService.cancel(SHOP, back.id, { reason: 'other', restock: true }, db)
    assert.deepEqual([await stockOf(p.variants[0]!.id), await stockOf(free.variants[0]!.id)], [6, null])
  })

  test('a fulfilled order, one already cancelled and an unknown one are refused, and nothing changes', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 5 }] })
    const shipped = await orderService.create(
      SHOP,
      {
        email: 'a@example.test',
        items: [{ productId: p.id, quantity: 1 }],
      },
      db,
    )
    await orderService.fulfill(SHOP, shipped.id, db)
    await assert.rejects(
      orderService.cancel(SHOP, shipped.id, { reason: 'other', restock: true }, db),
      refused('INVALID_STATUS_TRANSITION'),
    )
    assert.equal(await stockOf(p.variants[0]!.id), 4)
    const o = await fx.place()
    await orderService.cancel(SHOP, o.id, { reason: 'other', restock: false }, db)
    await assert.rejects(
      orderService.cancel(SHOP, o.id, { reason: 'other', restock: false }, db),
      refused('ORDER_CANCELLED'),
    )
    await assert.rejects(
      orderService.cancel(SHOP, MISSING, { reason: 'other', restock: false }, db),
      refused('ORDER_NOT_FOUND'),
    )
  })

  test('onlyIfUnpaid gives up on an order that was paid meanwhile, instead of refunding it', async () => {
    const o = await fx.place()
    await orderService.markAsPaid(SHOP, o.id, db)
    await assert.rejects(
      orderService.cancel(SHOP, o.id, { reason: 'other', restock: true, onlyIfUnpaid: true }, db),
      refused('INVALID_STATUS_TRANSITION'),
    )
    assert.equal((await row(o.id)).cancelledAt, null)
    const unpaid = await fx.place()
    assert.equal(
      (await orderService.cancel(SHOP, unpaid.id, { reason: 'other', restock: false, onlyIfUnpaid: true }, db))
        .financialStatus,
      'voided',
    )
  })

  test('tells webhooks order.cancelled', async () => {
    const o = await fx.place()
    const sent = await fx.hook(['order.cancelled'])
    await orderService.cancel(SHOP, o.id, { reason: 'fraud', restock: false }, db)
    const [d] = await sent()
    assert.deepEqual([d?.topic, d?.data.id, d?.data.cancelReason], ['order.cancelled', o.id, 'fraud'])
  })
})

describe('refunding part of an order', () => {
  test('a manual order records the refund at once and becomes partially refunded, then refunded when all is back', async () => {
    const o = await fx.place()
    await orderService.markAsPaid(SHOP, o.id, db)
    assert.equal(
      (await orderService.refund(SHOP, o.id, { amountCents: 1000 }, db)).financialStatus,
      'partially_refunded',
    )
    assert.equal((await orderService.refund(SHOP, o.id, { amountCents: 1500 }, db)).financialStatus, 'refunded')
    assert.deepEqual(
      (await transactions(o.id))
        .filter((t) => t.kind === 'refund')
        .map((t) => [t.status, t.amountCents])
        .sort(),
      [
        ['success', 1000],
        ['success', 1500],
      ],
    )
  })

  test('an order paid through an app books a pending refund and stays as it is', async () => {
    const o = await fx.place({ payment: { gateway: 'stripe', name: 'Card', instructions: null } })
    await asPaid(o.id)
    await sale(o.id, 2500, 'stripe')
    const unchanged = await orderService.refund(SHOP, o.id, { amountCents: 500 }, db)
    assert.equal(unchanged.financialStatus, 'paid')
    assert.deepEqual(
      (await transactions(o.id)).filter((t) => t.kind === 'refund').map((t) => [t.status, t.amountCents]),
      [['pending', 500]],
    )
    await assert.rejects(
      orderService.refund(SHOP, o.id, { amountCents: 2100 }, db),
      refused('INVALID_REFUND'),
      'a pending refund is already spoken for',
    )
  })

  test('the amount is whole cents above zero and at most what is left, saying how much that is', async () => {
    const o = await fx.place()
    await orderService.markAsPaid(SHOP, o.id, db)
    for (const amountCents of [0, -5, 1.5, Number.NaN])
      await assert.rejects(
        orderService.refund(SHOP, o.id, { amountCents }, db),
        refused('INVALID_REFUND'),
        String(amountCents),
      )
    await assert.rejects(
      orderService.refund(SHOP, o.id, { amountCents: 2501 }, db),
      (e: unknown) => e instanceof OrderError && e.code === 'INVALID_REFUND' && /At most \$25\.00/.test(e.message),
    )
    await orderService.refund(SHOP, o.id, { amountCents: 2500 }, db)
    await assert.rejects(
      orderService.refund(SHOP, o.id, { amountCents: 1 }, db),
      (e: unknown) => e instanceof OrderError && /Nothing is left/.test(e.message),
    )
  })

  test('an unpaid order has nothing to refund, and an unknown one is not found', async () => {
    const o = await fx.place()
    await assert.rejects(orderService.refund(SHOP, o.id, { amountCents: 100 }, db), refused('INVALID_REFUND'))
    await assert.rejects(orderService.refund(SHOP, MISSING, { amountCents: 100 }, db), refused('ORDER_NOT_FOUND'))
  })

  test('moneyOf counts what was taken (sales and captures), given back and on its way', async () => {
    const o = await fx.place()
    const kinds: [string, string, number][] = [
      ['sale', 'success', 1000],
      ['capture', 'success', 500],
      ['sale', 'failure', 999],
      ['refund', 'success', 300],
      ['refund', 'pending', 200],
      ['refund', 'failure', 77],
    ]
    for (const [kind, status, amountCents] of kinds)
      await db.insert(orderTransactions).values({
        orderId: o.id,
        kind: kind as never,
        status: status as never,
        gateway: 'manual',
        amountCents,
        currency: 'USD',
      })
    assert.deepEqual(await db.transaction((tx) => orderService.moneyOf(tx, o.id)), {
      taken: 1500,
      refunded: 300,
      refunding: 200,
      left: 1000,
    })
    const none = await fx.place()
    assert.deepEqual(await db.transaction((tx) => orderService.moneyOf(tx, none.id)), {
      taken: 0,
      refunded: 0,
      refunding: 0,
      left: 0,
    })
  })
})

describe('custom fields on an order', () => {
  test('values are set and cleared with the shop’s fields, and the order is shown with them; an unknown order is not found', async () => {
    await customFieldService.create(SHOP, { resource: 'order', key: 'gift', label: 'Gift', type: 'boolean' }, db)
    const o = await fx.place()
    const set = await orderService.setCustomFields(SHOP, o.id, { gift: true }, db)
    assert.deepEqual(set.customFields, { gift: true })
    assert.deepEqual((await orderService.setCustomFields(SHOP, o.id, { gift: null }, db)).customFields, {})
    await assert.rejects(orderService.setCustomFields(SHOP, o.id, { nope: 1 }, db))
    await assert.rejects(orderService.setCustomFields(SHOP, MISSING, {}, db), refused('ORDER_NOT_FOUND'))
  })

  test('tells webhooks order.updated', async () => {
    await customFieldService.create(SHOP, { resource: 'order', key: 'gift', label: 'Gift', type: 'boolean' }, db)
    const o = await fx.place()
    const sent = await fx.hook(['order.updated'])
    await orderService.setCustomFields(SHOP, o.id, { gift: true }, db)
    assert.deepEqual(
      (await sent()).map((d) => [d.topic, d.data.id]),
      [['order.updated', o.id]],
    )
  })
})
