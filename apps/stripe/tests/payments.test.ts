// ShopNex → Stripe app: starting a payment (a Checkout Session) and refunding one. Stripe is a recording fake and
// ShopNex's side (signature check, the shop's data, resolve / reject) is a stub, so these run with no network. What
// the Checkout Session carries is also checked against the webhook's amount check: the two halves must agree, or a
// real payment would never be marked paid.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'node:test'
import type Stripe from 'stripe'
import { HTTPException } from 'hono/http-exception'
import type { PaymentSessionRequest, RefundSessionRequest, ShopContext } from '@shopnex/app'
import { checkoutExpiry, expireReplaced, paymentRoutes, refund, type PaymentDeps } from '../src/payments'
import { amountMismatch } from '../src/webhook'

const INSTANCE = 'https://shop.example.com'
const SHOP_ID = 'shop_1'

let sessionCalls: { params: Stripe.Checkout.SessionCreateParams; options: Stripe.RequestOptions }[]
let openSessions: { id: string; metadata: Record<string, string> }[]
let expired: string[]
let listBroken: boolean
let refundCalls: { params: Stripe.RefundCreateParams; options: Stripe.RequestOptions }[]
let stripeError: Error | null
let refundResult: { id: string; status: string }
let outcomes: string[]
let rejectBroken: boolean

const shop = {
  instance: INSTANCE,
  shopId: SHOP_ID,
  payments: {
    async resolve(id: string, externalId?: string) {
      outcomes.push(`resolve:${id}:${externalId}`)
    },
    async reject(id: string, reason: string) {
      outcomes.push(`reject:${id}:${reason}`)
      if (rejectBroken) throw new Error('ShopNex is down')
    },
  },
} as unknown as ShopContext

const stripe = {
  checkout: {
    sessions: {
      async create(params: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions) {
        sessionCalls.push({ params, options })
        if (stripeError) throw stripeError
        return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }
      },
      async *list() {
        if (listBroken) throw new Error('Stripe is down')
        yield* openSessions
      },
      async expire(id: string) {
        if (id === 'cs_paying') throw new Error('Checkout is being paid')
        expired.push(id)
        return { id }
      },
    },
  },
  refunds: {
    async create(params: Stripe.RefundCreateParams, options: Stripe.RequestOptions) {
      refundCalls.push({ params, options })
      if (stripeError) throw stripeError
      return refundResult
    },
  },
} as unknown as Stripe

let signatureValid: boolean
const deps: PaymentDeps = {
  async verify(c, kind) {
    if (!signatureValid) throw new HTTPException(401, { message: 'Invalid signature' })
    const request = (await c.req.json()) as PaymentSessionRequest | RefundSessionRequest
    assert.equal(request.kind, kind)
    return { request, shop } as never
  },
  async stripeFor() {
    return stripe
  },
}
const routes = paymentRoutes(deps)

const inTwoHours = () => new Date(Date.now() + 2 * 3600_000).toISOString()
const paymentRequest = (over: Partial<PaymentSessionRequest> = {}): PaymentSessionRequest => ({
  kind: 'payment',
  id: 'ps_1',
  instance: INSTANCE,
  shopId: SHOP_ID,
  orderId: 'order_1',
  orderNumber: 1042,
  amount: { cents: 4999, currency: 'USD' },
  customer: { email: 'buyer@example.com', name: 'Test Buyer' },
  returnUrl: `${INSTANCE}/checkout/cart_1`,
  expiresAt: inTwoHours(),
  ...over,
})
const refundRequest = (over: Partial<RefundSessionRequest> = {}): RefundSessionRequest => ({
  kind: 'refund',
  id: 'rf_1',
  instance: INSTANCE,
  shopId: SHOP_ID,
  orderId: 'order_1',
  orderNumber: 1042,
  amount: { cents: 1500, currency: 'USD' },
  payment: { sessionId: 'ps_1', externalId: 'pi_123' },
  expiresAt: inTwoHours(),
  ...over,
})
const post = (path: string, body: unknown) =>
  routes.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  sessionCalls = []
  refundCalls = []
  openSessions = []
  expired = []
  listBroken = false
  outcomes = []
  stripeError = null
  refundResult = { id: 're_1', status: 'succeeded' }
  signatureValid = true
  rejectBroken = false
  // Failures are logged by the app; keep the test output readable
  mock.method(console, 'error', () => {})
})
afterEach(() => mock.restoreAll())

describe('checkoutExpiry', () => {
  const now = () => Math.floor(Date.now() / 1000)

  test('keeps an expiry Stripe accepts', () => {
    const wanted = now() + 2 * 3600
    assert.equal(checkoutExpiry(new Date(wanted * 1000).toISOString()), wanted)
  })

  test('raises one that is too soon to just over 30 minutes (Stripe refuses less)', () => {
    const got = checkoutExpiry(new Date(Date.now() + 60_000).toISOString())
    assert.ok(got >= now() + 30 * 60 && got <= now() + 32 * 60, `got ${got - now()}s from now`)
  })

  test('lowers one that is too far to just under 24 hours (Stripe refuses more)', () => {
    const got = checkoutExpiry(new Date(Date.now() + 72 * 3600_000).toISOString())
    assert.ok(got < now() + 24 * 3600 && got > now() + 23 * 3600, `got ${got - now()}s from now`)
  })
})

describe('POST /payments/session replacing an earlier attempt', () => {
  const open = (id: string, orderId: string, sessionId: string) => ({
    id,
    metadata: { shopnex_order_id: orderId, shopnex_session_id: sessionId },
  })

  test("ends the order's other open Checkout Sessions before creating the new one", async () => {
    openSessions = [
      open('cs_old', 'order_1', 'ps_0'),
      open('cs_other', 'order_2', 'ps_9'),
      { id: 'cs_bare', metadata: {} },
    ]
    const res = await post('/payments/session', paymentRequest())
    assert.equal(res.status, 200)
    assert.deepEqual(expired, ['cs_old'], 'only the same order, and only ours')
    assert.equal(sessionCalls.length, 1)
  })

  test('a retry of the same ShopNex session leaves its own Checkout Session alone', async () => {
    openSessions = [open('cs_same', 'order_1', 'ps_1')]
    await post('/payments/session', paymentRequest())
    assert.deepEqual(expired, [])
  })

  test('one that is being paid cannot be ended, and the new payment still starts', async () => {
    openSessions = [open('cs_paying', 'order_1', 'ps_0'), open('cs_old', 'order_1', 'ps_00')]
    const res = await post('/payments/session', paymentRequest())
    assert.equal(res.status, 200)
    assert.deepEqual(expired, ['cs_old'])
  })

  test('Stripe failing to list does not stop the new payment', async () => {
    listBroken = true
    const res = await post('/payments/session', paymentRequest())
    assert.equal(res.status, 200)
    assert.equal(sessionCalls.length, 1)
  })

  test('expireReplaced can be called on its own', async () => {
    openSessions = [open('cs_old', 'order_1', 'ps_0')]
    await expireReplaced(stripe, paymentRequest())
    assert.deepEqual(expired, ['cs_old'])
  })
})

describe('POST /payments/session', () => {
  test('creates a Checkout Session for the order and returns its URL', async () => {
    const res = await post('/payments/session', paymentRequest())
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })

    assert.equal(sessionCalls.length, 1)
    const { params } = sessionCalls[0]!
    assert.equal(params.mode, 'payment')
    assert.equal(params.client_reference_id, 'ps_1')
    assert.equal(params.customer_email, 'buyer@example.com')
    assert.equal(params.success_url, `${INSTANCE}/checkout/cart_1`)
    assert.equal(params.cancel_url, `${INSTANCE}/checkout/cart_1`)
    // One line for the whole order: the amount ShopNex computed, in the smallest unit, lower-case currency
    assert.deepEqual(params.line_items, [
      {
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: 4999, product_data: { name: 'Order #1042' } },
      },
    ])
  })

  test('tags the session and its payment with the ShopNex session, shop and amount', async () => {
    await post('/payments/session', paymentRequest())
    const { params } = sessionCalls[0]!
    const expected = {
      shopnex_session_id: 'ps_1',
      shopnex_instance: INSTANCE,
      shopnex_shop_id: SHOP_ID,
      shopnex_order_id: 'order_1',
      shopnex_amount_cents: '4999',
      shopnex_currency: 'usd',
    }
    assert.deepEqual(params.metadata, expected)
    // The webhook of a failed attempt only has the PaymentIntent: it must carry the same tags
    assert.deepEqual(params.payment_intent_data?.metadata, expected)
  })

  test('retrying the same ShopNex session asks Stripe for the same Checkout Session', async () => {
    await post('/payments/session', paymentRequest())
    await post('/payments/session', paymentRequest())
    assert.equal(sessionCalls[0]!.options.idempotencyKey, 'shopnex-payment-ps_1')
    assert.equal(sessionCalls[1]!.options.idempotencyKey, 'shopnex-payment-ps_1')
    await post('/payments/session', paymentRequest({ id: 'ps_2' }))
    assert.equal(sessionCalls[2]!.options.idempotencyKey, 'shopnex-payment-ps_2')
  })

  test('asks Stripe for an expiry it accepts', async () => {
    await post('/payments/session', paymentRequest({ expiresAt: new Date(Date.now() + 60_000).toISOString() }))
    const expires = sessionCalls[0]!.params.expires_at!
    assert.ok(expires > Math.floor(Date.now() / 1000) + 30 * 60)
  })

  test('what it asks Stripe to collect is what the webhook accepts as paid', async () => {
    await post('/payments/session', paymentRequest({ amount: { cents: 12345, currency: 'EUR' } }))
    const metadata = sessionCalls[0]!.params.metadata
    const paid = { metadata, amount_total: 12345, currency: 'eur' } as unknown as Stripe.Checkout.Session
    assert.equal(amountMismatch(paid), null)
    // …and a short payment is caught
    assert.match(amountMismatch({ ...paid, amount_total: 12000 })!, /expected 12345 eur, Stripe reports 12000 eur/)
  })

  test('answers 502 with the reason when Stripe refuses', async () => {
    stripeError = new Error('Invalid API Key provided')
    const res = await post('/payments/session', paymentRequest())
    assert.equal(res.status, 502)
    assert.deepEqual(await res.json(), { error: 'Invalid API Key provided' })
  })

  test('refuses a request ShopNex did not sign', async () => {
    signatureValid = false
    const res = await post('/payments/session', paymentRequest())
    assert.equal(res.status, 401)
    assert.equal(sessionCalls.length, 0)
  })
})

describe('POST /payments/refund', () => {
  /** The refund runs after the answer: wait for it */
  const settled = async () => {
    for (let i = 0; i < 50 && outcomes.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
  }

  test('answers 202 at once and refunds the payment in the background', async () => {
    const res = await post('/payments/refund', refundRequest())
    assert.equal(res.status, 202)
    await settled()
    assert.equal(refundCalls.length, 1)
    assert.equal(refundCalls[0]!.params.payment_intent, 'pi_123')
    assert.equal(refundCalls[0]!.params.amount, 1500)
    assert.deepEqual(outcomes, ['resolve:rf_1:re_1'])
  })

  test('refuses a request ShopNex did not sign', async () => {
    signatureValid = false
    const res = await post('/payments/refund', refundRequest())
    assert.equal(res.status, 401)
    assert.equal(refundCalls.length, 0)
  })
})

describe('refund', () => {
  test('retrying the same refund asks Stripe for the same refund', async () => {
    await refund(deps, shop, refundRequest())
    await refund(deps, shop, refundRequest())
    assert.equal(refundCalls[0]!.options.idempotencyKey, 'shopnex-refund-rf_1')
    assert.equal(refundCalls[1]!.options.idempotencyKey, 'shopnex-refund-rf_1')
  })

  test('tells ShopNex which session and order the refund is for', async () => {
    await refund(deps, shop, refundRequest())
    assert.deepEqual(refundCalls[0]!.params.metadata, { shopnex_session_id: 'rf_1', shopnex_order_id: 'order_1' })
  })

  for (const status of ['failed', 'canceled']) {
    test(`rejects the refund when Stripe reports it ${status}`, async () => {
      refundResult = { id: 're_1', status }
      await refund(deps, shop, refundRequest())
      assert.deepEqual(outcomes, [`reject:rf_1:Stripe refund ${status}`])
    })
  }

  test('rejects a refund of a payment that has no Stripe payment', async () => {
    await refund(deps, shop, refundRequest({ payment: { sessionId: 'ps_1', externalId: null } as never }))
    assert.equal(refundCalls.length, 0)
    assert.deepEqual(outcomes, ['reject:rf_1:No Stripe payment to refund'])
  })

  test('rejects the refund, with Stripe’s reason, when Stripe errors', async () => {
    stripeError = new Error('Charge has already been refunded')
    await refund(deps, shop, refundRequest())
    assert.deepEqual(outcomes, ['reject:rf_1:Charge has already been refunded'])
  })

  test('does not throw when ShopNex cannot be told either', async () => {
    stripeError = new Error('boom')
    rejectBroken = true
    await assert.doesNotReject(refund(deps, shop, refundRequest()))
  })
})
