// Customers: a shop's own list, found by email in lower case, created once per email, changed with their custom fields, deleted by the
// shop's own ids, and what each change tells webhooks. Guests are matched by email.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shops } from '@shopnex/core/schema'
import { customers } from '../src/customers.schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { customerService } = await import('../src')
const { customFieldService } = await import('@shopnex/custom-fields')
const { webhookDeliveries, webhookEndpoints } = await import('@shopnex/webhooks/schema')

const SHOP = 'default'
const OTHER = 'customers-other-shop'
const MISSING = '00000000-0000-4000-8000-000000000000'
let counter = 0
const email = (name = 'c') => `${name}-${Date.now().toString(36)}${(++counter).toString(36)}@example.test`

before(async () => {
  await prepareDatabase()
  await db.insert(shops).values({ id: OTHER, name: 'Other', slug: OTHER }).onConflictDoNothing()
})
beforeEach(cleanup)
after(async () => {
  await cleanup()
  await db.delete(shops).where(eq(shops.id, OTHER))
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

async function cleanup() {
  await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.shopId, [SHOP, OTHER]))
  await db.delete(customers).where(inArray(customers.shopId, [SHOP, OTHER]))
  const { customFieldDefinitions } = await import('@shopnex/custom-fields/schema')
  await db.delete(customFieldDefinitions).where(inArray(customFieldDefinitions.shopId, [SHOP, OTHER]))
}

async function hook(topics: string[]) {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({ shopId: SHOP, url: 'https://example.com/hook', topics: topics as never, secret: 'whsec_x' })
    .returning()
  return async () =>
    (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, row!.id))).map((d) => ({
      topic: d.topic,
      data: (JSON.parse(d.body) as { data: Record<string, unknown> }).data,
    }))
}

describe('creating a customer', () => {
  test('is the shop’s, with the email in lower case and trimmed, and the name and phone given', async () => {
    const c = await customerService.create(SHOP, { email: '  Ada@Example.TEST ', name: 'Ada', phone: '+1' })
    assert.deepEqual(
      [c?.shopId, c?.email, c?.name, c?.phone, c?.userId, c?.customFields],
      [SHOP, 'ada@example.test', 'Ada', '+1', null, {}],
    )
  })

  test('an email already used in the shop gives null and changes nothing; another shop may use it', async () => {
    const first = await customerService.create(SHOP, { email: 'dup@example.test', name: 'First' })
    assert.equal(await customerService.create(SHOP, { email: 'DUP@example.test', name: 'Second' }), null)
    assert.equal((await customerService.getByEmail(SHOP, 'dup@example.test'))?.name, 'First')
    const theirs = await customerService.create(OTHER, { email: 'dup@example.test', name: 'Theirs' })
    assert.notEqual(theirs?.id, first?.id)
  })

  test('custom field values are checked against the shop’s fields and stored', async () => {
    await customFieldService.create(SHOP, { resource: 'customer', key: 'tier', label: 'Tier', type: 'text' }, db)
    const c = await customerService.create(SHOP, { email: email(), customFields: { tier: 'gold' } })
    assert.deepEqual(c?.customFields, { tier: 'gold' })
    await assert.rejects(customerService.create(SHOP, { email: email(), customFields: { nope: 'x' } }))
  })

  test('tells webhooks customer.created with the customer', async () => {
    const sent = await hook(['customer.created'])
    const c = await customerService.create(SHOP, { email: 'hook@example.test', name: 'Hook' })
    const [delivery] = await sent()
    assert.deepEqual(
      [delivery?.topic, delivery?.data.id, delivery?.data.email],
      ['customer.created', c?.id, 'hook@example.test'],
    )
  })

  test('a duplicate tells webhooks nothing', async () => {
    const sent = await hook(['customer.created'])
    await customerService.create(SHOP, { email: 'once@example.test' })
    await customerService.create(SHOP, { email: 'once@example.test' })
    assert.equal((await sent()).length, 1)
  })
})

describe('finding customers', () => {
  test('getById and getByEmail are scoped to the shop; the email is matched in any case', async () => {
    const mine = await customerService.create(SHOP, { email: 'mine@example.test', name: 'Mine' })
    const theirs = await customerService.create(OTHER, { email: 'theirs@example.test' })
    assert.equal((await customerService.getById(SHOP, mine!.id))?.name, 'Mine')
    assert.equal(await customerService.getById(SHOP, theirs!.id), null)
    assert.equal(await customerService.getById(SHOP, MISSING), null)
    assert.equal((await customerService.getByEmail(SHOP, ' MINE@example.TEST '))?.id, mine!.id)
    assert.equal(await customerService.getByEmail(SHOP, 'theirs@example.test'), null)
  })

  test('list is the shop’s own, newest first, with the total, paged', async () => {
    for (const name of ['a', 'b', 'c']) {
      await customerService.create(SHOP, { email: `${name}@example.test`, name })
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await customerService.create(OTHER, { email: 'x@example.test' })
    const all = await customerService.list(SHOP, { limit: 10, offset: 0 })
    assert.deepEqual([all.items.map((c) => c.name), all.total], [['c', 'b', 'a'], 3])
    const page = await customerService.list(SHOP, { limit: 1, offset: 1 })
    assert.deepEqual([page.items.map((c) => c.name), page.total], [['b'], 3])
  })

  test('search matches the email or the name, in any case, as plain text (% and _ are not wildcards)', async () => {
    await customerService.create(SHOP, { email: 'ada@example.test', name: 'Ada Lovelace' })
    await customerService.create(SHOP, { email: 'bob@example.test', name: '100%_sure' })
    const found = async (search: string) =>
      (await customerService.list(SHOP, { limit: 10, offset: 0, search })).items.map((c) => c.email).sort()
    assert.deepEqual(await found('LOVE'), ['ada@example.test'])
    assert.deepEqual(await found('bob@'), ['bob@example.test'])
    assert.deepEqual(await found('%_s'), ['bob@example.test'])
    assert.deepEqual(await found('%'), ['bob@example.test'])
    assert.deepEqual(await found('nobody'), [])
    assert.equal((await customerService.list(SHOP, { limit: 10, offset: 0, search: 'ada' })).total, 1)
  })
})

describe('changing a customer', () => {
  test('changes only what is given, normalizes the email, and moves updatedAt', async () => {
    const c = await customerService.create(SHOP, { email: 'old@example.test', name: 'Old', phone: '+1' })
    const u = await customerService.update(SHOP, c!.id, { email: ' New@Example.TEST ', name: 'New' })
    assert.deepEqual([u?.email, u?.name, u?.phone], ['new@example.test', 'New', '+1'])
    assert.ok(u!.updatedAt.getTime() >= c!.updatedAt.getTime())
  })

  test('null for an unknown customer or another shop’s, which is left alone', async () => {
    const theirs = await customerService.create(OTHER, { email: 'theirs@example.test', name: 'Theirs' })
    assert.equal(await customerService.update(SHOP, MISSING, { name: 'x' }), null)
    assert.equal(await customerService.update(SHOP, theirs!.id, { name: 'Hijacked' }), null)
    assert.equal(await customerService.update(SHOP, theirs!.id, { customFields: {} }), null)
    assert.equal((await customerService.getById(OTHER, theirs!.id))?.name, 'Theirs')
  })

  test('custom fields are merged with what is there: a value sets, null clears, the rest stay', async () => {
    for (const key of ['tier', 'note'])
      await customFieldService.create(SHOP, { resource: 'customer', key, label: key, type: 'text' }, db)
    const c = await customerService.create(SHOP, { email: email(), customFields: { tier: 'gold', note: 'vip' } })
    const set = await customerService.update(SHOP, c!.id, { customFields: { tier: 'silver' } })
    assert.deepEqual(set?.customFields, { tier: 'silver', note: 'vip' })
    const cleared = await customerService.update(SHOP, c!.id, { customFields: { note: null } })
    assert.deepEqual(cleared?.customFields, { tier: 'silver' })
    const untouched = await customerService.update(SHOP, c!.id, { name: 'Renamed' })
    assert.deepEqual(untouched?.customFields, { tier: 'silver' }, 'a change that names no custom field leaves them')
  })

  test('tells webhooks customer.updated with the changed customer', async () => {
    const c = await customerService.create(SHOP, { email: 'u@example.test', name: 'A' })
    const sent = await hook(['customer.updated'])
    await customerService.update(SHOP, c!.id, { name: 'B' })
    await customerService.update(SHOP, MISSING, { name: 'C' })
    const deliveries = await sent()
    assert.deepEqual(
      deliveries.map((d) => [d.topic, d.data.name]),
      [['customer.updated', 'B']],
    )
  })
})

describe('deleting customers', () => {
  test('removeMany deletes the shop’s own and says how many; nothing to delete is 0', async () => {
    const [a, b] = [
      await customerService.create(SHOP, { email: email() }),
      await customerService.create(SHOP, { email: email() }),
    ]
    const theirs = await customerService.create(OTHER, { email: email() })
    assert.equal(await customerService.removeMany(SHOP, [a!.id, theirs!.id, MISSING]), 1)
    assert.equal(await customerService.removeMany(SHOP, []), 0)
    assert.equal(await customerService.getById(SHOP, a!.id), null)
    assert.ok(await customerService.getById(SHOP, b!.id))
    assert.ok(await customerService.getById(OTHER, theirs!.id))
  })
})

describe('guests at checkout', () => {
  test('findOrCreateByEmail makes the customer the first time and finds it after, whatever the case', async () => {
    const first = await customerService.findOrCreateByEmail(SHOP, { email: 'Guest@Example.test', name: 'Guest' })
    const again = await customerService.findOrCreateByEmail(SHOP, { email: 'guest@example.TEST', name: 'Other name' })
    assert.equal(again.id, first.id)
    assert.equal(again.name, 'Guest', 'the first name stays')
    assert.equal((await customerService.list(SHOP, { limit: 10, offset: 0 })).total, 1)
  })

  test('two checkouts at once with the same new email end up with one customer', async () => {
    const [a, b] = await Promise.all([
      customerService.findOrCreateByEmail(SHOP, { email: 'race@example.test' }),
      customerService.findOrCreateByEmail(SHOP, { email: 'race@example.test' }),
    ])
    assert.equal(a.id, b.id)
  })

  test('it is the shop’s: the same email in another shop is another customer', async () => {
    const mine = await customerService.findOrCreateByEmail(SHOP, { email: 'same@example.test' })
    const theirs = await customerService.findOrCreateByEmail(OTHER, { email: 'same@example.test' })
    assert.notEqual(mine.id, theirs.id)
  })
})
