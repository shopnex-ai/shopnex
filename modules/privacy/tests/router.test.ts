// The customer data routes, called through the real router with fake resolvers and an in-memory database: who may export (owners and admins, or
// a token that reads both customers and orders), who may erase (owners and admins only), and how each refusal is answered.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'
import { hasScope } from '@shopnex/core/scopes'
import type { ApiScope } from '@shopnex/core/schema'
import { channels } from '@shopnex/channels/schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { configureRpc } = await import('@shopnex/rpc')
const { privacyModule } = await import('../src/privacy.module')
const { customers: customersTable } = await import('@shopnex/customers/schema')
const { orders: ordersTable } = await import('@shopnex/orders/schema')
const { eq } = await import('drizzle-orm')

const { customers } = privacyModule.router
const SHOP = 'default'
const shop = { id: SHOP, storefrontUrl: null } as never
const MISSING = '00000000-0000-4000-8000-000000000000'

let who: 'owner' | 'member' | 'nobody' | { token: ApiScope[] } = 'owner'

before(async () => {
  await prepareDatabase()
  configureRpc({
    session: () =>
      Promise.resolve(
        who === 'owner' || who === 'member'
          ? ({ session: { activeOrganizationId: SHOP }, user: { id: 'u1', email: 's@example.test' } } as never)
          : null,
      ),
    adminShop: () => Promise.resolve({ shop, role: who === 'member' ? 'member' : 'owner', superAdmin: false } as never),
    token: () =>
      Promise.resolve(typeof who === 'object' ? ({ shop, token: { scopes: who.token, appId: null } } as never) : null),
    hasScope,
  })
})
beforeEach(async () => {
  who = 'owner'
  await cleanup()
})
after(async () => {
  await cleanup()
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})
async function cleanup() {
  await db.delete(ordersTable).where(eq(ordersTable.shopId, SHOP))
  await db.delete(customersTable).where(eq(customersTable.shopId, SHOP))
}

const run = <T>(procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, {
    context: { headers: new Headers(typeof who === 'object' ? { authorization: 'Bearer sk_test' } : {}) },
  } as never) as Promise<T>
const refused = (code: string) => (e: unknown) => e instanceof ORPCError && e.code === code
const customer = async () =>
  (await db.insert(customersTable).values({ shopId: SHOP, email: 'ada@example.test', name: 'Ada' }).returning())[0]!
async function order(customerId: string, patch: Partial<typeof ordersTable.$inferInsert> = {}) {
  const [channel] = await db.select().from(channels).where(eq(channels.shopId, SHOP))
  return (
    await db
      .insert(ordersTable)
      .values({
        shopId: SHOP,
        orderNumber: Math.floor(Math.random() * 1e8),
        channelId: channel!.id,
        customerId,
        email: 'ada@example.test',
        subtotalCents: 1,
        totalCents: 1,
        financialStatus: 'paid',
        fulfillmentStatus: 'fulfilled',
        ...patch,
      })
      .returning()
  )[0]!
}

describe('exporting a customer’s data', () => {
  test('owners and admins; nobody signed in is UNAUTHORIZED, a plain member is FORBIDDEN', async () => {
    const c = await customer()
    who = 'nobody'
    await assert.rejects(run(customers.exportData, { id: c.id }), refused('UNAUTHORIZED'))
    who = 'member'
    await assert.rejects(run(customers.exportData, { id: c.id }), refused('FORBIDDEN'))
    who = 'owner'
    assert.equal((await run<{ customer: { id: string } }>(customers.exportData, { id: c.id })).customer.id, c.id)
  })

  test('a token that can read both customers and orders may, and one that can read only one may not', async () => {
    const c = await customer()
    who = { token: ['read_customers', 'read_orders'] }
    assert.equal((await run<{ schemaVersion: number }>(customers.exportData, { id: c.id })).schemaVersion, 1)
    who = { token: ['read_customers'] }
    await assert.rejects(run(customers.exportData, { id: c.id }), refused('FORBIDDEN'))
    who = { token: ['read_orders'] }
    await assert.rejects(run(customers.exportData, { id: c.id }), refused('FORBIDDEN'))
    who = { token: ['write_customers', 'write_orders'] }
    assert.ok(await run(customers.exportData, { id: c.id }), 'write includes read')
  })

  test('answers everything held about them, and an unknown customer or a bad id', async () => {
    const c = await customer()
    await order(c.id)
    const data = await run<{ orders: unknown[]; carts: unknown[]; emails: unknown[]; loginAccount: unknown }>(
      customers.exportData,
      { id: c.id },
    )
    assert.deepEqual([data.orders.length, data.carts, data.emails, data.loginAccount], [1, [], [], null])
    await assert.rejects(run(customers.exportData, { id: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(
      run(customers.exportData, { id: 'nope' }),
      (e: unknown) => e instanceof ORPCError && e.code === 'BAD_REQUEST',
    )
  })
})

describe('erasing a customer', () => {
  test('owners and admins only: never an API token, whatever its scopes, and never a plain member', async () => {
    const c = await customer()
    who = 'member'
    await assert.rejects(run(customers.erase, { id: c.id }), refused('FORBIDDEN'))
    who = { token: ['write_customers', 'write_orders', 'read_customers', 'read_orders'] }
    await assert.rejects(run(customers.erase, { id: c.id }), (e: unknown) => e instanceof ORPCError)
    who = 'nobody'
    await assert.rejects(run(customers.erase, { id: c.id }), refused('UNAUTHORIZED'))
    assert.ok((await db.select().from(customersTable).where(eq(customersTable.id, c.id)))[0], 'still there')
  })

  test('answers what it did in counts, and the customer is gone', async () => {
    const c = await customer()
    await order(c.id)
    const result = await run<{
      ordersAnonymized: number
      cartsCleared: number
      emailsRedacted: number
      webhookDeliveriesDeleted: number
      loginAccountDeleted: boolean
    }>(customers.erase, { id: c.id })
    assert.deepEqual(result, {
      ordersAnonymized: 1,
      cartsCleared: 0,
      emailsRedacted: 0,
      webhookDeliveriesDeleted: 0,
      loginAccountDeleted: false,
    })
    assert.equal((await db.select().from(customersTable).where(eq(customersTable.id, c.id))).length, 0)
  })

  test('an unknown customer is NOT_FOUND; one with an order still open is CONFLICT, naming the orders, and nothing is erased', async () => {
    await assert.rejects(
      run(customers.erase, { id: MISSING }),
      (e: unknown) =>
        e instanceof ORPCError && e.code === 'NOT_FOUND' && (e.data as { code: string }).code === 'CUSTOMER_NOT_FOUND',
    )
    const c = await customer()
    const open = await order(c.id, { fulfillmentStatus: 'unfulfilled' })
    await assert.rejects(run(customers.erase, { id: c.id }), (e: unknown) => {
      assert.ok(e instanceof ORPCError)
      assert.equal(e.code, 'CONFLICT')
      assert.deepEqual(e.data, { code: 'HAS_OPEN_ORDERS', orderNumbers: [open.orderNumber] })
      return true
    })
    assert.equal((await db.select().from(customersTable).where(eq(customersTable.id, c.id))).length, 1)
  })
})
