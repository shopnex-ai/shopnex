// Abandoned cart emails: a shopper gives their email at the hosted checkout, asks for a reminder and leaves. After
// the delay the running app's email worker sends it through the shop's SMTP (a tiny server in this process); a
// shopper who finishes the order is never emailed, nobody is emailed twice, and an unsubscribed address is skipped.
// The delay is a shop setting, so the test sets it to the shortest and ages the carts instead of waiting.
import { expect, test, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { Fixtures, SHOP, closeDb, requireApp, sellableVariants } from '../lib'
import { smtpSink } from '../smtp-sink'

const fx = new Fixtures()
const sink = smtpSink()
let variantId: string
let emailBefore: (typeof schema.emailSettings.$inferSelect)[]
let abandonedBefore: (typeof schema.abandonedCartSettings.$inferSelect)[]

// The worker polls every few seconds
const WORKER_WAIT = 30_000

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  await fx.paymentMethod('E2E bank transfer')
  await fx.shippingRate(500)
  variantId = (await sellableVariants(1))[0]!.id
  const port = await sink.start()
  emailBefore = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
  abandonedBefore = await db
    .select()
    .from(schema.abandonedCartSettings)
    .where(eq(schema.abandonedCartSettings.shopId, SHOP))
  const config = {
    preset: 'other' as const,
    host: '127.0.0.1',
    port,
    username: '',
    fromName: 'E2E Shop',
    fromEmail: 'shop@example.com',
  }
  await db
    .insert(schema.emailSettings)
    .values({ shopId: SHOP, config, active: true })
    .onConflictDoUpdate({ target: schema.emailSettings.shopId, set: { config, password: null, active: true } })
  const settings = { enabled: true, delayMinutes: 15 }
  await db
    .insert(schema.abandonedCartSettings)
    .values({ shopId: SHOP, ...settings })
    .onConflictDoUpdate({ target: schema.abandonedCartSettings.shopId, set: settings })
})

test.afterAll(async () => {
  const placed = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.email, fx.email))
  for (const { id } of placed) fx.order(id)
  await db.delete(schema.emailSuppressions).where(eq(schema.emailSuppressions.email, fx.email))
  await db.delete(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
  if (emailBefore.length) await db.insert(schema.emailSettings).values(emailBefore)
  await db.delete(schema.abandonedCartSettings).where(eq(schema.abandonedCartSettings.shopId, SHOP))
  if (abandonedBefore.length) await db.insert(schema.abandonedCartSettings).values(abandonedBefore)
  await fx.cleanup()
  await sink.stop()
  await closeDb()
})

const deliveriesOf = (cartId: string) =>
  db.select().from(schema.emailDeliveries).where(eq(schema.emailDeliveries.cartId, cartId))

// A shopper with something in their cart, on the hosted checkout
async function openCheckout(page: Page) {
  const cart = await fx.cart([{ merchandiseId: variantId, quantity: 1 }])
  // The Storefront API's cart id is the cart's token
  const [row] = await db.select().from(schema.carts).where(eq(schema.carts.token, cart.id))
  await page.goto(`/checkout/${row!.token}`)
  return row!
}

// The shopper types their email (the hint under it says it is used for cart reminders) and walks away
async function giveEmail(page: Page, cartId: string) {
  await page.getByRole('button', { name: 'More information' }).hover()
  await expect(page.getByText('Used for your order confirmation and cart reminders')).toBeVisible()
  await page.getByLabel('Email').fill(fx.email)
  // Saved with the cart as soon as the shopper leaves the field
  await page.getByLabel('Email').blur()
  await expect
    .poll(async () => (await db.select().from(schema.carts).where(eq(schema.carts.id, cartId)))[0]?.email)
    .toBe(fx.email)
}

// "The delay has passed": the cart was last touched two hours ago
const age = (cartId: string) =>
  db
    .update(schema.carts)
    .set({ updatedAt: new Date(Date.now() - 2 * 3600_000) })
    .where(eq(schema.carts.id, cartId))

// The raw messages, with quoted-printable undone (long lines are folded and "=" is written "=3D")
const reminders = () =>
  sink.messages
    .map((m) => m.replace(/=\r?\n/g, '').replace(/=3D/g, '='))
    .filter((m) => m.includes('You left something'))

test('an abandoned checkout gets one reminder after the delay, with a way back and a way out', async ({ page }) => {
  const cart = await openCheckout(page)
  await giveEmail(page, cart.id)

  // Not yet: the shopper may still be filling the form in
  await expect.poll(() => deliveriesOf(cart.id), { timeout: 8_000 }).toHaveLength(0)

  await age(cart.id)
  await expect.poll(async () => (await deliveriesOf(cart.id))[0]?.status, { timeout: WORKER_WAIT }).toBe('sent')
  const message = reminders().find((m) => m.includes(fx.email))!
  expect(message).toBeTruthy()
  expect(message).toContain(`/checkout/${cart.token}`)
  expect(message).toContain('/unsubscribe/')

  // Never twice, however long the worker keeps running
  await new Promise((resolve) => setTimeout(resolve, 8_000))
  expect(await deliveriesOf(cart.id)).toHaveLength(1)

  // Unsubscribing is a button on the page the link opens, not the link itself (mail scanners open links)
  const unsubscribeUrl = /(https?:\/\/[^\s"'<>]+\/unsubscribe\/[A-Za-z0-9_.-]+)/.exec(message)![1]!
  await page.goto(new URL(unsubscribeUrl).pathname)
  await expect(page.getByText(fx.email)).toBeVisible()
  expect(
    await db.select().from(schema.emailSuppressions).where(eq(schema.emailSuppressions.email, fx.email)),
  ).toHaveLength(0)
  await page.getByRole('button', { name: 'Unsubscribe' }).click()
  await expect(page.getByText(/won't get cart reminders/)).toBeVisible()

  // An unsubscribed address is not emailed again, for any later checkout
  const next = await openCheckout(page)
  await giveEmail(page, next.id)
  await age(next.id)
  await expect.poll(async () => (await deliveriesOf(next.id))[0]?.status, { timeout: WORKER_WAIT }).toBe('skipped')
  expect(reminders().filter((m) => m.includes(next.token))).toHaveLength(0)
  await db.delete(schema.emailSuppressions).where(eq(schema.emailSuppressions.email, fx.email))
})

test('a shopper who finishes the order is not reminded', async ({ page }) => {
  const cart = await openCheckout(page)
  await giveEmail(page, cart.id)

  await page.getByLabel('Country / region').selectOption('US')
  await page.getByLabel('Last name').fill('Tester')
  await page.getByLabel('Address', { exact: true }).fill('1 Main St')
  await page.getByLabel('City').fill('Somewhere')
  await page.getByLabel('Postal code').fill('10001')
  await page.getByLabel('State / region').fill('NY')
  await expect(page.getByText('E2E bank transfer')).toBeVisible()
  await page.getByRole('button', { name: /place order/i }).click()
  await expect(page.getByText(/Transfer the total to IBAN E2E-0000/)).toBeVisible()

  // The order is paid for (here by the shop owner marking the bank transfer as received)
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.email, fx.email))
  await db.update(schema.orders).set({ financialStatus: 'paid' }).where(eq(schema.orders.id, order!.id))

  await age(cart.id)
  // Long enough for the worker to look at it several times
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  expect(await deliveriesOf(cart.id)).toHaveLength(0)
  expect(reminders().filter((m) => m.includes(cart.token))).toHaveLength(0)
})

test('with the feature off, the email is not kept and nothing is sent', async ({ page }) => {
  await db
    .update(schema.abandonedCartSettings)
    .set({ enabled: false })
    .where(eq(schema.abandonedCartSettings.shopId, SHOP))
  try {
    const cart = await openCheckout(page)
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: 'More information' })).toHaveCount(0)
    await page.getByLabel('Email').fill(fx.email)
    await page.getByLabel('Email').blur()
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect((await db.select().from(schema.carts).where(eq(schema.carts.id, cart.id)))[0]?.email).toBeNull()

    await age(cart.id)
    await new Promise((resolve) => setTimeout(resolve, 8_000))
    expect(await deliveriesOf(cart.id)).toHaveLength(0)
  } finally {
    await db
      .update(schema.abandonedCartSettings)
      .set({ enabled: true })
      .where(eq(schema.abandonedCartSettings.shopId, SHOP))
  }
})
