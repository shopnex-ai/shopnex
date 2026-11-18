import type { Conn } from '@shopnex/db'
// Reading orders: the list with its filters and search, one order with everything it holds, deleting, and importing a shop's history from
// elsewhere (once, without touching stock, payments or emails).
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { orderItems, orders, orderTransactions } from '../src/orders.schema'
import { productVariants } from '@shopnex/catalog/schema'

const { db, eq, orderService, customerService, SHOP, OTHER_SHOP } = fx

const MISSING = '00000000-0000-4000-8000-000000000000'
const page = { limit: 50, offset: 0 }
const numbers = (r: { items: { orderNumber: number }[] }) => r.items.map((o) => o.orderNumber)

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('the list', () => {
  test('is the shop’s own, newest first, with the total, paged, and each order with its customer’s name', async () => {
    const ada = await fx.customer({ name: 'Ada' })
    const [a, b, c] = [await fx.place({ customerId: ada.id }), await fx.place(), await fx.place()]
    await db
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 3000) })
      .where(eq(orders.id, a.id))
    await db
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 2000) })
      .where(eq(orders.id, b.id))
    await db
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, c.id))
    const p = await fx.product({}, OTHER_SHOP)
    await orderService.create(
      OTHER_SHOP,
      {
        email: 'x@example.test',
        items: [{ variantId: p.variants[0]!.id, quantity: 1 }],
      },
      db,
    )
    const all = await orderService.list(SHOP, page, db)
    assert.deepEqual([numbers(all), all.total], [[c.orderNumber, b.orderNumber, a.orderNumber], 3])
    assert.equal(all.items[2]?.customerName, 'Ada')
    const second = await orderService.list(SHOP, { limit: 1, offset: 1 }, db)
    assert.deepEqual([numbers(second), second.total], [[b.orderNumber], 3])
  })

  test('filters by customer, payment status, fulfillment status and whether it is cancelled', async () => {
    const ada = await fx.customer()
    const paid = await fx.place({ customerId: ada.id })
    await orderService.markAsPaid(SHOP, paid.id, db)
    const shipped = await fx.place()
    await orderService.fulfill(SHOP, shipped.id, db)
    const cancelled = await fx.place()
    await orderService.cancel(SHOP, cancelled.id, { reason: 'other', restock: false }, db)
    const nums = async (opts: Parameters<typeof orderService.list>[1]) =>
      numbers(await orderService.list(SHOP, opts, db)).sort()
    assert.deepEqual(await nums({ ...page, customerId: ada.id }), [paid.orderNumber])
    assert.deepEqual(await nums({ ...page, financialStatus: 'paid' }), [paid.orderNumber])
    assert.deepEqual(await nums({ ...page, financialStatus: 'voided' }), [cancelled.orderNumber])
    assert.deepEqual(await nums({ ...page, fulfillmentStatus: 'fulfilled' }), [shipped.orderNumber])
    assert.deepEqual(await nums({ ...page, cancelled: true }), [cancelled.orderNumber])
    assert.deepEqual(await nums({ ...page, cancelled: false }), [paid.orderNumber, shipped.orderNumber].sort())
  })

  test('search matches the order number with or without #, the email or the customer’s name, as plain text', async () => {
    const ada = await fx.customer({ name: 'Ada Lovelace', email: 'ada@example.test' })
    const a = await fx.place({ customerId: ada.id })
    const b = await fx.place({ email: '100%_sure@example.test' })
    const found = async (search: string) => numbers(await orderService.list(SHOP, { ...page, search }, db)).sort()
    assert.deepEqual(await found(`#${String(a.orderNumber)}`), [a.orderNumber])
    assert.deepEqual(await found(String(b.orderNumber)), [b.orderNumber])
    assert.deepEqual(await found('ADA@'), [a.orderNumber])
    assert.deepEqual(await found('lovelace'), [a.orderNumber])
    assert.deepEqual(await found('%_s'), [b.orderNumber])
    assert.deepEqual(await found('%'), [b.orderNumber])
    assert.deepEqual(await found('9999999'), [])
    assert.equal((await orderService.list(SHOP, { ...page, search: 'lovelace' }, db)).total, 1)
  })
})

describe('one order', () => {
  test('with its lines, shipping, transactions, fulfillments and customer', async () => {
    const ada = await fx.customer({ name: 'Ada' })
    const o = await fx.place({
      customerId: ada.id,
      shipping: { title: 'Standard', code: null, priceCents: 500, freeAboveCents: null },
    })
    await orderService.markAsPaid(SHOP, o.id, db)
    await orderService.fulfill(SHOP, o.id, db, { trackingNumber: 'T1' })
    const got = await orderService.getById(SHOP, o.id, db)
    assert.deepEqual(
      [
        got?.items.length,
        got?.shippingLines.length,
        got?.transactions.map((t) => t.kind),
        got?.fulfillments.map((f) => f.trackingNumber),
        got?.customer?.name,
      ],
      [1, 1, ['sale'], ['T1'], 'Ada'],
    )
  })

  test('null for an unknown order or another shop’s', async () => {
    const o = await fx.place()
    assert.equal(await orderService.getById(SHOP, MISSING, db), null)
    assert.equal(await orderService.getById('another-shop', o.id, db), null)
  })

  test('removeMany deletes the shop’s own with their lines and says how many; nothing to delete is 0', async () => {
    const [a, b] = [await fx.place(), await fx.place()]
    const p = await fx.product({}, OTHER_SHOP)
    const theirs = await orderService.create(
      OTHER_SHOP,
      {
        email: 'x@example.test',
        items: [{ variantId: p.variants[0]!.id, quantity: 1 }],
      },
      db,
    )
    assert.equal(await orderService.removeMany(SHOP, [a.id, theirs.id, MISSING], db), 1)
    assert.equal(await orderService.removeMany(SHOP, [], db), 0)
    assert.equal((await db.select().from(orderItems).where(eq(orderItems.orderId, a.id))).length, 0)
    assert.ok(await orderService.getById(SHOP, b.id, db))
    assert.ok(await orderService.getById(OTHER_SHOP, theirs.id, db))
  })
})

describe('importing history', () => {
  const input = (patch: Partial<Parameters<typeof orderService.importHistoricalMany>[1][number]> = {}) => ({
    sourceOrderName: '#1042',
    email: 'Old@Customer.test',
    name: 'Old Customer',
    phone: null,
    financialStatus: 'paid' as const,
    fulfillmentStatus: 'fulfilled' as const,
    currency: 'EUR',
    subtotalCents: 3000,
    shippingCents: 500,
    taxCents: 0,
    discountCents: 0,
    totalCents: 3500,
    discountCodes: ['OLD10'],
    shippingTitle: 'Post',
    shippingAddress: fx.address,
    note: 'Fragile',
    createdAt: new Date('2024-03-01T10:00:00Z'),
    items: [{ title: 'Old thing', sku: 'OLD-1', unitPriceCents: 1500, quantity: 2, discountCents: 0 }],
    ...patch,
  })

  test('adds the order as it was: its status, money, date and lines, marked as imported, with a customer found or made by email', async () => {
    const { imported, skipped } = await orderService.importHistoricalMany(SHOP, [input()], db)
    assert.deepEqual([imported.length, skipped], [1, []])
    const o = (await orderService.getById(SHOP, imported[0]!.id, db))!
    assert.deepEqual(
      [
        o.paymentGateway,
        o.financialStatus,
        o.fulfillmentStatus,
        o.currency,
        o.totalCents,
        o.discountCodes,
        o.createdAt.toISOString(),
        o.customer?.email,
        o.customer?.name,
      ],
      [
        'imported',
        'paid',
        'fulfilled',
        'EUR',
        3500,
        ['OLD10'],
        '2024-03-01T10:00:00.000Z',
        'old@customer.test',
        'Old Customer',
      ],
    )
    assert.equal(o.note, '[Imported order #1042]\nFragile')
    assert.deepEqual(
      o.items.map((i) => [i.title, i.quantity, i.productId, i.variantId]),
      [['Old thing', 2, null, null]],
    )
    assert.deepEqual(
      o.shippingLines.map((s) => [s.title, s.priceCents]),
      [['Post', 500]],
    )
    assert.equal(o.fulfillments.length, 1)
    assert.equal(o.fulfillments[0]?.createdAt.toISOString(), '2024-03-01T10:00:00.000Z')
    assert.equal(o.billingAddress?.city, 'Paris', 'the billing address falls back to the shipping address')
  })

  test('takes the next order numbers, with no stock taken, no payment recorded and no email or webhook sent', async () => {
    const sent = await fx.hook(['order.created'])
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 5 }] })
    const first = await fx.place()
    const { imported } = await orderService.importHistoricalMany(
      SHOP,
      [input({ sourceOrderName: 'A' }), input({ sourceOrderName: 'B', email: 'b@customer.test' })],
      db,
    )
    assert.deepEqual(
      imported.map((o) => o.orderNumber),
      [first.orderNumber + 1, first.orderNumber + 2],
    )
    assert.equal(
      (await db.select().from(orderTransactions).where(eq(orderTransactions.orderId, imported[0]!.id))).length,
      0,
    )
    assert.equal((await sent()).length, 1, 'only the real order was announced')
    assert.equal(
      (await db.select().from(productVariants).where(eq(productVariants.id, p.variants[0]!.id)))[0]?.inventoryQuantity,
      5,
    )
  })

  test('an order already imported is skipped, by name, so uploading a file twice adds nothing', async () => {
    await orderService.importHistoricalMany(SHOP, [input()], db)
    const again = await orderService.importHistoricalMany(SHOP, [input(), input({ sourceOrderName: '#1043' })], db)
    assert.deepEqual([again.imported.length, again.skipped], [1, ['#1042']])
    assert.equal((await orderService.list(SHOP, page, db)).total, 2)
  })

  test('a name that only starts the same is not the same order', async () => {
    await orderService.importHistoricalMany(SHOP, [input({ sourceOrderName: '#10' })], db)
    assert.equal(
      (await orderService.importHistoricalMany(SHOP, [input({ sourceOrderName: '#100' })], db)).imported.length,
      1,
    )
  })

  test('an unshipped, cancelled order has no fulfillment, and no shipping line when there was no shipping charge', async () => {
    const { imported } = await orderService.importHistoricalMany(
      SHOP,
      [
        input({
          fulfillmentStatus: 'unfulfilled',
          cancelledAt: new Date('2024-03-02T00:00:00Z'),
          shippingCents: 0,
          totalCents: 3000,
        }),
      ],
      db,
    )
    const o = (await orderService.getById(SHOP, imported[0]!.id, db))!
    assert.deepEqual(
      [o.fulfillments.length, o.shippingLines.length, o.cancelledAt?.toISOString()],
      [0, 0, '2024-03-02T00:00:00.000Z'],
    )
  })

  test('is all or nothing: a bad order undoes the ones before it', async () => {
    await assert.rejects(
      orderService.importHistoricalMany(
        SHOP,
        [
          input({ sourceOrderName: 'good' }),
          input({
            sourceOrderName: 'bad',
            items: [
              {
                title: 'x',
                unitPriceCents: 1,
                quantity: 1,
                discountCents: 0,
                sku: null,
                vendor: null,
                imageUrl: null,
                variantTitle: null,
              },
              null as never,
            ],
          }),
        ],
        db,
      ),
    )
    assert.equal((await orderService.list(SHOP, page, db)).total, 0)
    assert.equal((await customerService.list(SHOP, { limit: 10, offset: 0 }, db)).total, 0)
  })
})
