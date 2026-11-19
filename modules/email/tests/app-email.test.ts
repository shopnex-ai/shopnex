// Email sent by an installed app through the shop's own email settings: only to the shop's customers, only so often,
// and nothing is sent (and the app is told) while the shop has email off.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, SHOP, OTHER_SHOP, received } = fx
const { EmailError, APP_EMAILS_PER_HOUR, resetAppEmailLimits } = await import('../src')
const { sendForApp } = await import('../src/app-email')

const refused = (code: string) => (e: unknown) => e instanceof EmailError && e.code === code
const message = (to: string) => ({ to, subject: 'How was your mug?', text: 'Tell us', html: '<p>Tell us</p>' })

before(async () => {
  await fx.prepareDatabase()
  await fx.startSmtp()
})
beforeEach(async () => {
  await fx.cleanup()
  fx.resetSmtp()
  resetAppEmailLimits()
})
after(async () => {
  await fx.cleanup()
  await fx.stopSmtp()
})

describe('an app sending email', () => {
  test('goes out from the shop through its email settings, to a customer', async () => {
    await fx.turnOn()
    const { email } = await fx.customer()
    assert.deepEqual(await sendForApp(SHOP, 'app-1', message(email), db), { sent: true })
    assert.equal(received.length, 1)
    assert.deepEqual(received[0]!.to, [email])
    assert.equal(received[0]!.subject, 'How was your mug?')
  })

  test('the address is matched without regard to case', async () => {
    await fx.turnOn()
    const { email } = await fx.customer({ email: `Mixed.Case-${fx.unique()}@Example.com` })
    assert.deepEqual(await sendForApp(SHOP, 'app-1', message(email.toLowerCase()), db), { sent: true })
  })

  test('with email off nothing is sent and the app is told', async () => {
    const { email } = await fx.customer()
    assert.deepEqual(await sendForApp(SHOP, 'app-1', message(email), db), { sent: false })
    assert.equal(received.length, 0)
  })

  test('not to anyone who is not a customer of this shop (the shop is not a mail relay)', async () => {
    await fx.turnOn()
    await assert.rejects(
      sendForApp(SHOP, 'app-1', message(`stranger-${fx.unique()}@example.com`), db),
      refused('RECIPIENT_UNKNOWN'),
    )
    assert.equal(received.length, 0)
  })

  test("not to another shop's customer", async () => {
    await fx.turnOn()
    await fx.otherShop()
    const other = await fx.customer({ shopId: OTHER_SHOP })
    await assert.rejects(sendForApp(SHOP, 'app-1', message(other.email), db), refused('RECIPIENT_UNKNOWN'))
    assert.equal(received.length, 0)
  })

  test('only so many an hour per app and shop; another app, and the next hour, start fresh', async () => {
    await fx.turnOn()
    const { email } = await fx.customer()
    const t = 1_000_000
    for (let i = 0; i < 3; i++) await sendForApp(SHOP, 'app-1', message(email), db, { now: t, limit: 3 })
    await assert.rejects(
      sendForApp(SHOP, 'app-1', message(email), db, { now: t + 1000, limit: 3 }),
      refused('SEND_LIMIT'),
    )
    assert.deepEqual(await sendForApp(SHOP, 'app-2', message(email), db, { now: t + 1000, limit: 3 }), { sent: true })
    assert.deepEqual(await sendForApp(SHOP, 'app-1', message(email), db, { now: t + 3_600_001, limit: 3 }), {
      sent: true,
    })
    assert.equal(received.length, 5)
    assert.ok(APP_EMAILS_PER_HOUR >= 100)
  })

  test('a refused send does not use up the limit', async () => {
    await fx.turnOn()
    const { email } = await fx.customer()
    for (let i = 0; i < 5; i++) {
      await assert.rejects(
        sendForApp(SHOP, 'app-1', message(`nobody-${i}-${fx.unique()}@example.com`), db, { limit: 2 }),
      )
    }
    assert.deepEqual(await sendForApp(SHOP, 'app-1', message(email), db, { limit: 2 }), { sent: true })
  })
})
