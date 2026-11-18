import type { Conn } from '@shopnex/db'
// The admin order and dashboard routes, called through the real router with fake resolvers and an in-memory database: the scopes they need,
// input checks, how each order error is answered, and what they answer. (Cancelling and refunding are @shopnex/payments' routes.)
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'
import { hasScope } from '@shopnex/core/scopes'
import type { ApiScope } from '@shopnex/core/schema'
import * as fx from './fixtures'

const { SHOP, OTHER_SHOP, db } = fx
const { configureRpc } = await import('@shopnex/rpc')
const { ordersModule } = await import('../src/orders.module')
const { customFieldService } = await import('@shopnex/custom-fields')

const { orders, analytics } = ordersModule.router
const shop = { id: SHOP, storefrontUrl: null } as never
const MISSING = '00000000-0000-4000-8000-000000000000'

let who: 'staff' | 'nobody' | { token: ApiScope[] } = 'staff'

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
  configureRpc({
    session: () =>
      Promise.resolve(
        who === 'staff'
          ? ({ session: { activeOrganizationId: SHOP }, user: { id: 'u1', email: 's@example.test' } } as never)
          : null,
      ),
    adminShop: () => Promise.resolve({ shop, role: 'admin' as const, superAdmin: false }),
    token: () =>
      Promise.resolve(typeof who === 'object' ? ({ shop, token: { scopes: who.token, appId: null } } as never) : null),
    hasScope,
  })
})
beforeEach(async () => {
  who = 'staff'
  await fx.cleanup()
})
after(fx.cleanup)

const run = <T>(procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, {
    context: { headers: new Headers(typeof who === 'object' ? { authorization: 'Bearer sk_test' } : {}) },
  } as never) as Promise<T>
const refused = (code: string) => (e: unknown) => e instanceof ORPCError && e.code === code
const invalid = (e: unknown) =>
  e instanceof ORPCError && e.code === 'BAD_REQUEST' && e.message === 'Input validation failed'
const page = { limit: 50, offset: 0 }

type Order = {
  id: string
  orderNumber: number
  financialStatus: string
  fulfillmentStatus: string
  totalCents: number
  customFields: Record<string, unknown>
}

const importable = {
  sourceOrderName: '#7',
  email: 'old@example.test',
  financialStatus: 'paid',
  fulfillmentStatus: 'fulfilled',
  currency: 'EUR',
  subtotalCents: 1000,
  shippingCents: 0,
  taxCents: 0,
  discountCents: 0,
  totalCents: 1000,
  discountCodes: [],
  createdAt: '2024-01-02T03:04:05Z',
  items: [{ title: 'Thing', unitPriceCents: 1000, quantity: 1, discountCents: 0 }],
}

describe('who may call', () => {
  test('nobody signed in is UNAUTHORIZED; a token needs read_orders to read and write_orders to write; the dashboard needs read_orders', async () => {
    who = 'nobody'
    await assert.rejects(run(orders.list, page), refused('UNAUTHORIZED'))
    await assert.rejects(run(analytics.overview, {}), refused('UNAUTHORIZED'))
    who = { token: ['read_orders'] }
    assert.equal((await run<{ total: number }>(orders.list, page)).total, 0)
    assert.ok(await run(analytics.overview, {}))
    await assert.rejects(run(orders.deleteMany, { ids: [MISSING] }), refused('FORBIDDEN'))
    await assert.rejects(
      run(orders.create, { email: 'a@example.test', items: [{ productId: MISSING, quantity: 1 }] }),
      refused('FORBIDDEN'),
    )
    await assert.rejects(run(orders.markAsPaid, { id: MISSING }), refused('FORBIDDEN'))
    await assert.rejects(run(orders.fulfill, { id: MISSING }), refused('FORBIDDEN'))
    who = { token: ['read_products'] }
    await assert.rejects(run(orders.list, page), refused('FORBIDDEN'))
    await assert.rejects(run(analytics.overview, {}), refused('FORBIDDEN'))
  })
})

describe('the routes', () => {
  test('create makes an order from the catalog, get shows it whole, list finds it, and its number follows the shop’s', async () => {
    const p = await fx.product({ priceCents: 1500 })
    const created = await run<Order & { items: unknown[]; shippingLines: unknown[] }>(orders.create, {
      email: 'a@example.test',
      items: [{ variantId: p.variants[0]!.id, quantity: 2 }],
    })
    assert.deepEqual(
      [created.orderNumber, created.totalCents, created.items.length, created.financialStatus],
      [1001, 3000, 1, 'pending'],
    )
    const got = await run<Order & { customer: { email: string } | null; transactions: unknown[] }>(orders.get, {
      id: created.id,
    })
    assert.deepEqual([got.customer?.email, got.transactions], ['a@example.test', []])
    const listed = await run<{ items: Order[]; total: number }>(orders.list, { ...page, search: '#1001' })
    assert.deepEqual([listed.items.map((o) => o.id), listed.total], [[created.id], 1])
  })

  test('mark as paid and fulfill change the order and answer it', async () => {
    const o = await fx.place()
    assert.equal((await run<Order>(orders.markAsPaid, { id: o.id })).financialStatus, 'paid')
    const shipped = await run<Order>(orders.fulfill, {
      id: o.id,
      trackingNumber: 'T1',
      trackingUrl: 'https://track.example/T1',
    })
    assert.equal(shipped.fulfillmentStatus, 'fulfilled')
    await assert.rejects(run(orders.fulfill, { id: o.id, trackingUrl: 'javascript:alert(1)' }), invalid)
    await assert.rejects(run(orders.fulfill, { id: o.id, trackingNumber: 'x'.repeat(101) }), invalid)
  })

  test('update changes only the custom fields', async () => {
    await customFieldService.create(
      SHOP,
      { resource: 'order', key: 'gift', label: 'Gift', type: 'boolean' },
      (await import('@shopnex/db')).db,
    )
    const o = await fx.place()
    const u = await run<Order>(orders.update, { id: o.id, customFields: { gift: true } })
    assert.deepEqual([u.customFields, u.totalCents], [{ gift: true }, o.totalCents])
  })

  test('deleteMany answers how many it removed', async () => {
    const [a, b] = [await fx.place(), await fx.place()]
    assert.equal(await run(orders.deleteMany, { ids: [a.id, b.id, MISSING] }), 2)
  })

  test('import adds the history once and says what it skipped', async () => {
    const first = await run<{ imported: Order[]; skipped: string[] }>(orders.importHistorical, { orders: [importable] })
    assert.deepEqual([first.imported.length, first.skipped], [1, []])
    const again = await run<{ imported: Order[]; skipped: string[] }>(orders.importHistorical, { orders: [importable] })
    assert.deepEqual([again.imported.length, again.skipped], [0, ['#7']])
  })
})

describe('what is refused', () => {
  test('each order error is answered with its status: not found, conflict and bad request', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 1 }] })
    await assert.rejects(run(orders.get, { id: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(run(orders.markAsPaid, { id: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(run(orders.update, { id: MISSING, customFields: {} }), refused('NOT_FOUND'))
    const o = await fx.place()
    await run(orders.markAsPaid, { id: o.id })
    await assert.rejects(run(orders.markAsPaid, { id: o.id }), refused('CONFLICT'))
    await assert.rejects(
      run(orders.create, { email: 'a@example.test', items: [{ variantId: p.variants[0]!.id, quantity: 2 }] }),
      refused('BAD_REQUEST'),
    )
    await assert.rejects(
      run(orders.create, { email: 'a@example.test', items: [{ variantId: MISSING, quantity: 1 }] }),
      refused('BAD_REQUEST'),
    )
  })

  test('another shop’s order is never found', async () => {
    const p = await fx.product({}, OTHER_SHOP)
    const theirs = await (
      await import('../src')
    ).orderService.create(
      OTHER_SHOP,
      {
        email: 'x@example.test',
        items: [{ variantId: p.variants[0]!.id, quantity: 1 }],
      },
      db,
    )
    await assert.rejects(run(orders.get, { id: theirs.id }), refused('NOT_FOUND'))
    await assert.rejects(run(orders.fulfill, { id: theirs.id }), refused('NOT_FOUND'))
  })

  test('input is checked: a customer or an email is needed, lines are 1–999, ids are ids, filters are known statuses', async () => {
    const p = await fx.product()
    const line = { variantId: p.variants[0]!.id, quantity: 1 }
    for (const bad of [
      { items: [line] },
      { email: 'a@example.test', items: [] },
      { email: 'a@example.test', items: [{ ...line, quantity: 0 }] },
      { email: 'a@example.test', items: [{ ...line, quantity: 1000 }] },
      { email: 'a@example.test', items: [{ nothing: true }] },
      { email: 'nobody', items: [line] },
      { email: 'a@example.test', items: [line], discountCode: '' },
    ])
      await assert.rejects(run(orders.create, bad), invalid, JSON.stringify(bad))
    await assert.rejects(run(orders.list, { ...page, financialStatus: 'nearly-paid' }), invalid)
    await assert.rejects(run(orders.get, { id: 'nope' }), invalid)
    await assert.rejects(run(orders.deleteMany, { ids: [] }), invalid)
    await assert.rejects(run(orders.importHistorical, { orders: [] }), invalid)
    await assert.rejects(
      run(orders.importHistorical, {
        orders: Array.from({ length: 51 }, (_, i) => ({ ...importable, sourceOrderName: String(i) })),
      }),
      invalid,
    )
  })

  test('list takes cancelled as a flag or the text true/false', async () => {
    const o = await fx.place()
    await (await import('../src')).orderService.cancel(SHOP, o.id, { reason: 'other', restock: false }, db)
    for (const flag of [true, 'true'])
      assert.equal((await run<{ total: number }>(orders.list, { ...page, cancelled: flag })).total, 1)
    for (const flag of [false, 'false'])
      assert.equal((await run<{ total: number }>(orders.list, { ...page, cancelled: flag })).total, 0)
  })
})

describe('the dashboard route', () => {
  test('answers the overview, 30 days in UTC unless told otherwise', async () => {
    const o = await run<{ series: unknown[]; current: { orders: number } }>(analytics.overview, {})
    assert.deepEqual([o.series.length, o.current.orders], [30, 0])
    assert.equal(
      (await run<{ series: unknown[] }>(analytics.overview, { days: 7, timezone: 'Asia/Tokyo' })).series.length,
      7,
    )
  })

  test('the period is 1–365 whole days and the timezone must exist', async () => {
    for (const bad of [{ days: 0 }, { days: 366 }, { days: 1.5 }, { timezone: 'Mars/Olympus' }])
      await assert.rejects(run(analytics.overview, bad), invalid, JSON.stringify(bad))
  })
})
