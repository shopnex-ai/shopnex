// A discount used by an order: the usage count and limit, "once per customer", and what the database does with the
// redemption when its order or customer goes away. Real in-memory PostgreSQL (PGlite), the way the app runs it.
// It asserts with plain SQL on discount_redemptions, so it does not care which module owns the table.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { orders } from '../src/orders.schema'
import { customers } from '@shopnex/customers/schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { discountService } = await import('@shopnex/pricing')
const { discounts } = await import('@shopnex/pricing/schema')
const { checkDiscount, redeemDiscount } = await import('../src/discount-redemptions')
const { eq, sql } = await import('drizzle-orm')

const SHOP = 'default'
const run = Date.now().toString(36)
let channelId: string
let orderNumber = 900_000

before(async () => {
  await prepareDatabase()
  const [channel] = await db.select({ id: schema.channels.id }).from(schema.channels).limit(1)
  assert.ok(channel, 'the migrations seed a channel')
  channelId = channel.id
})

after(async () => {
  await db.delete(discounts).where(eq(discounts.shopId, SHOP))
  await db.delete(orders).where(eq(orders.shopId, SHOP))
  await db.delete(customers).where(eq(customers.shopId, SHOP))
  await db.$client.end?.()
})

const redemptions = async (discountId: string) =>
  Number(
    (await db.execute(sql`select count(*)::int as n from discount_redemptions where discount_id = ${discountId}`))
      .rows[0]!.n,
  )

async function customer(name: string) {
  const [row] = await db
    .insert(customers)
    .values({ shopId: SHOP, email: `${name}-${run}@example.com` })
    .returning()
  return row!
}

async function order(conn: Parameters<typeof discountService.redeem>[0], customerId: string | null) {
  const [row] = await conn
    .insert(orders)
    .values({
      shopId: SHOP,
      orderNumber: ++orderNumber,
      channelId,
      customerId,
      email: `buyer-${orderNumber}@example.com`,
      subtotalCents: 1000,
      totalCents: 1000,
    })
    .returning()
  return row!
}

async function discount(patch: { code: string; oncePerCustomer?: boolean; usageLimit?: number }) {
  return discountService.create(SHOP, { type: 'percentage', value: 10, ...patch, code: `${patch.code}-${run}` }, db)
}

/** What placing an order does with a discount: lock and check it, place the order, record the use, in one transaction */
async function place(code: string, customerId: string | null) {
  return db.transaction(async (tx) => {
    const checked = await checkDiscount(tx, SHOP, `${code}-${run}`, customerId)
    if (!checked.discount) return { error: checked.error, order: null }
    const placed = await order(tx, customerId)
    await redeemDiscount(tx, checked.discount, placed)
    return { error: null, order: placed }
  })
}

describe('placing an order with a discount', () => {
  test('counts the use and records it', async () => {
    const d = await discount({ code: 'COUNT' })
    const buyer = await customer('count')
    const { error, order: placed } = await place('COUNT', buyer.id)
    assert.equal(error, null)
    const [after] = await db.select().from(discounts).where(eq(discounts.id, d.id))
    assert.equal(after!.usageCount, 1)
    assert.equal(await redemptions(d.id), 1)
    assert.ok(placed)
  })

  test('the usage limit holds: the next order is refused', async () => {
    const d = await discount({ code: 'LIMIT', usageLimit: 1 })
    assert.equal((await place('LIMIT', null)).error, null)
    const second = await place('LIMIT', null)
    assert.match(second.error!, /reached its usage limit/)
    assert.equal(await redemptions(d.id), 1)
  })

  test('once per customer: the same customer is refused, another customer and a guest are not', async () => {
    const d = await discount({ code: 'ONCE', oncePerCustomer: true })
    const [a, b] = [await customer('once-a'), await customer('once-b')]
    assert.equal((await place('ONCE', a.id)).error, null)
    assert.match((await place('ONCE', a.id)).error!, /was already used/)
    assert.equal((await place('ONCE', b.id)).error, null)
    assert.equal((await place('ONCE', null)).error, null)
    assert.equal((await place('ONCE', null)).error, null)
    // a, b and the two guest orders (a guest has no customer to limit, so each one is allowed and recorded)
    assert.equal(await redemptions(d.id), 4)
  })

  test('a refused order leaves no trace: the count and the rows stay', async () => {
    const d = await discount({ code: 'REFUSED', oncePerCustomer: true })
    const buyer = await customer('refused')
    await place('REFUSED', buyer.id)
    await place('REFUSED', buyer.id)
    const [after] = await db.select().from(discounts).where(eq(discounts.id, d.id))
    assert.equal(after!.usageCount, 1)
    assert.equal(await redemptions(d.id), 1)
  })
})

describe('what the database does with a redemption', () => {
  test('deleting the order deletes its redemption', async () => {
    const d = await discount({ code: 'CASCADE' })
    const { order: placed } = await place('CASCADE', null)
    assert.equal(await redemptions(d.id), 1)
    await db.delete(orders).where(eq(orders.id, placed!.id))
    assert.equal(await redemptions(d.id), 0)
  })

  test('deleting the customer keeps the redemption and clears who it was', async () => {
    const d = await discount({ code: 'SETNULL', oncePerCustomer: true })
    const buyer = await customer('setnull')
    await place('SETNULL', buyer.id)
    await db.delete(customers).where(eq(customers.id, buyer.id))
    assert.equal(await redemptions(d.id), 1)
    const rows = await db.execute(sql`select customer_id from discount_redemptions where discount_id = ${d.id}`)
    assert.equal(rows.rows[0]!.customer_id, null)
  })

  test('deleting the discount deletes its redemptions', async () => {
    const d = await discount({ code: 'GONE' })
    await place('GONE', null)
    await db.delete(discounts).where(eq(discounts.id, d.id))
    assert.equal(await redemptions(d.id), 0)
  })
})
