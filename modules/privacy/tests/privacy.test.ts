// What the shop hands over about a customer and what it removes on request: the export, the refusal while an order is still open,
// the anonymized orders, the cleared carts and redacted emails, the login account that goes only when nobody else uses it.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shops, user as userTable } from '@shopnex/core/schema'
import { emailDeliveries, emailSuppressions } from '@shopnex/email/schema'
import { cartLines, carts } from '@shopnex/cart/schema'
import { orderItems, orders, orderShippingLines, orderTransactions } from '@shopnex/orders/schema'
import { customers } from '@shopnex/customers/schema'
import { channels } from '@shopnex/channels/schema'
import { giftCards } from '@shopnex/gift-cards/schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { privacyService, PrivacyError } = await import('../src')
const { session } = await import('@shopnex/auth/schema')
const { shopMembers } = await import('@shopnex/tenancy/schema')
const { webhookDeliveries, webhookEndpoints } = await import('@shopnex/webhooks/schema')

const SHOP = 'default'
const OTHER = 'privacy-other-shop'
const MISSING = '00000000-0000-4000-8000-000000000000'
let counter = 0
const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
let orderNumber = 800_000
const made = { customers: [] as string[], orders: [] as string[], carts: [] as string[], users: [] as string[] }

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
  await db.delete(emailDeliveries).where(inArray(emailDeliveries.shopId, [SHOP, OTHER]))
  await db.delete(emailSuppressions).where(inArray(emailSuppressions.shopId, [SHOP, OTHER]))
  await db.delete(giftCards).where(inArray(giftCards.shopId, [SHOP, OTHER]))
  await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.shopId, [SHOP, OTHER]))
  if (made.carts.length) await db.delete(carts).where(inArray(carts.id, made.carts))
  if (made.orders.length) await db.delete(orders).where(inArray(orders.id, made.orders))
  if (made.customers.length) await db.delete(customers).where(inArray(customers.id, made.customers))
  await db.delete(shopMembers).where(inArray(shopMembers.userId, made.users))
  if (made.users.length) await db.delete(userTable).where(inArray(userTable.id, made.users))
  for (const list of Object.values(made)) list.length = 0
}

const channelId = async (shopId = SHOP) => {
  const [row] = await db.select().from(channels).where(eq(channels.shopId, shopId))
  if (row) return row.id
  const [made] = await db.insert(channels).values({ shopId, handle: 'online-store', name: 'Online Store' }).returning()
  return made!.id
}

async function user(patch: Partial<typeof userTable.$inferInsert> = {}) {
  const id = `u-${unique()}`
  const [row] = await db
    .insert(userTable)
    .values({ id, name: id, email: `${id}@example.test`, emailVerified: true, ...patch })
    .returning()
  made.users.push(id)
  return row!
}

async function customer(patch: Partial<typeof customers.$inferInsert> = {}, shopId = SHOP) {
  const [row] = await db
    .insert(customers)
    .values({ shopId, email: `c-${unique()}@example.test`, name: 'Ada Buyer', phone: '+100', ...patch })
    .returning()
  made.customers.push(row!.id)
  return row!
}

const address = {
  firstName: 'Ada',
  lastName: 'Buyer',
  company: 'ACME',
  address1: '1 Main St',
  address2: null,
  city: 'Paris',
  province: 'IDF',
  countryCode: 'FR',
  zip: '75001',
  phone: '+100',
}

async function order(patch: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await db
    .insert(orders)
    .values({
      shopId: SHOP,
      orderNumber: ++orderNumber,
      channelId: await channelId(patch.shopId ?? SHOP),
      email: 'buyer@example.test',
      phone: '+100',
      note: 'leave at the door',
      shippingAddress: address,
      billingAddress: address,
      subtotalCents: 1000,
      totalCents: 1000,
      financialStatus: 'paid',
      fulfillmentStatus: 'fulfilled',
      ...patch,
    })
    .returning()
  made.orders.push(row!.id)
  return row!
}

async function cart(patch: Partial<typeof carts.$inferInsert> = {}) {
  const [row] = await db
    .insert(carts)
    .values({
      shopId: SHOP,
      channelId: await channelId(),
      token: `t-${unique()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      ...patch,
    })
    .returning()
  made.carts.push(row!.id)
  return row!
}

const refused = (code: string) => (e: unknown) => e instanceof PrivacyError && e.code === code

describe('exportData', () => {
  test('is null for an unknown customer, and for another shop’s', async () => {
    const theirs = await customer({}, OTHER)
    assert.equal(await privacyService.exportData(SHOP, MISSING, db), null)
    assert.equal(await privacyService.exportData(SHOP, theirs.id, db), null)
  })

  test('gives the customer record, with the version of the format', async () => {
    const c = await customer({ email: 'ada@example.test', name: 'Ada', customFields: { vip: true } })
    const data = await privacyService.exportData(SHOP, c.id, db)
    assert.equal(data?.schemaVersion, 1)
    assert.deepEqual(
      [data?.customer.id, data?.customer.email, data?.customer.name, data?.customer.customFields],
      [c.id, 'ada@example.test', 'Ada', { vip: true }],
    )
    assert.deepEqual([data?.orders, data?.carts, data?.emails, data?.loginAccount], [[], [], [], null])
    assert.equal(data?.unsubscribedFromReminders, false)
  })

  test('orders are the ones linked to the customer or placed with the same email in any case, in order number, and only this shop’s', async () => {
    const c = await customer({ email: 'ada@example.test' })
    const linked = await order({ customerId: c.id, email: 'other@example.test' })
    const sameEmail = await order({ email: 'ADA@Example.test' })
    await order({ email: 'someone@example.test' })
    await order({ shopId: OTHER, email: 'ada@example.test' })
    const data = await privacyService.exportData(SHOP, c.id, db)
    assert.deepEqual(
      data?.orders.map((o) => o.id),
      [linked.id, sameEmail.id],
    )
    assert.equal(data?.orders[0]?.shippingAddress?.address1, '1 Main St')
  })

  test('an order comes with its items, shipping lines and transactions', async () => {
    const c = await customer()
    const o = await order({ customerId: c.id })
    await db.insert(orderItems).values({ orderId: o.id, title: 'Shirt', unitPriceCents: 500, quantity: 2, sku: 'S-1' })
    await db.insert(orderShippingLines).values({ orderId: o.id, title: 'Standard', priceCents: 100 })
    await db.insert(orderTransactions).values({
      orderId: o.id,
      kind: 'sale',
      status: 'success',
      gateway: 'manual',
      amountCents: 1000,
      currency: 'USD',
    })
    const [exported] = (await privacyService.exportData(SHOP, c.id, db))!.orders
    assert.deepEqual(
      exported?.items.map((i) => [i.title, i.quantity, i.sku]),
      [['Shirt', 2, 'S-1']],
    )
    assert.deepEqual(
      exported?.shippingLines.map((s) => [s.title, s.priceCents]),
      [['Standard', 100]],
    )
    assert.deepEqual(
      exported?.transactions.map((t) => [t.kind, t.status, t.amountCents]),
      [['sale', 'success', 1000]],
    )
  })

  test('carts with their lines, the emails sent to them, and whether they unsubscribed from reminders', async () => {
    const c = await customer({ email: 'ada@example.test' })
    await cart({ customerId: c.id, email: 'ada@example.test' })
    await cart({ email: 'someone@example.test' })
    await db.insert(emailDeliveries).values([
      {
        shopId: SHOP,
        notification: 'order_confirmation',
        to: 'Ada@Example.test',
        subject: 'Thanks',
        html: '<p>hi</p>',
      },
      {
        shopId: SHOP,
        notification: 'order_confirmation',
        to: 'someone@example.test',
        subject: 'Not hers',
        html: '<p>x</p>',
      },
    ])
    await db.insert(emailSuppressions).values({ shopId: SHOP, email: 'ada@example.test' })
    const data = await privacyService.exportData(SHOP, c.id, db)
    assert.equal(data?.carts.length, 1)
    assert.deepEqual(
      data?.emails.map((e) => e.subject),
      ['Thanks'],
    )
    assert.equal(data?.unsubscribedFromReminders, true)
  })

  test('the storefront login with its sessions, when the customer has one', async () => {
    const login = await user({ name: 'Ada Login' })
    const c = await customer({ userId: login.id })
    await db.insert(session).values({
      id: `s-${unique()}`,
      userId: login.id,
      token: `tok-${unique()}`,
      expiresAt: new Date(Date.now() + 1000),
      ipAddress: '10.0.0.1',
    })
    const data = await privacyService.exportData(SHOP, c.id, db)
    assert.equal(data?.loginAccount?.name, 'Ada Login')
    assert.deepEqual(
      data?.loginAccount?.sessions.map((s) => s.ipAddress),
      ['10.0.0.1'],
    )
    await db.delete(session).where(eq(session.userId, login.id))
  })
})

// What a customer typed for a line (an engraving, a gift message) can name a person: it is in their export, and erasing removes it
// while the line, its price and its quantity stay for the books
describe('line item properties', () => {
  const typed = [
    { name: 'Engraving', value: 'For Anna Example' },
    { name: '_source', value: 'popup' },
  ]
  async function lineOf(orderId: string) {
    const [row] = await db
      .insert(orderItems)
      .values({ orderId, title: 'Rubber stamp', unitPriceCents: 1500, quantity: 2, properties: typed })
      .returning()
    return row!
  }
  async function cartLinesOf(cartId: string) {
    const { productService } = await import('@shopnex/catalog')
    const p = await productService.create(SHOP, { title: `Stamp ${unique()}`, priceCents: 1500 }, db)
    const variantId = p.variants[0]!.id
    await db.insert(cartLines).values([
      { cartId, variantId, quantity: 1, properties: [{ name: 'Engraving', value: 'Anna' }], propertiesKey: 'a' },
      { cartId, variantId, quantity: 1, properties: [{ name: 'Engraving', value: 'Ben' }], propertiesKey: 'b' },
    ])
    return variantId
  }

  test('the export includes what they typed, on orders and in carts', async () => {
    const c = await customer()
    const o = await order({ customerId: c.id })
    await lineOf(o.id)
    const k = await cart({ customerId: c.id })
    await cartLinesOf(k.id)
    const data = await privacyService.exportData(SHOP, c.id, db)
    assert.deepEqual(data!.orders[0]!.items[0]!.properties, typed)
    assert.deepEqual(data!.carts[0]!.lines.map((l) => l.properties.map((p) => p.value).join()).sort(), ['Anna', 'Ben'])
  })

  test('erasing removes the text from their orders and carts, and keeps the line, its price and its quantity', async () => {
    const c = await customer()
    const o = await order({ customerId: c.id })
    const line = await lineOf(o.id)
    const k = await cart({ customerId: c.id })
    await cartLinesOf(k.id)
    await privacyService.erase(SHOP, c.id, db)
    const [kept] = await db.select().from(orderItems).where(eq(orderItems.id, line.id))
    assert.deepEqual([kept!.properties, kept!.quantity, kept!.unitPriceCents], [[], 2, 1500])
    const cleared = await db.select().from(cartLines).where(eq(cartLines.cartId, k.id))
    assert.equal(cleared.length, 2, 'two lines of one variant stay two lines')
    assert.deepEqual(
      cleared.map((l) => l.properties),
      [[], []],
    )
  })

  test('another customer’s lines are not touched', async () => {
    const c = await customer()
    const other = await customer()
    const mine = await order({ customerId: c.id })
    const theirs = await order({ customerId: other.id })
    await lineOf(mine.id)
    const theirLine = await lineOf(theirs.id)
    await privacyService.erase(SHOP, c.id, db)
    const [untouched] = await db.select().from(orderItems).where(eq(orderItems.id, theirLine.id))
    assert.deepEqual(untouched!.properties, typed)
  })
})

describe('gift cards', () => {
  const card = (recipientEmail: string, shopId = SHOP) =>
    db
      .insert(giftCards)
      .values({
        shopId,
        code: `P${unique()}`.toUpperCase().padEnd(16, 'X'),
        currency: 'USD',
        initialCents: 5000,
        balanceCents: 3000,
        recipientEmail,
      })
      .returning()
      .then((rows) => rows[0]!)

  test('the export lists the cards sent to the customer, without the code', async () => {
    const c = await customer()
    const mine = await card(c.email.toUpperCase())
    await card('someone.else@example.com')
    await card(c.email, OTHER)
    const data = await privacyService.exportData(SHOP, c.id, db)
    assert.deepEqual(
      data!.giftCards.map((g) => [g.id, g.balanceCents]),
      [[mine.id, 3000]],
    )
    assert.ok(!JSON.stringify(data!.giftCards).includes(mine.code), 'the code is a secret that spends the card')
  })

  test('erasing clears who a card was for and keeps its balance', async () => {
    const c = await customer()
    const mine = await card(c.email)
    const other = await card('someone.else@example.com')
    await privacyService.erase(SHOP, c.id, db)
    const [after] = await db.select().from(giftCards).where(eq(giftCards.id, mine.id))
    assert.equal(after!.recipientEmail, null)
    assert.equal(after!.balanceCents, 3000)
    const [untouched] = await db.select().from(giftCards).where(eq(giftCards.id, other.id))
    assert.equal(untouched!.recipientEmail, 'someone.else@example.com')
  })
})

describe('erase', () => {
  test('refuses an unknown customer, and another shop’s', async () => {
    const theirs = await customer({}, OTHER)
    await assert.rejects(privacyService.erase(SHOP, MISSING, db), refused('CUSTOMER_NOT_FOUND'))
    await assert.rejects(privacyService.erase(SHOP, theirs.id, db), refused('CUSTOMER_NOT_FOUND'))
  })

  test('refuses while an order is open (to deliver, or not paid), naming them in order, and changes nothing', async () => {
    const c = await customer()
    await order({ customerId: c.id, fulfillmentStatus: 'unfulfilled' })
    await order({ customerId: c.id, financialStatus: 'pending' })
    await order({ customerId: c.id })
    await assert.rejects(privacyService.erase(SHOP, c.id, db), (e: unknown) => {
      assert.ok(e instanceof PrivacyError)
      assert.equal(e.code, 'HAS_OPEN_ORDERS')
      assert.deepEqual(e.data.orderNumbers, [orderNumber - 2, orderNumber - 1])
      assert.match(e.message, new RegExp(`#${String(orderNumber - 2)}, #${String(orderNumber - 1)}`))
      return true
    })
    assert.ok((await db.select().from(customers).where(eq(customers.id, c.id)))[0])
  })

  test('a cancelled order is never open, even unpaid and unfulfilled', async () => {
    const c = await customer()
    await order({
      customerId: c.id,
      fulfillmentStatus: 'unfulfilled',
      financialStatus: 'pending',
      cancelledAt: new Date(),
    })
    const result = await privacyService.erase(SHOP, c.id, db)
    assert.equal(result.ordersAnonymized, 1)
  })

  test('orders stay for the books but lose who they were for; the country and region stay', async () => {
    const c = await customer({ email: 'ada@example.test' })
    const linked = await order({ customerId: c.id })
    const byEmail = await order({ email: 'Ada@Example.test' })
    const unrelated = await order({ email: 'someone@example.test' })
    const result = await privacyService.erase(SHOP, c.id, db)
    assert.equal(result.ordersAnonymized, 2)
    for (const id of [linked.id, byEmail.id]) {
      const [o] = await db.select().from(orders).where(eq(orders.id, id))
      assert.deepEqual([o?.email, o?.phone, o?.note], ['erased@erased.invalid', null, null])
      assert.deepEqual(
        [
          o?.shippingAddress?.address1,
          o?.shippingAddress?.city,
          o?.shippingAddress?.firstName,
          o?.shippingAddress?.zip,
        ],
        ['(erased)', '(erased)', null, null],
      )
      assert.deepEqual([o?.shippingAddress?.countryCode, o?.shippingAddress?.province], ['FR', 'IDF'])
      assert.equal(o?.totalCents, 1000)
    }
    const [kept] = await db.select().from(orders).where(eq(orders.id, unrelated.id))
    assert.equal(kept?.email, 'someone@example.test')
  })

  test('carts lose the address and the link to the customer', async () => {
    const c = await customer({ email: 'ada@example.test' })
    const mine = await cart({ customerId: c.id, email: 'ada@example.test' })
    const other = await cart({ email: 'someone@example.test' })
    const result = await privacyService.erase(SHOP, c.id, db)
    assert.equal(result.cartsCleared, 1)
    const [after] = await db.select().from(carts).where(eq(carts.id, mine.id))
    assert.deepEqual([after?.email, after?.customerId], [null, null])
    assert.equal((await db.select().from(carts).where(eq(carts.id, other.id)))[0]?.email, 'someone@example.test')
  })

  test('emails sent to them lose recipient, subject and body; copies about their orders lose the body; the rows stay', async () => {
    const c = await customer({ email: 'ada@example.test' })
    const o = await order({ customerId: c.id })
    const [toHer] = await db
      .insert(emailDeliveries)
      .values({
        shopId: SHOP,
        notification: 'order_confirmation',
        orderId: o.id,
        to: 'Ada@Example.test',
        subject: 'Thanks',
        html: '<p>hi</p>',
      })
      .returning()
    const [aboutHer] = await db
      .insert(emailDeliveries)
      .values({
        shopId: SHOP,
        notification: 'staff_order',
        orderId: o.id,
        to: 'owner@shop.test',
        subject: 'New order',
        html: '<p>Ada, 1 Main St</p>',
      })
      .returning()
    const [unrelated] = await db
      .insert(emailDeliveries)
      .values({
        shopId: SHOP,
        notification: 'order_confirmation',
        to: 'someone@example.test',
        subject: 'Keep',
        html: '<p>keep</p>',
      })
      .returning()
    const result = await privacyService.erase(SHOP, c.id, db)
    assert.equal(result.emailsRedacted, 2)
    const row = async (id: string) => (await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, id)))[0]
    const redacted = await row(toHer!.id)
    assert.equal(redacted?.to, `erased-${toHer!.id}@erased.invalid`)
    assert.deepEqual([redacted?.subject, redacted?.html], ['(erased)', ''])
    const copy = await row(aboutHer!.id)
    assert.deepEqual([copy?.to, copy?.subject, copy?.html], ['owner@shop.test', 'New order', ''])
    assert.deepEqual([(await row(unrelated!.id))?.subject, (await row(unrelated!.id))?.html], ['Keep', '<p>keep</p>'])
  })

  test('webhook deliveries that mention the email are deleted, others stay; the customer record goes', async () => {
    const c = await customer({ email: 'ada@example.test' })
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({ shopId: SHOP, url: 'https://example.com/hook', topics: ['customer.created'], secret: 'whsec_x' })
      .returning()
    await db.insert(webhookDeliveries).values([
      { shopId: SHOP, endpointId: endpoint!.id, topic: 'customer.created', body: '{"email":"Ada@example.test"}' },
      { shopId: SHOP, endpointId: endpoint!.id, topic: 'customer.created', body: '{"email":"someone@example.test"}' },
    ])
    const result = await privacyService.erase(SHOP, c.id, db)
    assert.equal(result.webhookDeliveriesDeleted, 1)
    assert.equal((await db.select().from(customers).where(eq(customers.id, c.id))).length, 0)
    const left = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpoint!.id))
    assert.deepEqual(
      left.map((d) => d.body),
      ['{"email":"someone@example.test"}'],
    )
  })

  test('queues customer.erased after the cleaning, so its own payload survives', async () => {
    const c = await customer({ email: 'ada@example.test' })
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({ shopId: SHOP, url: 'https://example.com/hook', topics: ['customer.erased'], secret: 'whsec_x' })
      .returning()
    await privacyService.erase(SHOP, c.id, db)
    const sent = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpoint!.id))
    assert.equal(sent.length, 1)
    assert.deepEqual((JSON.parse(sent[0]!.body) as { data: unknown }).data, { id: c.id, email: 'ada@example.test' })
  })

  test('the storefront login goes too, unless it is staff, a platform admin or another shop’s customer', async () => {
    const results: boolean[] = []
    const lone = await user()
    const staff = await user()
    await db.insert(shopMembers).values({ id: `m-${unique()}`, organizationId: SHOP, userId: staff.id, role: 'member' })
    const admin = await user({ role: 'superadmin' })
    const shared = await user()
    await customer({ userId: shared.id }, OTHER)
    for (const login of [lone, staff, admin, shared]) {
      const c = await customer({ userId: login.id })
      results.push((await privacyService.erase(SHOP, c.id, db)).loginAccountDeleted)
    }
    assert.deepEqual(results, [true, false, false, false])
    assert.equal((await db.select().from(userTable).where(eq(userTable.id, lone.id))).length, 0)
    assert.equal((await db.select().from(userTable).where(eq(userTable.id, shared.id))).length, 1)
  })

  test('is all or nothing: an open order leaves carts, emails and the customer untouched', async () => {
    const c = await customer({ email: 'ada@example.test' })
    await order({ customerId: c.id, fulfillmentStatus: 'unfulfilled' })
    const mine = await cart({ customerId: c.id, email: 'ada@example.test' })
    await assert.rejects(privacyService.erase(SHOP, c.id, db), refused('HAS_OPEN_ORDERS'))
    assert.equal((await db.select().from(carts).where(eq(carts.id, mine.id)))[0]?.email, 'ada@example.test')
  })
})
