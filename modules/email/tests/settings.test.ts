// How a shop sends email (Settings → Email): off by default, any SMTP server once set up, the login checked before anything is
// saved, the password never given back, and what a send does when email is off or the server says no.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, eq, SHOP, behavior, received } = fx
const { emailService, EmailError } = await import('../src')
const { encryptSecret } = await import('@shopnex/db/secrets')

const refused = (code: string) => (e: unknown) => e instanceof EmailError && e.code === code

before(async () => {
  await fx.prepareDatabase()
  await fx.startSmtp()
})
beforeEach(async () => {
  await fx.cleanup()
  fx.resetSmtp()
})
after(async () => {
  await fx.cleanup()
  await fx.stopSmtp()
})

describe('the settings', () => {
  test('a shop that never set up email is off, with nothing saved', async () => {
    assert.deepEqual(await emailService.getSettings(SHOP), { provider: 'off', smtp: null })
  })

  test('once set up they say which server, and whether a password is saved, but never the password', async () => {
    await fx.turnOn({ password: encryptSecret('hunter2'), config: fx.smtpConfig({ username: 'login' }) })
    const settings = await emailService.getSettings(SHOP)
    assert.equal(settings.provider, 'smtp')
    assert.deepEqual(
      [settings.smtp?.host, settings.smtp?.username, settings.smtp?.hasPassword],
      ['127.0.0.1', 'login', true],
    )
    const [stored] = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
    assert.ok(stored?.password && stored.password !== 'hunter2', 'stored encrypted')
    assert.equal(JSON.stringify(settings).includes('hunter2'), false)
    assert.equal(JSON.stringify(settings).includes(stored.password), false, 'not even the encrypted form')
    assert.equal('password' in (settings.smtp ?? {}), false)
  })

  test('turning off keeps the setup, so turning on again does not mean typing it again', async () => {
    await fx.turnOn()
    const off = await emailService.turnOff(SHOP)
    assert.equal(off.provider, 'off')
    assert.equal(off.smtp?.host, '127.0.0.1')
    assert.equal((await emailService.turnOff('never-set-up')).provider, 'off')
  })
})

describe('saving a setup', () => {
  test('the login is checked first, then the setup is saved and active', async () => {
    const saved = await emailService.useSmtp(SHOP, fx.smtpConfig())
    assert.equal(saved.provider, 'smtp')
    assert.deepEqual(
      [saved.smtp?.fromEmail, saved.smtp?.fromName, saved.smtp?.hasPassword],
      ['shop@example.test', 'Test Shop', false],
    )
    const [row] = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
    assert.deepEqual([row?.active, row?.password], [true, null])
  })

  test('saving again replaces the setup', async () => {
    await emailService.useSmtp(SHOP, fx.smtpConfig())
    const again = await emailService.useSmtp(SHOP, fx.smtpConfig({ fromName: 'Renamed' }))
    assert.equal(again.smtp?.fromName, 'Renamed')
    assert.equal((await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))).length, 1)
  })

  test('a server that cannot be reached is EMAIL_FAILED, naming the host, and nothing is saved', async () => {
    await assert.rejects(emailService.useSmtp(SHOP, fx.smtpConfig({ port: 1 })), (e: unknown) => {
      assert.ok(e instanceof EmailError)
      assert.equal(e.code, 'EMAIL_FAILED')
      assert.match(e.message, /Could not log in to 127\.0\.0\.1/)
      return true
    })
    assert.deepEqual(await emailService.getSettings(SHOP), { provider: 'off', smtp: null })
  })

  test('a login needs its password: PASSWORD_REQUIRED when none is given and none is saved', async () => {
    await assert.rejects(emailService.useSmtp(SHOP, fx.smtpConfig({ username: 'login' })), refused('PASSWORD_REQUIRED'))
    assert.equal((await emailService.getSettings(SHOP)).provider, 'off')
  })
})

describe('the test message', () => {
  test('logs in, then sends to the person asking, from the shop’s address, and says both steps worked', async () => {
    const result = await emailService.test(SHOP, fx.smtpConfig(), 'staff@example.test')
    assert.deepEqual(result, {
      ok: true,
      steps: [
        { step: 'connect', ok: true },
        { step: 'send', ok: true },
      ],
    })
    assert.equal(received.length, 1)
    assert.deepEqual([received[0]?.to, received[0]?.from], [['staff@example.test'], 'shop@example.test'])
    assert.equal(received[0]?.subject, 'Test email from your shop')
    assert.equal((await emailService.getSettings(SHOP)).provider, 'off', 'testing saves nothing')
  })

  test('a server that cannot be reached fails at connect and never tries to send', async () => {
    const result = await emailService.test(SHOP, fx.smtpConfig({ port: 1 }), 'staff@example.test')
    assert.equal(result.ok, false)
    assert.deepEqual(
      result.steps.map((s) => [s.step, s.ok]),
      [['connect', false]],
    )
    assert.ok(result.steps[0]?.error)
  })

  test('a server that refuses the recipient fails at send, after connecting', async () => {
    behavior.rejectRecipients = true
    const result = await emailService.test(SHOP, fx.smtpConfig(), 'staff@example.test')
    assert.equal(result.ok, false)
    assert.deepEqual(
      result.steps.map((s) => [s.step, s.ok]),
      [
        ['connect', true],
        ['send', false],
      ],
    )
  })

  test('a login without a password fails the whole test with PASSWORD_REQUIRED', async () => {
    await assert.rejects(
      emailService.test(SHOP, fx.smtpConfig({ username: 'login' }), 'staff@example.test'),
      refused('PASSWORD_REQUIRED'),
    )
  })
})

describe('sending', () => {
  test('with email off nothing is sent and the answer says so', async () => {
    assert.deepEqual(await emailService.send(SHOP, { to: 'a@example.test', subject: 'Hi', html: '<p>x</p>' }), {
      sent: false,
    })
    await fx.turnOn({ active: false })
    assert.deepEqual(await emailService.send(SHOP, { to: 'a@example.test', subject: 'Hi', html: '<p>x</p>' }), {
      sent: false,
    })
    assert.equal(received.length, 0)
  })

  test('with email on it goes through the shop’s server, from the shop’s name and address', async () => {
    await fx.turnOn()
    assert.deepEqual(
      await emailService.send(SHOP, {
        to: 'a@example.test',
        subject: 'Hello',
        html: '<p>x</p>',
        replyTo: 'r@example.test',
      }),
      { sent: true },
    )
    assert.equal(received.length, 1)
    assert.deepEqual(
      [received[0]?.to, received[0]?.from, received[0]?.subject],
      [['a@example.test'], 'shop@example.test', 'Hello'],
    )
    assert.match(received[0]!.raw, /From: "?Test Shop"? <shop@example\.test>/)
    assert.match(received[0]!.raw, /Reply-To: r@example\.test/)
  })

  test('one shop’s setup is never used for another’s', async () => {
    await fx.otherShop()
    await fx.turnOn()
    assert.deepEqual(
      await emailService.send(fx.OTHER_SHOP, { to: 'a@example.test', subject: 'Hi', html: '<p>x</p>' }),
      { sent: false },
    )
    assert.equal(received.length, 0)
  })

  test('a server that refuses is EMAIL_FAILED naming the subject', async () => {
    await fx.turnOn()
    behavior.rejectRecipients = true
    await assert.rejects(
      emailService.send(SHOP, { to: 'a@example.test', subject: 'Receipt', html: '<p>x</p>' }),
      (e: unknown) => {
        assert.ok(e instanceof EmailError)
        assert.equal(e.code, 'EMAIL_FAILED')
        assert.match(e.message, /Could not send "Receipt"/)
        return true
      },
    )
  })

  test('a server that cannot be reached is EMAIL_FAILED too', async () => {
    await fx.turnOn({ config: fx.smtpConfig({ port: 1 }) })
    await assert.rejects(
      emailService.send(SHOP, { to: 'a@example.test', subject: 'Receipt', html: '<p>x</p>' }),
      refused('EMAIL_FAILED'),
    )
  })
})
