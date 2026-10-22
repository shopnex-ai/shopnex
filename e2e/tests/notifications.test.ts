// Order notifications end to end, in-process: orders change → emails queued in the same transaction (rendered
// from the shop's Liquid) → the worker sends them through the shop's SMTP settings, here a tiny SMTP server in
// this process. The shop's email settings and templates are put back as they were afterwards.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { EmailError, emailService, notificationService, notify, type Notification } from '@shopnex/email'
import { processDue } from '@shopnex/email/worker'
import { orderService } from '@shopnex/orders'
import { Fixtures, SHOP, closeDb, sellableVariants } from '../lib'
import { smtpSink } from '../smtp-sink'

const fx = new Fixtures()
const sink = smtpSink()
const orderIds: string[] = []
let variant: { id: string; priceCents: number }
let settingsBefore: (typeof schema.emailSettings.$inferSelect)[]
let templatesBefore: (typeof schema.emailTemplates.$inferSelect)[]

const address = {
  firstName: 'Ada',
  lastName: 'Tester',
  company: null,
  address1: '1 Main St',
  address2: null,
  city: 'Somewhere',
  province: null,
  countryCode: 'US',
  zip: '10001',
  phone: null,
}

async function placeOrder(gateway: string, extra: { note?: string } = {}) {
  const order = await orderService.create(SHOP, {
    email: fx.email,
    name: 'Ada Tester',
    items: [{ variantId: variant.id, quantity: 2 }],
    shippingAddress: address,
    payment: {
      gateway,
      name: gateway === 'manual' ? 'Bank transfer' : 'Card',
      instructions: 'IBAN 123\nUse your order number',
    },
    ...extra,
  })
  fx.order(order.id)
  orderIds.push(order.id)
  return order
}

const deliveriesOf = (orderId: string) =>
  db.select().from(schema.emailDeliveries).where(eq(schema.emailDeliveries.orderId, orderId))

const kinds = async (orderId: string) => (await deliveriesOf(orderId)).map((d) => `${d.notification}:${d.to}`).sort()

// Runs the worker until this order's emails are sent (the dev server's worker may send some of them first)
async function sendQueued(orderId: string) {
  for (let i = 0; i < 50; i++) {
    const pending = (await deliveriesOf(orderId)).filter((d) => d.status === 'pending')
    if (pending.length === 0) return
    await processDue()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail('emails still pending')
}

let owners: string[]

before(async () => {
  await fx.init()
  ;[variant] = (await sellableVariants(1)) as [typeof variant]
  settingsBefore = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
  templatesBefore = await db.select().from(schema.emailTemplates).where(eq(schema.emailTemplates.shopId, SHOP))
  await db.delete(schema.emailTemplates).where(eq(schema.emailTemplates.shopId, SHOP))
  const port = await sink.start()
  await emailService.useSmtp(SHOP, {
    preset: 'other',
    host: '127.0.0.1',
    port,
    username: '',
    fromName: 'E2E Shop',
    fromEmail: 'orders@e2e.test',
  })
  owners = (
    await db
      .select({ email: schema.user.email })
      .from(schema.shopMembers)
      .innerJoin(schema.user, eq(schema.user.id, schema.shopMembers.userId))
      .where(and(eq(schema.shopMembers.organizationId, SHOP), eq(schema.shopMembers.role, 'owner')))
  ).map((o) => o.email)
})

after(async () => {
  // Nothing this run queued may go out once the real settings are back
  if (orderIds.length) await db.delete(schema.emailDeliveries).where(inArray(schema.emailDeliveries.orderId, orderIds))
  await db.delete(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
  if (settingsBefore.length) await db.insert(schema.emailSettings).values(settingsBefore)
  await db.delete(schema.emailTemplates).where(eq(schema.emailTemplates.shopId, SHOP))
  if (templatesBefore.length) await db.insert(schema.emailTemplates).values(templatesBefore)
  await fx.cleanup()
  await sink.stop()
  await closeDb()
})

describe('order notifications', () => {
  test('a manual-payment order: confirmation to the buyer and a new-order email to the owners, sent once', async () => {
    const order = await placeOrder('manual', { note: '<script>alert(1)</script>' })
    const expected = [`order_confirmation:${fx.email}`, ...owners.map((o) => `staff_order:${o}`)].sort()
    assert.deepEqual(await kinds(order.id), expected)

    const deliveries = await deliveriesOf(order.id)
    const confirmation = deliveries.find((d) => d.notification === 'order_confirmation')!
    assert.equal(confirmation.subject, `Order #${order.orderNumber} confirmed`)
    assert.match(confirmation.html, /Hi Ada,/)
    assert.match(confirmation.html, /IBAN 123<br>Use your order number/)
    assert.match(confirmation.html, /<html>[\s\S]*Thank you for your order![\s\S]*<\/html>/, 'body inside the layout')
    const staff = deliveries.find((d) => d.notification === 'staff_order')
    if (staff) {
      assert.match(staff.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'customer input is escaped')
      assert.doesNotMatch(staff.html, /<script>/)
    }

    // The same event again (e.g. a retried request) doesn't queue a second copy
    await notify(db, SHOP, 'order.created', () => orderService.getById(SHOP, order.id))
    assert.deepEqual(await kinds(order.id), expected)

    const before = sink.messages.length
    await sendQueued(order.id)
    assert.ok((await deliveriesOf(order.id)).every((d) => d.status === 'sent'))
    assert.ok(
      sink.messages.slice(before).some((m) => m.includes(`To: ${fx.email}`)),
      'the confirmation reached the SMTP server',
    )
  })

  test('fulfilling sends the shipping confirmation with tracking', async () => {
    const order = await placeOrder('manual')
    await orderService.fulfill(SHOP, order.id, {
      trackingCompany: 'UPS',
      trackingNumber: '1ZE2E',
      trackingUrl: 'https://track.example/1ZE2E',
    })
    const shipping = (await deliveriesOf(order.id)).find((d) => d.notification === 'shipping_confirmation')
    assert.ok(shipping)
    assert.equal(shipping.subject, `Order #${order.orderNumber} is on its way`)
    assert.match(shipping.html, /UPS tracking number: <strong>1ZE2E<\/strong>/)
    assert.match(shipping.html, /href="https:\/\/track\.example\/1ZE2E"/)
  })

  test('an app-paid order is confirmed when paid; cancelled unconfirmed, the buyer hears nothing', async () => {
    const abandoned = await placeOrder('stripe')
    assert.deepEqual(await kinds(abandoned.id), [], 'not confirmed before payment')
    await orderService.cancel(SHOP, abandoned.id, { reason: 'declined', restock: true })
    assert.deepEqual(await kinds(abandoned.id), [], 'no cancellation for an order never confirmed')

    const paid = await placeOrder('stripe')
    await notify(db, SHOP, 'order.paid', () => orderService.getById(SHOP, paid.id))
    assert.ok((await kinds(paid.id)).includes(`order_confirmation:${fx.email}`))
    await orderService.cancel(SHOP, paid.id, { reason: 'customer', restock: true })
    const cancelled = (await deliveriesOf(paid.id)).find((d) => d.notification === 'order_cancelled')
    assert.ok(cancelled)
    assert.match(cancelled.html, /was cancelled at your request/)
  })

  test('edited Liquid is used; a broken edit falls back to the default; a turned-off notification is not sent', async () => {
    await notificationService.update(SHOP, 'order_confirmation', {
      subject: 'Thanks {{ order.customer.first_name }}! ({{ order.total_price | money }})',
    })
    const edited = await placeOrder('manual')
    const [confirmation] = (await deliveriesOf(edited.id)).filter((d) => d.notification === 'order_confirmation')
    assert.match(confirmation!.subject, /^Thanks Ada! \(.+\)$/)

    // Saved straight to the table: the API refuses Liquid that doesn't parse, but a filter error only shows at render
    await db
      .update(schema.emailTemplates)
      .set({ subject: '{{ order.name | no_such_filter }}' })
      .where(and(eq(schema.emailTemplates.shopId, SHOP), eq(schema.emailTemplates.notification, 'order_confirmation')))
    const broken = await placeOrder('manual')
    const [fallback] = (await deliveriesOf(broken.id)).filter((d) => d.notification === 'order_confirmation')
    assert.equal(fallback!.subject, `Order #${broken.orderNumber} confirmed`)

    await notificationService.update(SHOP, 'staff_order', { enabled: false })
    const quiet = await placeOrder('manual')
    assert.deepEqual(await kinds(quiet.id), [`order_confirmation:${fx.email}`])

    const reverted = await notificationService.revert(SHOP, 'order_confirmation')
    assert.equal(reverted.customized, false)
    await notificationService.update(SHOP, 'staff_order', { enabled: true })
  })

  test('saving refuses Liquid that does not parse, naming the line', async () => {
    await assert.rejects(
      notificationService.update(SHOP, 'shipping_confirmation', { body: '<p>ok</p>\n{% if order.name %}\n<p>no end' }),
      (error) =>
        error instanceof EmailError && error.code === 'INVALID_TEMPLATE' && /^Body \(line \d+\)/.test(error.message),
    )
  })

  test('preview renders unsaved Liquid and shows errors; templates cannot read files', async () => {
    const ok = await notificationService.preview(SHOP, 'staff_order', {
      subject: 'Hi {{ shop.name }}',
      body: '<p>{{ order.name }}</p>',
    })
    assert.equal(ok.problem, null)
    assert.match(ok.html, /<p>#\d+<\/p>/)

    const bad = await notificationService.preview(SHOP, 'staff_order', {
      subject: 'x',
      body: '{{ order.name | nope }}',
    })
    assert.ok(bad.problem)

    for (const tag of ["{% render '/etc/passwd' %}", "{% include '../../package.json' %}"]) {
      const sneaky = await notificationService.preview(SHOP, 'staff_order', { subject: 'x', body: tag })
      assert.ok(sneaky.problem, `${tag} should fail`)
      assert.doesNotMatch(sneaky.html, /root:|"name":/)
    }

    const layout = await notificationService.preview(SHOP, 'layout', {
      subject: '',
      body: '<main>{{ content_for_layout }}</main>',
    })
    assert.match(layout.html, /^<main>[\s\S]*Thank you for your order![\s\S]*<\/main>$/)
  })

  test('every notification has an entry', async () => {
    const list = await notificationService.list(SHOP)
    assert.deepEqual(
      list.map((n) => n.notification).sort(),
      (
        [
          'layout',
          'order_cancelled',
          'order_confirmation',
          'shipping_confirmation',
          'staff_order',
        ] satisfies Notification[]
      ).sort(),
    )
  })
})
