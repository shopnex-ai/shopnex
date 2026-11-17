// The payment sessions of an order through a payments app, on a real in-memory database and a fake app on localhost:
// starting (and reusing, and replacing) a session, the app resolving, rejecting or failing an attempt, refunds, and expiry.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { appInstallations } from '@shopnex/apps/schema'

const fx = await import('./fixtures')
const { db, schema, SHOP, behavior, received } = fx
const { paymentMethods, paymentSessions } = await import('../src/payments.schema')
const { bindConn } = await import('@shopnex/kit')
const sessions = bindConn(await import('../src/sessions'), db)
const { PaymentError } = await import('../src/payments.errors')
const { eq } = await import('drizzle-orm')

const returnUrl = 'https://shop.test/thanks'
const refused = (code: string) => (e: unknown) => e instanceof PaymentError && e.code === code
const orderRow = async (id: string) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0]!
const transactionsOf = (orderId: string) =>
  db.select().from(schema.orderTransactions).where(eq(schema.orderTransactions.orderId, orderId))
const inThePast = () => new Date(Date.now() - 60_000)

before(async () => {
  await fx.prepareDatabase()
  await fx.startFakeApp()
})
beforeEach(async () => {
  await fx.cleanup()
  fx.resetFakeApp()
})
after(async () => {
  await fx.cleanup()
  await fx.stopFakeApp()
})

describe('starting a payment', () => {
  test('creates a pending session for the order total, asks the app with a signed request and keeps the redirect URL', async () => {
    const { method } = await fx.paymentsApp()
    const o = await fx.order()
    const session = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id })
    assert.equal(session.status, 'pending')
    assert.equal(session.kind, 'payment')
    assert.equal(session.amountCents, 2500)
    assert.equal(session.currency, 'USD')
    assert.equal(session.paymentMethodId, method.id)
    assert.equal(session.redirectUrl, `https://pay.example/checkout/${session.id}`)
    const minutes = (session.expiresAt.getTime() - Date.now()) / 60_000
    assert.ok(minutes > 59 && minutes <= 60, `the buyer has an hour, got ${minutes} minutes`)

    assert.equal(received.length, 1)
    assert.equal(received[0]!.path, '/pay')
    assert.deepEqual(received[0]!.body, {
      kind: 'payment',
      id: session.id,
      instance: 'http://shop.test',
      shopId: SHOP,
      orderId: o.id,
      orderNumber: o.orderNumber,
      amount: { cents: 2500, currency: 'USD' },
      customer: { email: o.email, name: null },
      returnUrl,
      expiresAt: session.expiresAt.toISOString(),
    })
    assert.ok(
      Object.keys(received[0]!.headers).some((h) => /signature/i.test(h)),
      'the request is signed',
    )
  })

  test('a second call, or the buyer back from the provider, gets the same session and no second request', async () => {
    const { method } = await fx.paymentsApp()
    const o = await fx.order()
    const first = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id })
    const again = await sessions.startPayment(SHOP, o.id, { returnUrl })
    assert.equal(again.id, first.id)
    assert.equal(received.length, 1)
  })

  test('another method, or a session about to expire, starts a fresh one and the old one is expired', async () => {
    const a = await fx.paymentsApp({ name: 'First' })
    const b = await fx.paymentsApp({ name: 'Second' })
    const o = await fx.order()
    const first = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: a.method.id })
    const second = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: b.method.id })
    assert.notEqual(second.id, first.id)
    assert.equal(second.paymentMethodId, b.method.id)
    const old = await fx.sessionOf(first.id)
    assert.equal(old?.status, 'expired')
    assert.equal(old?.errorMessage, 'Replaced by a new payment attempt')

    await db
      .update(paymentSessions)
      .set({ expiresAt: new Date(Date.now() + 5 * 60_000) })
      .where(eq(paymentSessions.id, second.id))
    const third = await sessions.startPayment(SHOP, o.id, { returnUrl })
    assert.notEqual(third.id, second.id)
    assert.equal(third.paymentMethodId, b.method.id, 'the method of the last attempt is the default')
  })

  test('an order that is cancelled, already paid or unknown cannot be paid', async () => {
    const { method } = await fx.paymentsApp()
    const cancelled = await fx.order({ cancelledAt: new Date() })
    const paid = await fx.order({ financialStatus: 'paid' })
    for (const id of [cancelled.id, paid.id, '00000000-0000-4000-8000-000000000000']) {
      await assert.rejects(
        sessions.startPayment(SHOP, id, { returnUrl, paymentMethodId: method.id }),
        refused('NOT_PAYABLE'),
      )
    }
    assert.equal(received.length, 0)
  })

  test('a method that is gone, inactive, not ready, manual or of an app that was uninstalled is no longer available', async () => {
    const o = await fx.order()
    const inactive = await fx.paymentsApp({ active: false })
    const notReady = await fx.paymentsApp({ ready: false })
    const uninstalled = await fx.paymentsApp({ installed: false })
    const [manual] = await db
      .insert(paymentMethods)
      .values({ shopId: SHOP, provider: 'manual', name: 'Bank transfer' })
      .returning()
    for (const id of [
      inactive.method.id,
      notReady.method.id,
      uninstalled.method.id,
      manual!.id,
      '00000000-0000-4000-8000-000000000000',
    ]) {
      await assert.rejects(
        sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: id }),
        (e: unknown) => refused('NOT_PAYABLE')(e) && /no longer available/.test((e as Error).message),
      )
    }
    await assert.rejects(sessions.startPayment(SHOP, o.id, { returnUrl }), refused('NOT_PAYABLE'))
    assert.equal(received.length, 0)
  })

  test('an app that is down, or answers without a redirect URL, is PROVIDER_UNAVAILABLE and the session is rejected', async () => {
    const { method } = await fx.paymentsApp()
    for (const mode of ['fail', 'no-redirect'] as const) {
      behavior.pay = mode
      const o = await fx.order()
      await assert.rejects(
        sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id }),
        refused('PROVIDER_UNAVAILABLE'),
      )
      const latest = await sessions.latestPayment(SHOP, o.id)
      assert.equal(latest?.status, 'rejected')
      assert.match(latest?.errorMessage ?? '', /^Payments app unavailable: /)
    }
  })

  test('latestPayment is the newest attempt of the order, or null', async () => {
    const { method } = await fx.paymentsApp()
    const o = await fx.order()
    assert.equal(await sessions.latestPayment(SHOP, o.id), null)
    const first = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id })
    assert.equal((await sessions.latestPayment(SHOP, o.id))?.id, first.id)
    assert.equal(await sessions.latestPayment('some-other-shop', o.id), null)
  })
})

describe('the app resolving a payment', () => {
  async function started() {
    const { app, method } = await fx.paymentsApp()
    const o = await fx.order()
    const session = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id })
    return { app, o, session }
  }

  test('marks the order paid with a successful sale of the session amount, and the session resolved', async () => {
    const { app, o, session } = await started()
    const resolved = await sessions.resolve(SHOP, app.id, session.id, { externalId: 'pi_123' })
    assert.equal(resolved.status, 'resolved')
    assert.equal(resolved.externalId, 'pi_123')
    assert.ok(resolved.resolvedAt)
    assert.equal((await orderRow(o.id)).financialStatus, 'paid')
    const [sale] = await transactionsOf(o.id)
    assert.equal(sale?.kind, 'sale')
    assert.equal(sale?.status, 'success')
    assert.equal(sale?.gateway, 'app')
    assert.equal(sale?.amountCents, 2500)
    assert.equal(sale?.externalId, 'pi_123')
    assert.equal(resolved.transactionId, sale?.id)
  })

  test('is idempotent: resolving again changes nothing and adds no second sale', async () => {
    const { app, o, session } = await started()
    const first = await sessions.resolve(SHOP, app.id, session.id, { externalId: 'pi_1' })
    const again = await sessions.resolve(SHOP, app.id, session.id, { externalId: 'pi_other' })
    assert.equal(again.externalId, first.externalId)
    assert.equal((await transactionsOf(o.id)).length, 1)
  })

  test('a late provider event still counts: an expired or rejected session resolves and the order is paid', async () => {
    for (const status of ['expired', 'rejected'] as const) {
      const { app, o, session } = await started()
      await db.update(paymentSessions).set({ status }).where(eq(paymentSessions.id, session.id))
      const resolved = await sessions.resolve(SHOP, app.id, session.id, {})
      assert.equal(resolved.status, 'resolved')
      assert.equal((await orderRow(o.id)).financialStatus, 'paid', status)
    }
  })

  test('only the app and the shop of the session can reach it', async () => {
    const { app, session } = await started()
    const { app: other } = await fx.paymentsApp({ name: 'Another app' })
    await assert.rejects(sessions.resolve(SHOP, other.id, session.id, {}), refused('SESSION_NOT_FOUND'))
    await assert.rejects(sessions.resolve('some-other-shop', app.id, session.id, {}), refused('SESSION_NOT_FOUND'))
    await assert.rejects(sessions.get(SHOP, other.id, session.id), refused('SESSION_NOT_FOUND'))
    assert.equal((await sessions.get(SHOP, app.id, session.id)).id, session.id)
  })
})

describe('the app rejecting a payment or reporting a failed attempt', () => {
  test('reject closes a pending session with the reason, is idempotent, and cannot undo a resolved one', async () => {
    const { app, method } = await fx.paymentsApp()
    const o = await fx.order()
    const session = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id })
    const rejected = await sessions.reject(SHOP, app.id, session.id, { reason: 'Card declined' })
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.errorMessage, 'Card declined')
    assert.equal((await sessions.reject(SHOP, app.id, session.id, { reason: 'Again' })).errorMessage, 'Card declined')
    assert.equal((await orderRow(o.id)).financialStatus, 'pending')

    const o2 = await fx.order()
    const paying = await sessions.startPayment(SHOP, o2.id, { returnUrl, paymentMethodId: method.id })
    await sessions.resolve(SHOP, app.id, paying.id, {})
    await assert.rejects(sessions.reject(SHOP, app.id, paying.id, { reason: 'Too late' }), refused('SESSION_CLOSED'))
  })

  test('attemptFailed keeps the session open with the reason so the buyer can retry on the same page', async () => {
    const { app, method } = await fx.paymentsApp()
    const o = await fx.order()
    const session = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id })
    const failed = await sessions.attemptFailed(SHOP, app.id, session.id, { reason: 'Insufficient funds' })
    assert.equal(failed.status, 'pending')
    assert.equal(failed.errorMessage, 'Insufficient funds')
    await sessions.reject(SHOP, app.id, session.id, { reason: 'Gave up' })
    const closed = await sessions.attemptFailed(SHOP, app.id, session.id, { reason: 'Ignored' })
    assert.equal(closed.errorMessage, 'Gave up')
  })
})

describe('refunds', () => {
  async function paidOrder() {
    const { app, method } = await fx.paymentsApp()
    const o = await fx.order()
    const payment = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id })
    await sessions.resolve(SHOP, app.id, payment.id, { externalId: 'pi_paid' })
    const [refund] = await db
      .insert(schema.orderTransactions)
      .values({
        orderId: o.id,
        kind: 'refund',
        status: 'pending',
        gateway: 'fakepay',
        amountCents: 1000,
        currency: 'USD',
      })
      .returning()
    received.length = 0
    return { app, o, payment, refund: refund! }
  }

  test('a pending refund is sent to the app that took the payment, with the payment it refunds', async () => {
    const { o, payment, refund } = await paidOrder()
    await sessions.startRefunds(SHOP, o.id)
    assert.equal(received.length, 1)
    assert.equal(received[0]!.path, '/refund')
    assert.equal(received[0]!.body.kind, 'refund')
    assert.deepEqual(received[0]!.body.amount, { cents: 1000, currency: 'USD' })
    assert.deepEqual(received[0]!.body.payment, { sessionId: payment.id, externalId: 'pi_paid' })
    const [session] = await db.select().from(paymentSessions).where(eq(paymentSessions.transactionId, refund.id))
    assert.equal(session?.kind, 'refund')
    assert.equal(session?.status, 'pending')
    // Sent once: asking again does not send it twice
    await sessions.startRefunds(SHOP, o.id)
    assert.equal(received.length, 1)
  })

  test('the app resolving the refund marks it successful and the order refunded once everything taken is back', async () => {
    const { app, o, refund } = await paidOrder()
    await db
      .update(schema.orderTransactions)
      .set({ amountCents: 2500 })
      .where(eq(schema.orderTransactions.id, refund.id))
    await sessions.startRefunds(SHOP, o.id)
    const [session] = await db.select().from(paymentSessions).where(eq(paymentSessions.transactionId, refund.id))
    await sessions.resolve(SHOP, app.id, session!.id, { externalId: 're_1' })
    const [after] = await db.select().from(schema.orderTransactions).where(eq(schema.orderTransactions.id, refund.id))
    assert.equal(after?.status, 'success')
    assert.equal((await orderRow(o.id)).financialStatus, 'refunded')
  })

  test('an app that is down fails the refund for staff to do by hand; so does an app that is no longer installed', async () => {
    const down = await paidOrder()
    behavior.refund = 'fail'
    await sessions.startRefunds(SHOP, down.o.id)
    const [failed] = await db
      .select()
      .from(schema.orderTransactions)
      .where(eq(schema.orderTransactions.id, down.refund.id))
    assert.equal(failed?.status, 'failure')
    assert.match(failed?.errorMessage ?? '', /^Payments app unavailable: /)
    const [refundSession] = await db
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.transactionId, down.refund.id))
    assert.equal(refundSession?.status, 'rejected')

    behavior.refund = 'ok'
    const gone = await paidOrder()
    await db.update(appInstallations).set({ uninstalledAt: new Date() }).where(eq(appInstallations.appId, gone.app.id))
    await sessions.startRefunds(SHOP, gone.o.id)
    const [lost] = await db
      .select()
      .from(schema.orderTransactions)
      .where(eq(schema.orderTransactions.id, gone.refund.id))
    assert.equal(lost?.status, 'failure')
    assert.match(lost?.errorMessage ?? '', /no longer installed/)
    assert.equal(received.length, 0, 'an app that is no longer installed is not asked')
  })

  test('the app rejecting a refund marks its transaction failed with the reason', async () => {
    const { app, o, refund } = await paidOrder()
    await sessions.startRefunds(SHOP, o.id)
    const [session] = await db.select().from(paymentSessions).where(eq(paymentSessions.transactionId, refund.id))
    await sessions.reject(SHOP, app.id, session!.id, { reason: 'Refund window closed' })
    const [after] = await db.select().from(schema.orderTransactions).where(eq(schema.orderTransactions.id, refund.id))
    assert.equal(after?.status, 'failure')
    assert.equal(after?.errorMessage, 'Refund window closed')
  })
})

describe('expiry', () => {
  test('a pending session past its time expires, one with time left does not, and an unpaid order with no open attempt is cancelled', async () => {
    const { method } = await fx.paymentsApp()
    const late = await fx.order()
    const fresh = await fx.order()
    const lateSession = await sessions.startPayment(SHOP, late.id, { returnUrl, paymentMethodId: method.id })
    const freshSession = await sessions.startPayment(SHOP, fresh.id, { returnUrl, paymentMethodId: method.id })
    await db.update(paymentSessions).set({ expiresAt: inThePast() }).where(eq(paymentSessions.id, lateSession.id))

    const handled = await sessions.expireDue(undefined)
    assert.ok(handled >= 2, `a session and an order were handled, got ${handled}`)
    const expired = await fx.sessionOf(lateSession.id)
    assert.equal(expired?.status, 'expired')
    assert.equal(expired?.errorMessage, 'Not completed in time')
    assert.equal((await fx.sessionOf(freshSession.id))?.status, 'pending')
    assert.ok((await orderRow(late.id)).cancelledAt, 'the unpaid order is cancelled')
    assert.equal((await orderRow(fresh.id)).cancelledAt, null)
  })

  test('a refund the app never confirmed ends as an error on its transaction', async () => {
    const { app, method } = await fx.paymentsApp()
    const o = await fx.order()
    const payment = await sessions.startPayment(SHOP, o.id, { returnUrl, paymentMethodId: method.id })
    await sessions.resolve(SHOP, app.id, payment.id, {})
    const [refund] = await db
      .insert(schema.orderTransactions)
      .values({
        orderId: o.id,
        kind: 'refund',
        status: 'pending',
        gateway: 'fakepay',
        amountCents: 500,
        currency: 'USD',
      })
      .returning()
    await sessions.startRefunds(SHOP, o.id)
    await db
      .update(paymentSessions)
      .set({ expiresAt: inThePast() })
      .where(eq(paymentSessions.transactionId, refund!.id))
    await sessions.expireDue(undefined)
    const [after] = await db.select().from(schema.orderTransactions).where(eq(schema.orderTransactions.id, refund!.id))
    assert.equal(after?.status, 'error')
    assert.equal(after?.errorMessage, 'The payments app never confirmed this refund')
  })
})
