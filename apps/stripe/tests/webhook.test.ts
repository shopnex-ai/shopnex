// Stripe webhook handling: signature checks, declines, 3D Secure, delayed methods and duplicate / out-of-order
// deliveries. Events are really signed (Stripe's own test-header helper); Shopnex is a small ledger that answers
// resolve / reject like the payments module does (idempotent; the opposite outcome on a closed session → 409).
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import Stripe from 'stripe'
import { ShopnexError, type ShopContext } from '@shopnex/app'
import { WEBHOOK_EVENTS, ensureWebhookEvents, webhookRoutes } from '../src/webhook'

const INSTANCE = 'https://shop.example.com'
const SHOP_ID = 'shop_1'
const SECRET_KEY = 'sk_test_123'
const WEBHOOK_SECRET = 'whsec_test_123'
const stripe = new Stripe(SECRET_KEY)

type Status = 'pending' | 'resolved' | 'rejected'
let sessions: Map<string, { status: Status; externalId?: string; reason?: string; lastAttemptError?: string }>
let calls: string[]
let shopnexDown: boolean

const shop = {
  instance: INSTANCE,
  shopId: SHOP_ID,
  payments: {
    async resolve(id: string, externalId?: string) {
      calls.push(`resolve:${id}`)
      if (shopnexDown) throw new ShopnexError(503, 'down')
      const s = sessions.get(id)
      if (!s) throw new ShopnexError(404, 'Payment session not found')
      // The money is real: a rejected session still resolves
      if (s.status === 'resolved') return
      Object.assign(s, { status: 'resolved', externalId })
    },
    async attemptFailed(id: string, reason: string) {
      calls.push(`attemptFailed:${id}`)
      if (shopnexDown) throw new ShopnexError(503, 'down')
      const s = sessions.get(id)
      if (!s) throw new ShopnexError(404, 'Payment session not found')
      if (s.status === 'pending') s.lastAttemptError = reason
    },
    async reject(id: string, reason: string) {
      calls.push(`reject:${id}`)
      if (shopnexDown) throw new ShopnexError(503, 'down')
      const s = sessions.get(id)
      if (!s) throw new ShopnexError(404, 'Payment session not found')
      if (s.status === 'resolved') throw new ShopnexError(409, 'This session was already resolved')
      if (s.status === 'pending') Object.assign(s, { status: 'rejected', reason })
    },
  },
} as unknown as ShopContext

let hasSecrets = true
const routes = webhookRoutes({
  forShop: async (instance, shopId) => {
    if (instance !== INSTANCE || shopId !== SHOP_ID) throw new Error('not installed')
    return shop
  },
  secrets: async () => ({
    secretKey: hasSecrets ? SECRET_KEY : null,
    webhookSecret: hasSecrets ? WEBHOOK_SECRET : null,
  }),
})

let seq = 0
function event(
  type: string,
  session: Partial<Stripe.Checkout.Session> & { metadata?: Record<string, string> },
  eventId = `evt_${++seq}`,
) {
  return {
    id: eventId,
    object: 'event',
    type,
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        payment_intent: 'pi_1',
        payment_status: 'unpaid',
        ...session,
        metadata: {
          shopnex_session_id: 'ps_1',
          shopnex_instance: INSTANCE,
          shopnex_shop_id: SHOP_ID,
          ...session.metadata,
        },
      },
    },
  }
}

async function deliver(payload: object, opts: { query?: string; signWith?: string; signature?: string | null } = {}) {
  const body = JSON.stringify(payload)
  const signature =
    opts.signature === undefined
      ? stripe.webhooks.generateTestHeaderString({ payload: body, secret: opts.signWith ?? WEBHOOK_SECRET })
      : opts.signature
  return routes.request(`/stripe/webhook?${opts.query ?? `instance=${INSTANCE}&shop=${SHOP_ID}`}`, {
    method: 'POST',
    body,
    headers: signature ? { 'stripe-signature': signature } : {},
  })
}

// A PaymentIntent event: it carries the metadata copied from the Checkout Session (payment_intent_data.metadata)
const declined = (message: string | undefined) => ({
  id: `evt_${++seq}`,
  object: 'event',
  type: 'payment_intent.payment_failed',
  data: {
    object: {
      id: 'pi_1',
      object: 'payment_intent',
      last_payment_error: message ? { message } : null,
      metadata: { shopnex_session_id: 'ps_1', shopnex_instance: INSTANCE, shopnex_shop_id: SHOP_ID } as Record<
        string,
        string
      >,
    },
  },
})

const paid = (extra = {}) => event('checkout.session.completed', { payment_status: 'paid', ...extra })
const state = (id = 'ps_1') => sessions.get(id)!

beforeEach(() => {
  sessions = new Map([['ps_1', { status: 'pending' }]])
  calls = []
  shopnexDown = false
  hasSecrets = true
})

describe('webhook authenticity', () => {
  test('a missing signature, a wrong secret and a tampered body are all rejected without touching payments', async () => {
    assert.equal((await deliver(paid(), { signature: null })).status, 400)
    assert.equal((await deliver(paid(), { signWith: 'whsec_someone_else' })).status, 400)
    const body = JSON.stringify(paid())
    const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET })
    const tampered = await routes.request(`/stripe/webhook?instance=${INSTANCE}&shop=${SHOP_ID}`, {
      method: 'POST',
      body: body.replace('ps_1', 'ps_2'),
      headers: { 'stripe-signature': signature },
    })
    assert.equal(tampered.status, 400)
    assert.deepEqual(calls, [])
  })

  test('an old (replayed) signature is rejected', async () => {
    const body = JSON.stringify(paid())
    const timestamp = Math.floor(Date.now() / 1000) - 3600
    const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET, timestamp })
    assert.equal((await deliver(paid(), { signature })).status, 400)
    assert.deepEqual(calls, [])
  })

  test('unknown shops and shops without Stripe set up are refused', async () => {
    assert.equal((await deliver(paid(), { query: `instance=${INSTANCE}&shop=other` })).status, 400)
    assert.equal((await deliver(paid(), { query: 'shop=shop_1' })).status, 400)
    hasSecrets = false
    assert.equal((await deliver(paid())).status, 400)
    assert.deepEqual(calls, [])
  })

  test("events for another shop's or another system's sessions are ignored", async () => {
    for (const metadata of [{ shopnex_shop_id: 'shop_2' }, { shopnex_instance: 'https://evil.example.com' }]) {
      assert.equal((await deliver(paid({ metadata }))).status, 204)
    }
    assert.equal(
      (
        await deliver(
          event('checkout.session.completed', { payment_status: 'paid', metadata: { shopnex_session_id: '' } }),
        )
      ).status,
      204,
    )
    assert.deepEqual(calls, [])
    assert.equal(state().status, 'pending')
  })

  test('other event types are acknowledged and ignored', async () => {
    assert.equal((await deliver(event('charge.refunded', {}))).status, 204)
    assert.deepEqual(calls, [])
  })
})

describe('successful payment', () => {
  test('a paid Checkout resolves the session with the PaymentIntent id', async () => {
    assert.equal((await deliver(paid())).status, 204)
    assert.deepEqual(state(), { status: 'resolved', externalId: 'pi_1' })
  })

  test('an expanded payment_intent object resolves the same way', async () => {
    await deliver(paid({ payment_intent: { id: 'pi_expanded' } as Stripe.PaymentIntent }))
    assert.equal(state().externalId, 'pi_expanded')
  })
})

describe('duplicate and out-of-order deliveries', () => {
  test('the same event delivered three times (Stripe retry) settles the order once', async () => {
    const e = paid()
    const statuses = [await deliver(e), await deliver(e), await deliver(e)].map((r) => r.status)
    assert.deepEqual(statuses, [204, 204, 204])
    assert.deepEqual(state(), { status: 'resolved', externalId: 'pi_1' })
  })

  test('concurrent duplicates all succeed and the session ends resolved', async () => {
    const e = paid()
    const responses = await Promise.all([deliver(e), deliver(e), deliver(e), deliver(e)])
    assert.ok(responses.every((r) => r.status === 204))
    assert.equal(state().status, 'resolved')
  })

  test('two different events for one payment (completed + async succeeded) resolve once', async () => {
    await deliver(paid())
    await deliver(event('checkout.session.async_payment_succeeded', { payment_status: 'paid' }))
    assert.equal(state().status, 'resolved')
  })

  test('a late expiry event after payment is acknowledged and never un-pays the order', async () => {
    await deliver(paid())
    const res = await deliver(event('checkout.session.expired', {}))
    assert.equal(res.status, 204)
    assert.equal(state().status, 'resolved')
  })

  test('payment arriving after the session was rejected still marks it paid (the money is real)', async () => {
    await deliver(event('checkout.session.expired', {}))
    assert.equal(state().status, 'rejected')
    const res = await deliver(paid())
    assert.equal(res.status, 204)
    assert.deepEqual(state(), { status: 'resolved', externalId: 'pi_1', reason: 'Checkout expired without payment' })
  })

  test('a PAID event for a session Shopnex does not have fails loudly so Stripe retries (never dropped)', async () => {
    sessions.clear()
    assert.equal((await deliver(paid())).status, 500)
    assert.equal(
      (await deliver(event('checkout.session.async_payment_succeeded', { payment_status: 'paid' }))).status,
      500,
    )
  })

  test('…and succeeds once the session is there (the retry)', async () => {
    const e = paid()
    sessions.clear()
    assert.equal((await deliver(e)).status, 500)
    sessions.set('ps_1', { status: 'pending' })
    assert.equal((await deliver(e)).status, 204)
    assert.equal(state().status, 'resolved')
  })

  test('an unpaid completion, expiry, failure or decline for a missing session is acknowledged', async () => {
    sessions.clear()
    for (const e of [
      event('checkout.session.completed', { payment_status: 'unpaid' }),
      event('checkout.session.expired', {}),
      event('checkout.session.async_payment_failed', {}),
      declined('Your card was declined.'),
    ]) {
      assert.equal((await deliver(e)).status, 204)
    }
  })
})

describe('declines', () => {
  test('a declined card records the reason but keeps the session open for a retry', async () => {
    const res = await deliver(declined('Your card was declined.'))
    assert.equal(res.status, 204)
    assert.deepEqual(calls, ['attemptFailed:ps_1'])
    assert.deepEqual(state(), { status: 'pending', lastAttemptError: 'Your card was declined.' })
  })

  test('a decline without a message still records a reason', async () => {
    await deliver(declined(undefined))
    assert.equal(state().lastAttemptError, 'The payment attempt failed')
  })

  test('a failed 3D Secure authentication is a decline too: open, with the reason', async () => {
    await deliver(declined('We are unable to authenticate your payment method.'))
    assert.deepEqual(state(), {
      status: 'pending',
      lastAttemptError: 'We are unable to authenticate your payment method.',
    })
  })

  test('several declines in a row, then success: paid', async () => {
    await deliver(declined('Your card was declined.'))
    await deliver(declined('Your card has insufficient funds.'))
    assert.equal(state().lastAttemptError, 'Your card has insufficient funds.')
    await deliver(paid())
    assert.equal(state().status, 'resolved')
  })

  test('a duplicate decline event is harmless', async () => {
    const e = declined('Your card was declined.')
    assert.equal((await deliver(e)).status, 204)
    assert.equal((await deliver(e)).status, 204)
    assert.equal(state().status, 'pending')
  })

  test('a late decline never reopens or changes a paid session', async () => {
    await deliver(paid())
    assert.equal((await deliver(declined('Your card was declined.'))).status, 204)
    assert.deepEqual(state(), { status: 'resolved', externalId: 'pi_1' })
  })

  test("a decline for someone else's PaymentIntent is ignored", async () => {
    const e = declined('Your card was declined.')
    e.data.object.metadata = {}
    assert.equal((await deliver(e)).status, 204)
    assert.deepEqual(calls, [])
  })

  test('a decline answers 5xx while Shopnex is down so Stripe retries', async () => {
    shopnexDown = true
    assert.equal((await deliver(declined('Your card was declined.'))).status, 503)
  })

  test('declined events need a valid signature', async () => {
    assert.equal((await deliver(declined('x'), { signWith: 'whsec_other' })).status, 400)
    assert.deepEqual(calls, [])
  })

  test('decline, then the buyer walks away: the expiry rejects the session so the order can be retried or cancelled', async () => {
    await deliver(declined('Your card was declined.'))
    assert.equal((await deliver(event('checkout.session.expired', {}))).status, 204)
    assert.deepEqual(state(), {
      status: 'rejected',
      lastAttemptError: 'Your card was declined.',
      reason: 'Checkout expired without payment',
    })
  })

  test('a delayed payment that fails (bank debit) rejects the session', async () => {
    await deliver(event('checkout.session.completed', { payment_status: 'unpaid' }))
    assert.equal(state().status, 'pending')
    await deliver(event('checkout.session.async_payment_failed', {}))
    assert.deepEqual(state(), { status: 'rejected', reason: 'The payment failed' })
  })

  test('a duplicate failure event keeps the session rejected', async () => {
    const e = event('checkout.session.async_payment_failed', {})
    await deliver(e)
    assert.equal((await deliver(e)).status, 204)
    assert.equal(state().status, 'rejected')
  })
})

describe('3D Secure and delayed payments', () => {
  test('a Checkout completed before the money is confirmed (payment_status unpaid) does NOT mark the order paid', async () => {
    assert.equal((await deliver(event('checkout.session.completed', { payment_status: 'unpaid' }))).status, 204)
    assert.deepEqual(calls, [])
    assert.equal(state().status, 'pending')
  })

  test('…until the delayed payment succeeds', async () => {
    await deliver(event('checkout.session.completed', { payment_status: 'unpaid' }))
    await deliver(event('checkout.session.async_payment_succeeded', { payment_status: 'paid' }))
    assert.deepEqual(state(), { status: 'resolved', externalId: 'pi_1' })
  })

  test('no_payment_required completions do not resolve a payment', async () => {
    await deliver(event('checkout.session.completed', { payment_status: 'no_payment_required' }))
    assert.equal(state().status, 'pending')
  })

  test('an abandoned 3DS challenge (never completed) ends in expiry → rejected', async () => {
    // Nothing arrives while the buyer is on the bank's page; only the expiry does
    await deliver(event('checkout.session.expired', {}))
    assert.equal(state().status, 'rejected')
  })

  test('3DS completing after the expiry was processed (events out of order) still marks the order paid', async () => {
    await deliver(event('checkout.session.expired', {}))
    const res = await deliver(paid())
    assert.equal(res.status, 204)
    assert.equal(state().status, 'resolved')
  })
})

describe('Shopnex unavailable', () => {
  test('the webhook answers 5xx so Stripe retries, and the retry then settles the order', async () => {
    shopnexDown = true
    const e = paid()
    assert.equal((await deliver(e)).status, 503)
    assert.equal(state().status, 'pending')
    shopnexDown = false
    assert.equal((await deliver(e)).status, 204)
    assert.equal(state().status, 'resolved')
  })
})

describe('webhook endpoint events', () => {
  // A Stripe client with one stored endpoint
  function fakeStripe(enabled: string[]) {
    const updates: string[][] = []
    const client = {
      webhookEndpoints: {
        retrieve: async () => ({ enabled_events: enabled }),
        update: async (_id: string, params: { enabled_events: string[] }) => void updates.push(params.enabled_events),
      },
    } as unknown as Stripe
    return { client, updates }
  }

  test('an endpoint from an older version gets the missing events and keeps the merchant’s own', async () => {
    const old = [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
      'invoice.paid',
    ]
    const { client, updates } = fakeStripe(old)
    assert.equal(await ensureWebhookEvents(client, 'we_1'), true)
    assert.equal(updates.length, 1)
    for (const e of [...WEBHOOK_EVENTS, 'invoice.paid']) assert.ok(updates[0]!.includes(e), e)
    assert.equal(new Set(updates[0]).size, updates[0]!.length, 'no duplicates')
  })

  test('an up-to-date endpoint is left alone', async () => {
    const { client, updates } = fakeStripe([...WEBHOOK_EVENTS])
    assert.equal(await ensureWebhookEvents(client, 'we_1'), false)
    assert.deepEqual(updates, [])
  })

  test('an endpoint that listens to everything is left alone', async () => {
    const { client, updates } = fakeStripe(['*'])
    assert.equal(await ensureWebhookEvents(client, 'we_1'), false)
    assert.deepEqual(updates, [])
  })

  test('the app subscribes to the decline event', () => {
    assert.ok(WEBHOOK_EVENTS.includes('payment_intent.payment_failed'))
  })
})
