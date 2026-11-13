// A customer's personal data on request: the export hands over what the shop holds, the erasure removes it and keeps
// the shop's books. Uses its own customers, orders and rows, and removes them at the end.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { productService } from '@shopnex/catalog'
import { customerService } from '@shopnex/customers'
import { db, schema } from '@shopnex/db'
import { orderService } from '@shopnex/orders'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36)

let owner: Record<string, string>
let member: Record<string, string>
let variantId: string
let productId: string
let endpointId: string
const userIds: string[] = []
const suppressed: string[] = []

const address = (first: string, street: string, city: string) => ({
  firstName: first,
  lastName: 'Privacy',
  company: 'Privacy GmbH',
  address1: street,
  address2: 'Floor 3',
  city,
  province: 'BE',
  countryCode: 'DE',
  zip: '10115',
  phone: '+4930123456',
})

before(async () => {
  await requireApp()
  await fx.init()
  owner = (await fx.account('owner')).headers
  member = (await fx.account('member')).headers
  // Its own product, not tracked for stock: these tests place a dozen orders and must not depend on what is on the shelf
  const product = ok(
    await call(
      'POST',
      '/admin/products',
      { title: `E2E privacy ${run}`, variants: [{ priceCents: 1500 }] },
      await fx.token(['write_products']),
    ),
  )
  productId = product.id
  variantId = product.variants[0].id
  const [endpoint] = await db
    .insert(schema.webhookEndpoints)
    .values({
      shopId: SHOP,
      url: 'https://example.com/e2e-privacy',
      topics: ['order.created', 'customer.erased'],
      secret: 'whsec_e2e_privacy',
    })
    .returning({ id: schema.webhookEndpoints.id })
  endpointId = endpoint!.id
})

after(async () => {
  await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, endpointId))
  for (const email of suppressed) {
    await db
      .delete(schema.emailSuppressions)
      .where(and(eq(schema.emailSuppressions.shopId, SHOP), eq(schema.emailSuppressions.email, email)))
  }
  for (const id of userIds) await db.delete(schema.user).where(eq(schema.user.id, id))
  await db.delete(schema.emailDeliveries).where(eq(schema.emailDeliveries.shopId, SHOP))
  await fx.cleanup()
  if (productId) await productService.removeMany(SHOP, [productId])
  await closeDb()
})

/** A customer with a finished order (paid and shipped), the way a returning buyer looks after a while */
async function buyer(label: string, opts: { open?: boolean } = {}) {
  const email = fx.shopper(`privacy-${label}`)
  const customer = (await customerService.create(SHOP, { email, name: `${label} Privacy`, phone: '+4915112345678' }))!
  const place = async () => {
    const placed = await orderService.create(SHOP, {
      customerId: customer.id,
      items: [{ variantId, quantity: 2 }],
      shippingAddress: address(label, 'Privatweg 7', 'Berlin'),
      billingAddress: address(label, 'Rechnungsallee 9', 'Hamburg'),
      note: `Leave with ${label}'s neighbour`,
      shipping: { title: 'E2E standard', code: null, priceCents: 500, freeAboveCents: null },
    })
    fx.order(placed.id)
    return placed
  }
  const finished = await place()
  await orderService.markAsPaid(SHOP, finished.id)
  await orderService.fulfill(SHOP, finished.id, {})
  const open = opts.open ? await place() : null
  return { email, customer, finished, open }
}

const ordersOf = async (customerEmail: string, ids: string[]) =>
  (await db.select().from(schema.orders).where(eq(schema.orders.shopId, SHOP))).filter(
    (o) => ids.includes(o.id) && (customerEmail === '*' || o.email === customerEmail),
  )

describe('export', () => {
  test('hands over the customer, the login, orders with their items and payments, carts and emails', async () => {
    const { email, customer, finished } = await buyer('export')
    // The storefront login, with a session
    const userId = randomUUID()
    userIds.push(userId)
    await db.insert(schema.user).values({ id: userId, name: 'Export Privacy', email, emailVerified: true })
    await db.insert(schema.session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 3600_000),
      ipAddress: '203.0.113.9',
      userAgent: 'E2E browser',
    })
    await db.update(schema.customers).set({ userId }).where(eq(schema.customers.id, customer.id))
    // A checkout started with the address, a mail sent to it, and an unsubscribe
    const cart = await fx.cart([{ merchandiseId: variantId, quantity: 1 }])
    await db.update(schema.carts).set({ email }).where(eq(schema.carts.token, cart.id))
    await db.insert(schema.emailDeliveries).values({
      shopId: SHOP,
      notification: 'order_confirmation',
      orderId: finished.id,
      to: email,
      subject: 'Thanks for your order',
      html: '<p>Hello Export Privacy, we ship to Privatweg 7</p>',
    })
    await db.insert(schema.emailSuppressions).values({ shopId: SHOP, email })
    suppressed.push(email)

    const data = ok(await call('GET', `/admin/customers/${customer.id}/data-export`, undefined, owner))
    assert.equal(data.schemaVersion, 1)
    assert.equal(data.customer.email, email)
    assert.equal(data.customer.phone, '+4915112345678')
    assert.equal(data.loginAccount.email, email)
    assert.equal(data.loginAccount.sessions[0].ipAddress, '203.0.113.9')

    assert.equal(data.orders.length, 1)
    const order = data.orders[0]
    assert.equal(order.orderNumber, finished.orderNumber)
    assert.equal(order.shippingAddress.address1, 'Privatweg 7')
    assert.equal(order.billingAddress.city, 'Hamburg')
    assert.equal(order.note, "Leave with export's neighbour".replace('export', 'export'))
    assert.equal(order.items[0].quantity, 2)
    assert.ok(
      order.transactions.some((t: { kind: string }) => t.kind === 'sale'),
      'the payment is in it',
    )

    assert.equal(data.carts.length, 1)
    assert.equal(data.emails.length, 1)
    assert.match(data.emails[0].html, /Privatweg 7/)
    assert.equal(data.unsubscribedFromReminders, true)
  })

  test('only owners and admins, or a token that can read both customers and orders', async () => {
    const { customer } = await buyer('who')
    const path = `/admin/customers/${customer.id}/data-export`
    assert.equal((await call('GET', path, undefined, member)).status, 403, 'staff')
    assert.equal((await call('GET', path, undefined, await fx.token(['read_customers']))).status, 403, 'customers only')
    assert.equal((await call('GET', path, undefined, await fx.token(['read_orders']))).status, 403, 'orders only')
    ok(await call('GET', path, undefined, await fx.token(['read_customers', 'read_orders'])))
    assert.equal((await call('GET', path, undefined, {})).status, 401, 'nobody')
  })

  test('a customer that does not exist is not found', async () => {
    assert.equal((await call('GET', `/admin/customers/${randomUUID()}/data-export`, undefined, owner)).status, 404)
  })
})

describe('erase', () => {
  test('is refused while an order is still to be delivered, and says which, and changes nothing', async () => {
    const { customer, open, email } = await buyer('open', { open: true })
    const res = await call('POST', `/admin/customers/${customer.id}/erase`, undefined, owner)
    assert.equal(res.status, 409, JSON.stringify(res.body))
    assert.equal(res.body.data.code, 'HAS_OPEN_ORDERS')
    assert.deepEqual(res.body.data.orderNumbers, [open!.orderNumber])
    assert.match(res.body.message, new RegExp(`#${open!.orderNumber}`))
    ok(await call('GET', `/admin/customers/${customer.id}`, undefined, owner))
    assert.equal((await ordersOf(email, [open!.id])).length, 1, 'the order still has its buyer')

    // Once the order is cancelled it no longer needs the address
    await orderService.cancel(SHOP, open!.id, { reason: 'customer', restock: true })
    ok(await call('POST', `/admin/customers/${customer.id}/erase`, undefined, owner))
  })

  test('removes the personal data and keeps the books', async () => {
    const { email, customer, finished } = await buyer('gone')
    const control = await buyer('control')

    // Data to clean: a cart, mails to the customer and to the shop about them, webhook history
    const cart = await fx.cart([{ merchandiseId: variantId, quantity: 1 }])
    await db.update(schema.carts).set({ email, customerId: customer.id }).where(eq(schema.carts.token, cart.id))
    const [toThem] = await db
      .insert(schema.emailDeliveries)
      .values({
        shopId: SHOP,
        notification: 'order_confirmation',
        orderId: finished.id,
        to: email,
        subject: 'Your order',
        html: '<p>Hello gone Privacy, Privatweg 7</p>',
        lastError: `rejected ${email}`,
      })
      .returning()
    const [aboutThem] = await db
      .insert(schema.emailDeliveries)
      .values({
        shopId: SHOP,
        notification: 'staff_order',
        orderId: finished.id,
        to: 'merchant@example.com',
        subject: 'New order',
        html: '<p>gone Privacy ordered, ship to Privatweg 7</p>',
      })
      .returning()
    const [controlMail] = await db
      .insert(schema.emailDeliveries)
      .values({
        shopId: SHOP,
        notification: 'order_confirmation',
        orderId: control.finished.id,
        to: control.email,
        subject: 'Control',
        html: '<p>control</p>',
      })
      .returning()
    const delivery = (body: unknown) => ({
      shopId: SHOP,
      endpointId,
      topic: 'order.created',
      body: JSON.stringify(body),
    })
    await db
      .insert(schema.webhookDeliveries)
      .values([
        delivery({ data: { email, note: 'about the customer' } }),
        delivery({ data: { email: control.email, note: 'about someone else' } }),
      ])
    await db.insert(schema.emailSuppressions).values({ shopId: SHOP, email })
    suppressed.push(email)
    // A login that belongs to nobody else
    const userId = randomUUID()
    userIds.push(userId)
    await db.insert(schema.user).values({ id: userId, name: 'Gone', email: `login-${run}-gone@example.com` })
    await db.update(schema.customers).set({ userId }).where(eq(schema.customers.id, customer.id))

    const result = ok(await call('POST', `/admin/customers/${customer.id}/erase`, undefined, owner))
    assert.deepEqual(result, {
      ordersAnonymized: 1,
      cartsCleared: 1,
      emailsRedacted: 2,
      // The order.created queued when their order was placed (it carries their email), and the one added above
      webhookDeliveriesDeleted: 2,
      loginAccountDeleted: true,
    })

    // The customer and their login are gone
    assert.equal((await call('GET', `/admin/customers/${customer.id}`, undefined, owner)).status, 404)
    assert.equal((await db.select().from(schema.user).where(eq(schema.user.id, userId))).length, 0)

    // The order stays as a record, without the buyer
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, finished.id))
    assert.equal(order!.orderNumber, finished.orderNumber)
    assert.equal(order!.totalCents, finished.totalCents)
    assert.equal(order!.financialStatus, 'paid')
    assert.equal(order!.email, 'erased@erased.invalid')
    assert.equal(order!.phone, null)
    assert.equal(order!.note, null)
    assert.equal(order!.customerId, null)
    for (const a of [order!.shippingAddress, order!.billingAddress]) {
      assert.equal(a!.firstName, null)
      assert.equal(a!.company, null)
      assert.equal(a!.address1, '(erased)')
      assert.equal(a!.city, '(erased)')
      assert.equal(a!.zip, null)
      assert.equal(a!.phone, null)
      assert.equal(a!.countryCode, 'DE', 'the delivery country stays: tax is reported by it')
      assert.equal(a!.province, 'BE')
    }
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, finished.id))
    assert.equal(items.length, 1)
    assert.equal(items[0]!.quantity, 2)
    const sales = await db
      .select()
      .from(schema.orderTransactions)
      .where(eq(schema.orderTransactions.orderId, finished.id))
    assert.ok(
      sales.some((t) => t.kind === 'sale'),
      'the payment is still on the books',
    )

    // The cart lost the address
    const [kept] = await db.select().from(schema.carts).where(eq(schema.carts.token, cart.id))
    assert.equal(kept!.email, null)
    assert.equal(kept!.customerId, null)

    // Mails: the one to them is blanked, the shop's copy lost its body, someone else's is untouched
    const [them] = await db.select().from(schema.emailDeliveries).where(eq(schema.emailDeliveries.id, toThem!.id))
    assert.match(them!.to, /^erased-.*@erased\.invalid$/)
    assert.equal(them!.subject, '(erased)')
    assert.equal(them!.html, '')
    assert.equal(them!.lastError, null)
    const [about] = await db.select().from(schema.emailDeliveries).where(eq(schema.emailDeliveries.id, aboutThem!.id))
    assert.equal(about!.to, 'merchant@example.com')
    assert.equal(about!.html, '')
    const [other] = await db.select().from(schema.emailDeliveries).where(eq(schema.emailDeliveries.id, controlMail!.id))
    assert.equal(other!.html, '<p>control</p>')

    // Webhook history that named them is gone, and an event tells apps to erase their copy
    const bodies = (
      await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, endpointId))
    ).map((d) => d.body)
    assert.ok(!bodies.some((b) => b.includes('about the customer')), 'the payload that named them is deleted')
    assert.ok(
      bodies.some((b) => b.includes('about someone else')),
      'someone else’s payload is not',
    )
    const erased = (
      await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, endpointId))
    )
      .filter((d) => d.topic === 'customer.erased')
      .map((d) => JSON.parse(d.body).data)
    assert.deepEqual(
      erased.filter((e) => e.id === customer.id),
      [{ id: customer.id, email }],
      'one customer.erased names them, so apps can find their copy',
    )

    // The unsubscribe stays: it is how a "no" is honoured
    assert.equal(
      (
        await db
          .select()
          .from(schema.emailSuppressions)
          .where(and(eq(schema.emailSuppressions.shopId, SHOP), eq(schema.emailSuppressions.email, email)))
      ).length,
      1,
    )
    // The other customer is whole
    ok(await call('GET', `/admin/customers/${control.customer.id}`, undefined, owner))
    const [controlOrder] = await ordersOf(control.email, [control.finished.id])
    assert.equal(controlOrder!.shippingAddress!.address1, 'Privatweg 7')
    // Nothing more to erase
    assert.equal((await call('POST', `/admin/customers/${customer.id}/erase`, undefined, owner)).status, 404)
  })

  test('a login that is also staff, or another shop’s customer, is left alone', async () => {
    const { customer } = await buyer('staff')
    const staff = await fx.account('admin')
    await db.update(schema.customers).set({ userId: staff.id }).where(eq(schema.customers.id, customer.id))
    const result = ok(await call('POST', `/admin/customers/${customer.id}/erase`, undefined, owner))
    assert.equal(result.loginAccountDeleted, false)
    assert.equal((await db.select().from(schema.user).where(eq(schema.user.id, staff.id))).length, 1)

    const shared = await buyer('shared')
    const other = await fx.shop()
    const userId = randomUUID()
    userIds.push(userId)
    await db.insert(schema.user).values({ id: userId, name: 'Shared', email: `login-${run}-shared@example.com` })
    await db.update(schema.customers).set({ userId }).where(eq(schema.customers.id, shared.customer.id))
    await db.insert(schema.customers).values({ shopId: other.id, email: shared.email, userId })
    ok(await call('POST', `/admin/customers/${shared.customer.id}/erase`, undefined, owner))
    assert.equal(
      (await db.select().from(schema.user).where(eq(schema.user.id, userId))).length,
      1,
      'still the other shop’s login',
    )
  })

  test('only owners and admins can erase, never an API token', async () => {
    const { customer } = await buyer('denied')
    const path = `/admin/customers/${customer.id}/erase`
    assert.equal((await call('POST', path, undefined, member)).status, 403, 'staff')
    const token = await fx.token(['write_customers', 'write_orders'])
    const withToken = await call('POST', path, undefined, token)
    assert.ok(withToken.status === 401 || withToken.status === 403, `token: ${withToken.status}`)
    assert.equal((await call('POST', path, undefined, {})).status, 401, 'nobody')
    ok(await call('GET', `/admin/customers/${customer.id}`, undefined, owner))
  })
})
