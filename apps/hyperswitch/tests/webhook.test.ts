// Webhook handling: Prism verifies the (really signed) Stripe event, the app resolves / rejects the Shopnex session.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { beforeEach, describe, test } from 'node:test'
import { ShopnexError, type ShopContext } from '@shopnex/app'
import { webhookRoutes } from '../src/webhook'

const INSTANCE = 'https://shop.example.com'
const SECRET = 'whsec_test_123'
let calls: string[]
let known: boolean

const shop = {
  instance: INSTANCE,
  shopId: 'shop_1',
  payments: {
    async resolve(id: string, externalId?: string) {
      calls.push(`resolve:${id}:${externalId}`)
    },
    async reject(id: string, reason: string) {
      calls.push(`reject:${id}:${reason}`)
      if (!known) throw new ShopnexError(404, 'not found')
    },
  },
} as unknown as ShopContext

const routes = webhookRoutes({
  forShop: async () => shop,
  secrets: async () => ({
    credentials: { connector: 'stripe', testMode: true, values: { apiKey: 'sk_test_123' } },
    webhookSecret: SECRET,
  }),
  sessionFor: (_shop, txn) => (txn === 'pi_1' ? 'sess_1' : null),
})

function signed(event: object, secret = SECRET) {
  const body = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return { body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` } }
}
const succeeded = (id: string) => ({
  id: 'evt_1',
  object: 'event',
  api_version: '2023-10-16',
  created: 1700000000,
  type: 'payment_intent.succeeded',
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  data: {
    object: {
      id,
      object: 'payment_intent',
      amount: 1000,
      amount_received: 1000,
      amount_capturable: 0,
      currency: 'usd',
      status: 'succeeded',
      created: 1700000000,
      capture_method: 'automatic',
      confirmation_method: 'automatic',
      livemode: false,
      latest_charge: 'ch_1',
      payment_method: 'pm_1',
      payment_method_types: ['card'],
      metadata: {},
      last_payment_error: null,
    },
  },
})
const post = (payload: { body: string; headers: Record<string, string> }, query = `instance=${INSTANCE}&shop=shop_1`) =>
  routes.request(`/hyperswitch/webhook?${query}`, { method: 'POST', body: payload.body, headers: payload.headers })

describe('hyperswitch webhook', () => {
  beforeEach(() => {
    calls = []
    known = true
  })

  test('a signed success event resolves the session', async () => {
    const res = await post(signed(succeeded('pi_1')))
    assert.equal(res.status, 204)
    assert.deepEqual(calls, ['resolve:sess_1:pi_1'])
  })

  test('a wrong signature is rejected and touches nothing', async () => {
    const res = await post(signed(succeeded('pi_1'), 'whsec_other'))
    assert.equal(res.status, 400)
    assert.deepEqual(calls, [])
  })

  test("a payment that isn't ours is ignored", async () => {
    const res = await post(signed(succeeded('pi_other')))
    assert.equal(res.status, 204)
    assert.deepEqual(calls, [])
  })

  test('an unknown shop is a 400', async () => {
    assert.equal((await post(signed(succeeded('pi_1')), '')).status, 400)
  })
})
