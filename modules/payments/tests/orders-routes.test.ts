// The two order routes that live in payments because they send money back through a payments app: cancel and refund, called through the real
// router. The scope they need, input checks, how each order error is answered, and that a manual order is refunded at once.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'
import { hasScope } from '@shopnex/core/scopes'
import type { ApiScope } from '@shopnex/core/schema'

const fx = await import('./fixtures')
const { db, SHOP } = fx
const { orderTransactions } = await import('@shopnex/orders/schema')
const { configureRpc } = await import('@shopnex/rpc')
const { paymentsModule } = await import('../src/payments.module')
const { eq } = await import('drizzle-orm')

const { orders } = paymentsModule.router
const shop = { id: SHOP, storefrontUrl: null } as never
const MISSING = '00000000-0000-4000-8000-000000000000'

let who: 'staff' | 'nobody' | { token: ApiScope[] } = 'staff'

before(async () => {
  await fx.prepareDatabase()
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
const paidOrder = async () => {
  const o = await fx.order({ financialStatus: 'paid' })
  await db
    .insert(orderTransactions)
    .values({ orderId: o.id, kind: 'sale', status: 'success', gateway: 'manual', amountCents: 2500, currency: 'USD' })
  return o
}

type Order = { id: string; financialStatus: string; cancelledAt: Date | null; cancelReason: string | null }

describe('who may call', () => {
  test('write_orders, which read_orders is not; nobody signed in is UNAUTHORIZED', async () => {
    const o = await fx.order()
    who = 'nobody'
    await assert.rejects(run(orders.cancel, { id: o.id, reason: 'other', restock: false }), refused('UNAUTHORIZED'))
    who = { token: ['read_orders'] }
    await assert.rejects(run(orders.cancel, { id: o.id, reason: 'other', restock: false }), refused('FORBIDDEN'))
    await assert.rejects(run(orders.refund, { id: o.id, amountCents: 100 }), refused('FORBIDDEN'))
    who = { token: ['write_orders'] }
    assert.equal(
      (await run<Order>(orders.cancel, { id: o.id, reason: 'other', restock: false })).financialStatus,
      'voided',
    )
  })
})

describe('cancel', () => {
  test('cancels the order with its reason; a paid manual order is refunded at once', async () => {
    const o = await paidOrder()
    const c = await run<Order>(orders.cancel, { id: o.id, reason: 'fraud', restock: true })
    assert.deepEqual([c.financialStatus, c.cancelReason, c.cancelledAt instanceof Date], ['refunded', 'fraud', true])
  })

  test('the reason is one of the known ones and restock is required', async () => {
    const o = await fx.order()
    await assert.rejects(run(orders.cancel, { id: o.id, reason: 'because', restock: false }), invalid)
    await assert.rejects(run(orders.cancel, { id: o.id, reason: 'other' }), invalid)
    await assert.rejects(run(orders.cancel, { id: 'nope', reason: 'other', restock: false }), invalid)
  })

  test('an unknown order is NOT_FOUND and one already cancelled is CONFLICT', async () => {
    await assert.rejects(run(orders.cancel, { id: MISSING, reason: 'other', restock: false }), refused('NOT_FOUND'))
    const o = await fx.order()
    await run(orders.cancel, { id: o.id, reason: 'other', restock: false })
    await assert.rejects(run(orders.cancel, { id: o.id, reason: 'other', restock: false }), refused('CONFLICT'))
  })
})

describe('refund', () => {
  test('gives back part of a paid manual order at once and leaves it open', async () => {
    const o = await paidOrder()
    const r = await run<Order>(orders.refund, { id: o.id, amountCents: 1000 })
    assert.deepEqual([r.financialStatus, r.cancelledAt], ['partially_refunded', null])
    const refunds = (await db.select().from(orderTransactions).where(eq(orderTransactions.orderId, o.id))).filter(
      (t) => t.kind === 'refund',
    )
    assert.deepEqual(
      refunds.map((t) => [t.status, t.amountCents]),
      [['success', 1000]],
    )
  })

  test('the amount is whole cents above zero, and not more than is left: BAD_REQUEST', async () => {
    const o = await paidOrder()
    for (const amountCents of [0, -1, 1.5, 'ten'])
      await assert.rejects(run(orders.refund, { id: o.id, amountCents }), invalid, String(amountCents))
    await assert.rejects(run(orders.refund, { id: o.id, amountCents: 2501 }), refused('BAD_REQUEST'))
    await assert.rejects(run(orders.refund, { id: MISSING, amountCents: 100 }), refused('NOT_FOUND'))
  })
})
