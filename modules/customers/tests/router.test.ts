// The admin customer routes, called through the real router with fake resolvers and an in-memory database: the scopes they need, input checks,
// and what they answer. (A customer's data export and erase are @shopnex/privacy's.)
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'
import { hasScope } from '@shopnex/core/scopes'
import type { ApiScope } from '@shopnex/core/schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { configureRpc } = await import('@shopnex/rpc')
const { customersModule } = await import('../src/customers.module')
const { eq } = await import('drizzle-orm')
const { customers: customersTable } = await import('../src/customers.schema')

const { customers } = customersModule.router
const SHOP = 'default'
const shop = { id: SHOP, storefrontUrl: null } as never
const MISSING = '00000000-0000-4000-8000-000000000000'

let who: 'staff' | 'nobody' | { token: ApiScope[] } = 'staff'

before(async () => {
  await prepareDatabase()
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
  await db.delete(customersTable).where(eq(customersTable.shopId, SHOP))
})
after(async () => {
  await db.delete(customersTable).where(eq(customersTable.shopId, SHOP))
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

const run = <T>(procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, {
    context: { headers: new Headers(typeof who === 'object' ? { authorization: 'Bearer sk_test' } : {}) },
  } as never) as Promise<T>
const refused = (code: string) => (e: unknown) => e instanceof ORPCError && e.code === code
const invalid = (e: unknown) =>
  e instanceof ORPCError && e.code === 'BAD_REQUEST' && e.message === 'Input validation failed'

type Customer = {
  id: string
  email: string
  name: string | null
  phone: string | null
  customFields: Record<string, unknown>
}

describe('who may call', () => {
  test('nobody signed in is UNAUTHORIZED; an API token needs read_customers to read and write_customers to write', async () => {
    who = 'nobody'
    await assert.rejects(run(customers.list, { limit: 10, offset: 0 }), refused('UNAUTHORIZED'))
    who = { token: ['read_customers'] }
    assert.equal((await run<{ total: number }>(customers.list, { limit: 10, offset: 0 })).total, 0)
    await assert.rejects(run(customers.create, { email: 'a@example.test' }), refused('FORBIDDEN'))
    await assert.rejects(run(customers.deleteMany, { ids: [MISSING] }), refused('FORBIDDEN'))
    who = { token: ['write_customers'] }
    assert.equal((await run<Customer>(customers.create, { email: 'a@example.test' })).email, 'a@example.test')
    who = { token: ['read_orders'] }
    await assert.rejects(run(customers.list, { limit: 10, offset: 0 }), refused('FORBIDDEN'))
  })
})

describe('the routes', () => {
  test('create, get, update, list and delete answer the customer', async () => {
    const c = await run<Customer>(customers.create, { email: 'Ada@Example.test', name: 'Ada', phone: '+1' })
    assert.deepEqual([c.email, c.name, c.phone, c.customFields], ['ada@example.test', 'Ada', '+1', {}])
    assert.equal((await run<Customer>(customers.get, { id: c.id })).name, 'Ada')
    const u = await run<Customer>(customers.update, { id: c.id, name: 'Ada L.' })
    assert.deepEqual([u.name, u.phone], ['Ada L.', '+1'])
    const listed = await run<{ items: Customer[]; total: number }>(customers.list, {
      limit: 10,
      offset: 0,
      search: 'ada',
    })
    assert.deepEqual([listed.items.map((x) => x.id), listed.total], [[c.id], 1])
    assert.equal(await run(customers.deleteMany, { ids: [c.id, MISSING] }), 1)
    await assert.rejects(run(customers.get, { id: c.id }), refused('NOT_FOUND'))
  })

  test('an unknown customer is NOT_FOUND', async () => {
    await assert.rejects(run(customers.get, { id: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(run(customers.update, { id: MISSING, name: 'x' }), refused('NOT_FOUND'))
  })

  test('an email already used in the shop is CONFLICT, on create and on update, and updating to one’s own email is fine', async () => {
    const a = await run<Customer>(customers.create, { email: 'a@example.test' })
    const b = await run<Customer>(customers.create, { email: 'b@example.test' })
    await assert.rejects(run(customers.create, { email: 'A@example.test' }), refused('CONFLICT'))
    await assert.rejects(run(customers.update, { id: b.id, email: 'a@example.test' }), refused('CONFLICT'))
    assert.equal(
      (await run<Customer>(customers.update, { id: a.id, email: 'A@Example.test', name: 'Same' })).name,
      'Same',
    )
  })

  test('input is checked: an email that is not one, a blank name or phone, a list limit out of range, ids that are not ids', async () => {
    for (const bad of [
      { email: 'nobody' },
      { email: 'a@example.test', name: '' },
      { email: 'a@example.test', phone: '' },
    ])
      await assert.rejects(run(customers.create, bad), invalid, JSON.stringify(bad))
    await assert.rejects(run(customers.list, { limit: 0, offset: 0 }), invalid)
    await assert.rejects(run(customers.get, { id: 'not-a-uuid' }), invalid)
    await assert.rejects(run(customers.deleteMany, { ids: [] }), invalid)
    await assert.rejects(run(customers.deleteMany, { ids: Array.from({ length: 101 }, () => MISSING) }), invalid)
  })
})
