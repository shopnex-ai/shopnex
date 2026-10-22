// Payments apps end to end, against a fake app served by this test: configure the method (app token) →
// checkout sends a signed payment session to the app → the app resolves / rejects it → cancel sends a refund
// session → expiry cancels abandoned orders. Uses its own app (deleted at the end, with everything it owns).
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { appService } from '@shopnex/apps'
import { db, schema } from '@shopnex/db'
import { createJwksResolver } from '@shopnex/marketplace-sdk/keys'
import { verifyPaymentsRequest, type PaymentsAppRequest } from '@shopnex/marketplace-sdk/payments'
import { paymentService } from '@shopnex/payments'
import { Fixtures, SHOP, appToken, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()

let server: Server
let appUrl: string
let appId: string
let auth: Record<string, string>
// Requests are checked against the instance's published keys, like a real app does
const keys = createJwksResolver({ allowHttp: true })
let variant: { id: string; priceCents: number }
let methodId: string

// What the fake app received, and how it answers refunds
const received: PaymentsAppRequest[] = []
let failSessions = false
let refundResolve: ((request: PaymentsAppRequest) => Promise<void>) | null = null

before(async () => {
  await requireApp()
  await fx.init()
  ;[variant] = (await sellableVariants(1)) as [typeof variant]

  server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const headers = new Headers(req.headers as Record<string, string>)
    const request = await verifyPaymentsRequest(headers, body, { keys })
    if (!request) return res.writeHead(401).end('bad signature')
    received.push(request)
    if (req.url === '/session') {
      if (failSessions) return res.writeHead(500).end('provider down')
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ redirectUrl: `${appUrl}/pay/${request.id}` }))
    }
    res.writeHead(202).end()
    // Like a real app: resolve the refund after answering
    if (request.kind === 'refund') setTimeout(() => void refundResolve?.(request), 50)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // A managed custom app: installed in the admin, tokens from the client credentials grant
  const { app, privateKey } = await appService.registerApp(
    {
      name: `E2E payments ${Date.now()}`,
      appUrl: `${appUrl}/app`,
      redirectUrls: [],
      scopes: ['read_orders', 'write_payment_sessions'],
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
})

after(async () => {
  await fx.cleanup()
  // The app owns its method, sessions, installation and token
  if (appId) await db.delete(schema.apps).where(eq(schema.apps.id, appId))
  server?.close()
  await closeDb()
})

const configure = (body: object, headers = auth) => call('POST', '/admin/payments-app/configure', body, headers)
const methodBody = (ready = true) => ({
  name: 'E2E card',
  gateway: 'e2e-card',
  paymentSessionUrl: `${appUrl}/session`,
  refundSessionUrl: `${appUrl}/refund`,
  ready,
})

async function checkout() {
  const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
  const r = ok(
    await call('POST', `/storefront/carts/${cart.id}/complete`, {
      email: fx.email,
      paymentMethodId: methodId,
      shippingAddress: { lastName: 'Tester', address1: '1 Main St', city: 'Somewhere', countryCode: 'US' },
    }),
  )
  fx.order(r.orderId)
  return { cartId: cart.id as string, ...r }
}

const order = async (id: string) => {
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id))
  return row!
}
const sessionOf = (orderId: string) => received.filter((r) => r.kind === 'payment' && r.orderId === orderId).at(-1)!

describe('payments app: configure', () => {
  test('rejects session URLs off the app origin and tokens without an app', async () => {
    ok(await configure({ ...methodBody(), paymentSessionUrl: 'https://evil.example.com/session' }), 400)
    ok(await configure(methodBody(), await fx.token(['write_payment_sessions'])), 403)
  })

  test('a method that is not ready stays off checkout', async () => {
    const method = ok(await configure(methodBody(false)))
    methodId = method.id
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    const options = ok(await call('GET', `/storefront/carts/${cart.id}/checkout-options`))
    assert.ok(!options.paymentMethods.some((m: { id: string }) => m.id === methodId))
  })

  test('ready: offered at checkout as offsite', async () => {
    const method = ok(await configure(methodBody(true)))
    assert.equal(method.id, methodId, 'configure updates the same method')
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    const options = ok(await call('GET', `/storefront/carts/${cart.id}/checkout-options`))
    const offered = options.paymentMethods.find((m: { id: string }) => m.id === methodId)
    assert.equal(offered?.offsite, true)
  })
})

describe('payments app: payment sessions', () => {
  test('checkout sends a signed session and returns the app redirect', async () => {
    const placed = await checkout()
    const session = sessionOf(placed.orderId)
    assert.ok(session, 'the app received a payment session')
    const o = await order(placed.orderId)
    assert.equal(session.amount.cents, o.totalCents)
    assert.equal(placed.paymentUrl, `${appUrl}/pay/${session.id}`)
    assert.equal(o.paymentGateway, 'e2e-card')
    assert.equal(o.financialStatus, 'pending')

    // Completing again (back button) hands out the same session
    const again = ok(await call('POST', `/storefront/carts/${placed.cartId}/complete`, { email: fx.email }))
    assert.equal(again.paymentUrl, placed.paymentUrl)
  })

  test('resolve marks the order paid, once', async () => {
    const placed = await checkout()
    const { id } = sessionOf(placed.orderId)
    const resolved = ok(await call('POST', `/admin/payment-sessions/${id}/resolve`, { externalId: 'pi_e2e' }, auth))
    assert.equal(resolved.status, 'resolved')
    ok(await call('POST', `/admin/payment-sessions/${id}/resolve`, { externalId: 'pi_e2e' }, auth))
    const sales = await db
      .select()
      .from(schema.orderTransactions)
      .where(eq(schema.orderTransactions.orderId, placed.orderId))
    assert.equal(sales.length, 1, 'resolving twice records one sale')
    assert.equal(sales[0]!.externalId, 'pi_e2e')
    assert.equal((await order(placed.orderId)).financialStatus, 'paid')
    ok(await call('POST', `/admin/payment-sessions/${id}/reject`, { reason: 'late' }, auth), 409)
  })

  test('a token without the payment session scope is refused', async () => {
    const placed = await checkout()
    const { id } = sessionOf(placed.orderId)
    ok(await call('POST', `/admin/payment-sessions/${id}/resolve`, {}, await fx.token(['write_orders'])), 403)
  })

  test('reject leaves the order unpaid; paying again starts a new session', async () => {
    const placed = await checkout()
    const first = sessionOf(placed.orderId)
    ok(await call('POST', `/admin/payment-sessions/${first.id}/reject`, { reason: 'Card declined' }, auth))
    assert.equal((await order(placed.orderId)).financialStatus, 'pending')
    const retry = ok(await call('POST', `/storefront/carts/${placed.cartId}/complete`, { email: fx.email }))
    const second = sessionOf(placed.orderId)
    assert.notEqual(second.id, first.id)
    assert.equal(retry.paymentUrl, `${appUrl}/pay/${second.id}`)
  })

  test('an app that fails leaves a placed, unpaid order and a paymentError', async () => {
    failSessions = true
    try {
      const placed = await checkout()
      assert.equal(placed.paymentUrl, null)
      assert.ok(placed.paymentError)
      assert.equal((await order(placed.orderId)).financialStatus, 'pending')
    } finally {
      failSessions = false
    }
  })
})

describe('payments app: refunds and expiry', () => {
  test('cancelling a paid order refunds through the app', async () => {
    const placed = await checkout()
    const { id } = sessionOf(placed.orderId)
    ok(await call('POST', `/admin/payment-sessions/${id}/resolve`, { externalId: 'pi_refund_me' }, auth))

    const refunded = new Promise<PaymentsAppRequest>((resolve) => {
      refundResolve = async (request) => {
        ok(await call('POST', `/admin/payment-sessions/${request.id}/resolve`, { externalId: 're_e2e' }, auth))
        resolve(request)
      }
    })
    await paymentService.cancelOrder(SHOP, placed.orderId, { reason: 'customer', restock: true })
    assert.equal((await order(placed.orderId)).financialStatus, 'paid', 'paid until the app confirms')
    const request = await refunded
    assert.equal(request.kind, 'refund')
    assert.equal(request.kind === 'refund' && request.payment.externalId, 'pi_refund_me')
    assert.equal((await order(placed.orderId)).financialStatus, 'refunded')
    refundResolve = null
  })

  test('an abandoned payment cancels the order once it expires', async () => {
    const placed = await checkout()
    const { id } = sessionOf(placed.orderId)
    await db
      .update(schema.paymentSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.paymentSessions.id, id))
    await paymentService.expireDue()
    const o = await order(placed.orderId)
    assert.ok(o.cancelledAt, 'cancelled')
    assert.equal(o.financialStatus, 'voided')
    const [session] = await db.select().from(schema.paymentSessions).where(eq(schema.paymentSessions.id, id))
    assert.equal(session!.status, 'expired')
  })
})
