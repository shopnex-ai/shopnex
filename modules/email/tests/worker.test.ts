// The worker that sends the queued emails: what it sends and marks sent, what it retries and when, when it gives up, what it drops
// (email turned off, a checkout completed or unsubscribed meanwhile), and that two passes never send one email twice.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, eq, SHOP, behavior, received } = fx
const { processDue } = await import('../src/worker')
const { abandonedCartService } = await import('../src')

before(async () => {
  await fx.prepareDatabase()
  await fx.startSmtp()
})
beforeEach(async () => {
  await fx.cleanup()
  fx.resetSmtp()
  await fx.turnOn()
})
after(async () => {
  await fx.cleanup()
  await fx.stopSmtp()
})

async function queued(patch: Partial<typeof schema.emailDeliveries.$inferInsert> = {}) {
  const o = await fx.order()
  const [row] = await db
    .insert(schema.emailDeliveries)
    .values({
      shopId: SHOP,
      notification: 'order_confirmation',
      orderId: o.id,
      to: 'buyer@example.test',
      subject: 'Thanks',
      html: '<p>hi</p>',
      ...patch,
    })
    .returning()
  return row!
}
const row = async (id: string) =>
  (await db.select().from(schema.emailDeliveries).where(eq(schema.emailDeliveries.id, id)))[0]!

describe('sending what is due', () => {
  test('sends it through the shop’s server and marks it sent, with one attempt', async () => {
    const d = await queued()
    assert.equal(await processDue(), 1)
    assert.deepEqual([received.length, received[0]?.to, received[0]?.subject], [1, ['buyer@example.test'], 'Thanks'])
    const after = await row(d.id)
    assert.deepEqual([after.status, after.attempts, after.lastError], ['sent', 1, null])
    assert.ok(after.lastAttemptAt)
  })

  test('only what is pending and due: sent, failed and skipped ones, and ones for later, are left alone', async () => {
    for (const status of ['sent', 'failed', 'skipped'] as const) await queued({ status, to: `${status}@example.test` })
    await queued({ nextAttemptAt: new Date(Date.now() + 3_600_000), to: 'later@example.test' })
    assert.equal(await processDue(), 0)
    assert.equal(received.length, 0)
  })

  test('at most ten a pass, the earliest due first', async () => {
    for (let i = 0; i < 12; i++)
      await queued({ to: `b${i}@example.test`, nextAttemptAt: new Date(Date.now() - (20 - i) * 1000) })
    assert.equal(await processDue(), 10)
    assert.equal(received[0]?.to[0], 'b0@example.test')
    assert.equal(await processDue(), 2)
  })

  test('a row that was claimed is not claimed again by the next pass (it is leased for two minutes)', async () => {
    const d = await queued()
    const [first, second] = await Promise.all([processDue(), processDue()])
    assert.equal(first + second, 1)
    assert.equal(received.length, 1)
    assert.equal((await row(d.id)).attempts, 1)
  })
})

describe('when sending fails', () => {
  test('it is tried again later, with the error kept, on a growing delay: 1, 5, 30 minutes, 2 and 3 hours', async () => {
    behavior.rejectRecipients = true
    const d = await queued()
    const delays = [60, 300, 1800, 7200, 10_800]
    for (const [i, seconds] of delays.entries()) {
      await db
        .update(schema.emailDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(schema.emailDeliveries.id, d.id))
      const before = Date.now()
      await processDue()
      const after = await row(d.id)
      assert.deepEqual([after.status, after.attempts], ['pending', i + 1])
      assert.match(after.lastError ?? '', /Could not send "Thanks"/)
      const waited = (after.nextAttemptAt.getTime() - before) / 1000
      assert.ok(
        Math.abs(waited - seconds) < 5,
        `attempt ${String(i + 1)} waits about ${String(seconds)}s, not ${String(waited)}s`,
      )
    }
  })

  test('the sixth failure is final: failed, never tried again', async () => {
    behavior.rejectRecipients = true
    const d = await queued({ attempts: 5 })
    await processDue()
    assert.deepEqual([(await row(d.id)).status, (await row(d.id)).attempts], ['failed', 6])
    assert.equal(await processDue(), 0)
  })

  test('a server that cannot be reached is a failed attempt too, and a later pass can still send it', async () => {
    await fx.turnOn({ config: fx.smtpConfig({ port: 1 }) })
    const d = await queued()
    await processDue()
    assert.equal((await row(d.id)).status, 'pending')
    await fx.turnOn()
    await db
      .update(schema.emailDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(schema.emailDeliveries.id, d.id))
    await processDue()
    assert.deepEqual([(await row(d.id)).status, received.length], ['sent', 1])
  })
})

describe('what is dropped, not retried', () => {
  test('email turned off since it was queued: skipped, with the reason', async () => {
    const d = await queued()
    await fx.turnOn({ active: false })
    await processDue()
    const after = await row(d.id)
    assert.deepEqual([after.status, after.lastError, received.length], ['skipped', 'Email is off', 0])
  })

  test('a reminder for a checkout completed since, or an address that unsubscribed since, is skipped without sending', async () => {
    const done = await fx.cart()
    const unsub = await fx.cart({ email: 'gone@example.test' })
    const rows = []
    for (const [cart, to] of [
      [done, 'shopper@example.test'],
      [unsub, 'gone@example.test'],
    ] as const)
      rows.push(
        (
          await db
            .insert(schema.emailDeliveries)
            .values({
              shopId: SHOP,
              notification: 'abandoned_cart',
              cartId: cart.id,
              to,
              subject: 'Still there?',
              html: '<p>x</p>',
            })
            .returning()
        )[0]!,
      )
    await db.update(schema.carts).set({ status: 'completed' }).where(eq(schema.carts.id, done.id))
    await abandonedCartService.unsubscribe(abandonedCartService.unsubscribeToken(SHOP, 'gone@example.test'))
    await processDue()
    assert.deepEqual(
      [(await row(rows[0]!.id)).lastError, (await row(rows[1]!.id)).lastError],
      ['Checkout was completed', 'Unsubscribed'],
    )
    assert.deepEqual([(await row(rows[0]!.id)).status, (await row(rows[1]!.id)).status], ['skipped', 'skipped'])
    assert.equal(received.length, 0)
  })
})
