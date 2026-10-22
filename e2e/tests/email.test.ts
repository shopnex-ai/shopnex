// Settings → Email through the email service, against a tiny SMTP server in this process (no provider
// account needed). The shop's email settings are put back as they were afterwards.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { EmailError, emailService, type SmtpInput } from '@shopnex/email'
import { SHOP, closeDb } from '../lib'
import { smtpSink } from '../smtp-sink'

const sink = smtpSink()
let smtp: SmtpInput
let previous: typeof schema.emailSettings.$inferSelect | undefined

const restore = async () => {
  await db.delete(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
  if (previous) await db.insert(schema.emailSettings).values(previous)
}

before(async () => {
  ;[previous] = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
  const port = await sink.start()
  smtp = {
    preset: 'other',
    host: '127.0.0.1',
    port,
    username: '',
    fromName: 'E2E Shop',
    fromEmail: 'orders@e2e.test',
  }
})

after(async () => {
  await restore()
  await sink.stop()
  await closeDb()
})

describe('email', () => {
  test('the test logs in and delivers a message from the shop address, saving nothing', async () => {
    const result = await emailService.test(SHOP, smtp, 'staff@e2e.test')
    assert.deepEqual(result, {
      ok: true,
      steps: [
        { step: 'connect', ok: true },
        { step: 'send', ok: true },
      ],
    })
    const raw = sink.messages.at(-1) ?? ''
    assert.match(raw, /^From: "?E2E Shop"? <orders@e2e\.test>/m)
    assert.match(raw, /^To: staff@e2e\.test/m)
    assert.match(raw, /^Subject: Test email from your shop/m)
    const [row] = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
    assert.deepEqual(row, previous)
  })

  test('saved SMTP sends; turned off, messages are only logged', async () => {
    await restore()
    const saved = await emailService.useSmtp(SHOP, smtp)
    assert.equal(saved.provider, 'smtp')
    assert.equal(saved.smtp?.hasPassword, false)

    const count = sink.messages.length
    assert.deepEqual(await emailService.send(SHOP, { to: 'buyer@e2e.test', subject: 'Order #1', text: 'Thanks' }), {
      sent: true,
    })
    assert.equal(sink.messages.length, count + 1)
    assert.match(sink.messages.at(-1) ?? '', /^Subject: Order #1/m)

    assert.equal((await emailService.turnOff(SHOP)).provider, 'off')
    assert.deepEqual(await emailService.send(SHOP, { to: 'buyer@e2e.test', subject: 'Order #2', text: 'x' }), {
      sent: false,
    })
    assert.equal(sink.messages.length, count + 1)
    // Off keeps the setup for switching back on
    assert.equal((await emailService.getSettings(SHOP)).smtp?.host, '127.0.0.1')
  })

  test('a login never goes over an unencrypted connection, and needs a password', async () => {
    await restore()
    // The sink offers no STARTTLS, so a login is refused before the password is sent
    await assert.rejects(
      emailService.useSmtp(SHOP, { ...smtp, username: 'user', password: 'hunter2' }),
      (error) => error instanceof EmailError && error.code === 'EMAIL_FAILED' && /STARTTLS/i.test(error.message),
    )
    const [row] = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
    assert.equal(row, undefined, 'nothing saved when the login check fails')

    await assert.rejects(
      emailService.test(SHOP, { ...smtp, username: 'user' }, 'staff@e2e.test'),
      (error) => error instanceof EmailError && error.code === 'PASSWORD_REQUIRED',
    )
  })

  test('an unreachable server is never saved', async () => {
    await restore()
    await assert.rejects(
      emailService.useSmtp(SHOP, { ...smtp, port: 1 }),
      (error) => error instanceof EmailError && error.code === 'EMAIL_FAILED',
    )
    assert.equal((await emailService.getSettings(SHOP)).provider, previous?.active ? 'smtp' : 'off')
  })
})
