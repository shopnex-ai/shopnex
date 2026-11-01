// Paying through a payments app in the real hosted checkout: the buyer is sent to the provider, the card is
// declined / abandoned / paid late, and the checkout page has to tell the truth each time. A fake provider (a
// tiny server with a "pay" page) stands in for Stripe's hosted page, which can't be automated; the test plays the
// payments app and reports outcomes through the Admin API exactly as the Stripe app does after a webhook.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type Page } from '@playwright/test'
import { and, eq } from 'drizzle-orm'
import { appService } from '@shopnex/apps'
import { db, schema } from '@shopnex/db'
import { createJwksResolver } from '@shopnex/marketplace-sdk/keys'
import { verifyPaymentsRequest, type PaymentSessionRequest } from '@shopnex/marketplace-sdk/payments'
import { Fixtures, SHOP, appToken, call, closeDb, ok, requireApp } from '../lib'

const STOREFRONT_URL = (process.env.STOREFRONT_URL ?? 'http://localhost:4321').replace(/\/$/, '')
const METHOD = 'E2E provider card'

const fx = new Fixtures()
const keys = createJwksResolver({ allowHttp: true })
let server: Server
let appUrl: string
let appId: string
let auth: Record<string, string>
let slug: string
// Payment sessions the fake provider was asked to start, oldest first
const requests: PaymentSessionRequest[] = []

async function buyableProductSlug() {
  const rows = await db
    .select({ slug: schema.products.slug, stock: schema.productVariants.inventoryQuantity })
    .from(schema.products)
    .innerJoin(schema.productVariants, eq(schema.productVariants.productId, schema.products.id))
    .where(and(eq(schema.products.shopId, SHOP), eq(schema.products.status, 'active')))
  const slugs = [...new Set(rows.map((r) => r.slug))]
  const found = slugs.find((s) => rows.filter((r) => r.slug === s).every((r) => r.stock === null || r.stock >= 10))
  if (!found) throw new Error('Need an active product with all variants in stock')
  return found
}

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  await fx.shippingRate(500)
  slug = await buyableProductSlug()

  server = createServer(async (req, res) => {
    // The provider's hosted page the buyer lands on
    if (req.url?.startsWith('/pay/')) {
      return res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Fake provider</h1><p>Enter your card</p>')
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const request = await verifyPaymentsRequest(new Headers(req.headers as Record<string, string>), body, { keys })
    if (!request) return res.writeHead(401).end('bad signature')
    if (request.kind === 'payment') requests.push(request)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ redirectUrl: `${appUrl}/pay/${request.id}` }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const { app, privateKey } = await appService.registerApp(
    {
      name: `E2E browser payments ${Date.now()}`,
      appUrl: `${appUrl}/app`,
      redirectUrls: [],
      scopes: ['write_payment_sessions'],
    },
    null,
  )
  appId = app.id
  await appService.installManaged({
    appId,
    shopId: SHOP,
    userId: null as unknown as string,
    scopes: ['write_payment_sessions'],
  })
  auth = { authorization: `Bearer ${await appToken(app.clientId, privateKey, { shop_id: SHOP })}` }
  ok(
    await call(
      'POST',
      '/admin/payments-app/configure',
      {
        name: METHOD,
        gateway: 'e2e-provider',
        paymentSessionUrl: `${appUrl}/session`,
        refundSessionUrl: `${appUrl}/refund`,
        ready: true,
      },
      auth,
    ),
  )
})

test.afterAll(async () => {
  const placed = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.email, fx.email))
  for (const { id } of placed) fx.order(id)
  await fx.cleanup()
  if (appId) await db.delete(schema.apps).where(eq(schema.apps.id, appId))
  server?.close()
  await closeDb()
})

/** Storefront → hosted checkout → place the order → the buyer lands on the provider's page. Returns that session. */
async function placeOrder(page: Page) {
  const before = requests.length
  await page.goto(`${STOREFRONT_URL}/products/${slug}`)
  await page.getByRole('button', { name: /add to cart/i }).click()
  await page
    .getByRole('link', { name: /proceed to checkout/i })
    .or(page.getByRole('button', { name: /proceed to checkout/i }))
    .click()
  await page.waitForURL(/\/checkout\//)
  await page.getByLabel('Email').fill(fx.email)
  await page.getByLabel('Country / region').selectOption('US')
  await page.getByLabel('Last name').fill('Tester')
  await page.getByLabel('Address', { exact: true }).fill('1 Main St')
  await page.getByLabel('City').fill('Somewhere')
  await page.getByLabel('Postal code').fill('10001')
  await page.getByLabel('State / region').fill('NY')
  const shipping = page.locator('input[name="shippingRateId"]').first()
  await expect(shipping).toBeVisible()
  await shipping.check()
  await page.getByLabel(METHOD).check()
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await page.waitForURL(`${appUrl}/pay/*`)
  await expect(page.getByText('Fake provider')).toBeVisible()
  assert.equal(requests.length, before + 1, 'one payment session was started')
  const session = requests.at(-1)!
  assert.equal(page.url(), `${appUrl}/pay/${session.id}`)
  return session
}

// What the payments app reports (the Stripe app does this from its webhook handler)
const report = (id: string, action: 'resolve' | 'reject' | 'attempt-failed', body: object) =>
  call('POST', `/admin/payment-sessions/${id}/${action}`, body, auth)
const decline = async (id: string) => ok(await report(id, 'attempt-failed', { reason: 'Your card was declined.' }))
const orderRow = async (id: string) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0]!
const sales = (orderId: string) =>
  db.select().from(schema.orderTransactions).where(eq(schema.orderTransactions.orderId, orderId))

const paidPage = (page: Page) => page.getByText(/Your order is confirmed/)

test('a declined card keeps the order open; the buyer comes back, retries on the same session and pays', async ({
  page,
}) => {
  const session = await placeOrder(page)

  // Declined at the provider: Shopnex hears why, the session stays open
  await decline(session.id)
  const [open] = await db.select().from(schema.paymentSessions).where(eq(schema.paymentSessions.id, session.id))
  expect(open!.status).toBe('pending')
  expect(open!.errorMessage).toBe('Your card was declined.')

  // Back on the checkout page: still waiting, can continue to payment
  await page.goto(session.returnUrl)
  await expect(page.getByRole('heading', { name: 'Complete your payment' })).toBeVisible()
  const started = requests.length
  await page.getByRole('button', { name: 'Continue to payment' }).click()
  await page.waitForURL(`${appUrl}/pay/${session.id}`)
  expect(requests.length, 'the open session is reused, not restarted').toBe(started)

  // The retry works
  ok(await report(session.id, 'resolve', { externalId: 'pi_retry' }))
  await page.goto(session.returnUrl)
  await expect(paidPage(page)).toBeVisible()
  await expect(page.getByRole('button', { name: /pay now|continue to payment/i })).toHaveCount(0)
  expect((await orderRow(session.orderId)).financialStatus).toBe('paid')
})

test('the waiting page updates itself when the payment is confirmed', async ({ page }) => {
  const session = await placeOrder(page)
  await page.goto(session.returnUrl)
  await expect(page.getByText(/Waiting for your payment to be confirmed/)).toBeVisible()
  // The provider's webhook arrives a moment later
  ok(await report(session.id, 'resolve', { externalId: 'pi_poll' }))
  await expect(paidPage(page)).toBeVisible({ timeout: 15_000 })
})

test('an abandoned payment is rejected; the buyer can pay again on a new session', async ({ page }) => {
  const first = await placeOrder(page)
  ok(await report(first.id, 'reject', { reason: 'Checkout expired without payment' }))

  await page.goto(first.returnUrl)
  await expect(page.getByText(/Your payment didn't go through/)).toBeVisible()
  await page.getByRole('button', { name: 'Pay now' }).click()
  await page.waitForURL(`${appUrl}/pay/*`)
  const second = requests.at(-1)!
  expect(second.id).not.toBe(first.id)
  expect(page.url()).toBe(`${appUrl}/pay/${second.id}`)

  ok(await report(second.id, 'resolve', { externalId: 'pi_second' }))
  await page.goto(first.returnUrl)
  await expect(paidPage(page)).toBeVisible()
  expect((await orderRow(first.orderId)).financialStatus).toBe('paid')
})

test('money that arrives after the session was rejected still marks the order paid', async ({ page }) => {
  const session = await placeOrder(page)
  ok(await report(session.id, 'reject', { reason: 'Checkout expired without payment' }))
  await page.goto(session.returnUrl)
  await expect(page.getByRole('button', { name: 'Pay now' })).toBeVisible()

  // The payment event arrives anyway
  ok(await report(session.id, 'resolve', { externalId: 'pi_late' }))
  await page.reload()
  await expect(paidPage(page)).toBeVisible()
  expect((await orderRow(session.orderId)).financialStatus).toBe('paid')
})

test('the same payment reported many times (duplicate webhooks) records one sale', async ({ page }) => {
  const session = await placeOrder(page)
  const results = await Promise.all(
    Array.from({ length: 4 }, () => report(session.id, 'resolve', { externalId: 'pi_dup' })),
  )
  for (const r of results) ok(r)
  await page.goto(session.returnUrl)
  await expect(paidPage(page)).toBeVisible()
  expect(await sales(session.orderId)).toHaveLength(1)
  // A duplicate failure after payment cannot undo it
  ok(await report(session.id, 'attempt-failed', { reason: 'late decline' }))
  expect((await orderRow(session.orderId)).financialStatus).toBe('paid')
})
