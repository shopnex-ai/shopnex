// The admin email and notification routes, called through the real router with fake resolvers and an in-memory database: who may call
// them (owners and admins, never a plain member and never an API token), input checks, and what they answer.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'
import * as fx from './fixtures'

const { SHOP, received } = fx
const { configureRpc } = await import('@shopnex/rpc')
const { emailModule } = await import('../src/email.module')
const { hasScope } = await import('@shopnex/core/scopes')

const { email, notifications } = emailModule.router
const shop = { id: SHOP, storefrontUrl: null } as never

let who: 'owner' | 'admin' | 'member' | 'nobody' | 'token' = 'owner'
let superAdmin = false

before(async () => {
  await fx.prepareDatabase()
  await fx.startSmtp()
  configureRpc({
    session: () =>
      Promise.resolve(
        who === 'nobody' || who === 'token'
          ? null
          : ({ session: { activeOrganizationId: SHOP }, user: { id: 'u1', email: 'staff@example.test' } } as never),
      ),
    adminShop: () =>
      Promise.resolve({
        shop,
        role: who === 'member' ? 'member' : who === 'admin' ? 'admin' : 'owner',
        superAdmin,
      } as never),
    token: () =>
      Promise.resolve(who === 'token' ? ({ shop, token: { scopes: ['write_products'], appId: null } } as never) : null),
    hasScope,
  })
})
beforeEach(async () => {
  who = 'owner'
  superAdmin = false
  await fx.cleanup()
  fx.resetSmtp()
})
after(async () => {
  await fx.cleanup()
  await fx.stopSmtp()
})

const run = <T>(procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, {
    context: { headers: new Headers(who === 'token' ? { authorization: 'Bearer sk_test' } : {}) },
  } as never) as Promise<T>
const refused = (code: string) => (e: unknown) => e instanceof ORPCError && e.code === code
// Refused by the route's own input check, before any service runs (BAD_REQUEST is also what a service answers for other reasons)
const invalid = (e: unknown) =>
  e instanceof ORPCError && e.code === 'BAD_REQUEST' && e.message === 'Input validation failed'
const smtp = () => ({
  preset: 'other',
  host: '127.0.0.1',
  port: fx.smtpPort,
  username: '',
  fromName: 'Shop',
  fromEmail: 'shop@example.test',
})

describe('who may call', () => {
  test('nobody signed in is UNAUTHORIZED, a plain member and an API token are FORBIDDEN or UNAUTHORIZED, an owner and an admin pass', async () => {
    who = 'nobody'
    await assert.rejects(run(email.get), refused('UNAUTHORIZED'))
    await assert.rejects(run(notifications.list), refused('UNAUTHORIZED'))
    who = 'token'
    await assert.rejects(run(email.get), refused('UNAUTHORIZED'), 'a bearer is not a session: these are staff settings')
    who = 'member'
    await assert.rejects(run(email.get), refused('FORBIDDEN'))
    await assert.rejects(run(notifications.update, { notification: 'layout', subject: 's' }), refused('FORBIDDEN'))
    for (const role of ['owner', 'admin'] as const) {
      who = role
      assert.equal((await run<{ provider: string }>(email.get)).provider, 'off')
    }
    who = 'member'
    superAdmin = true
    assert.equal((await run<{ provider: string }>(email.get)).provider, 'off', 'a super admin passes without a role')
  })
})

describe('Settings → Email', () => {
  test('an SMTP setup is checked, saved and answered without the password; off keeps it', async () => {
    const saved = await run<{ provider: string; smtp: { host: string; hasPassword: boolean } }>(email.update, {
      provider: 'smtp',
      smtp: smtp(),
    })
    assert.deepEqual([saved.provider, saved.smtp.host, saved.smtp.hasPassword], ['smtp', '127.0.0.1', false])
    const off = await run<{ provider: string; smtp: { host: string } | null }>(email.update, { provider: 'off' })
    assert.deepEqual([off.provider, off.smtp?.host], ['off', '127.0.0.1'])
  })

  test('a server that cannot be reached is BAD_REQUEST and nothing is saved', async () => {
    await assert.rejects(run(email.update, { provider: 'smtp', smtp: { ...smtp(), port: 1 } }), refused('BAD_REQUEST'))
    assert.equal((await run<{ provider: string }>(email.get)).provider, 'off')
  })

  test('the setup is validated: a host with a path or spaces, a port out of range, an address that is not one, an unknown preset', async () => {
    for (const bad of [
      { host: 'smtp.example.com/path' },
      { host: 'has space.com' },
      { host: '-bad.com' },
      { port: 0 },
      { port: 70_000 },
      { port: 25.5 },
      { fromEmail: 'nobody' },
      { preset: 'carrier-pigeon' },
      { username: 'x'.repeat(257) },
      { fromName: 'x'.repeat(101) },
    ])
      await assert.rejects(
        run(email.update, { provider: 'smtp', smtp: { ...smtp(), ...bad } }),
        invalid,
        JSON.stringify(bad),
      )
    await assert.rejects(run(email.update, { provider: 'pigeon' }), invalid)
  })

  test('the test sends to the signed-in person without saving anything', async () => {
    const result = await run<{ ok: boolean; steps: unknown[] }>(email.test, smtp())
    assert.equal(result.ok, true)
    assert.deepEqual(received[0]?.to, ['staff@example.test'])
    assert.equal((await run<{ provider: string }>(email.get)).provider, 'off')
  })
})

describe('Settings → Notifications', () => {
  test('the list, one notification, an edit that keeps its switch, and a revert', async () => {
    assert.equal((await run<unknown[]>(notifications.list)).length, 7)
    const edited = await run<{ subject: string; customized: boolean; enabled: boolean }>(notifications.update, {
      notification: 'order_cancelled',
      subject: 'Cancelled {{ order.name }}',
      enabled: false,
    })
    assert.deepEqual([edited.subject, edited.customized, edited.enabled], ['Cancelled {{ order.name }}', true, false])
    assert.equal(
      (await run<{ subject: string }>(notifications.get, { notification: 'order_cancelled' })).subject,
      'Cancelled {{ order.name }}',
    )
    const back = await run<{ customized: boolean; enabled: boolean }>(notifications.revert, {
      notification: 'order_cancelled',
    })
    assert.deepEqual([back.customized, back.enabled], [false, false])
  })

  test('an unknown notification, an oversized template and Liquid with a syntax error are BAD_REQUEST', async () => {
    await assert.rejects(run(notifications.get, { notification: 'newsletter' }), invalid)
    await assert.rejects(run(notifications.update, { notification: 'layout', body: 'x'.repeat(200_001) }), invalid)
    await assert.rejects(
      run(notifications.update, { notification: 'layout', body: '{% if %}' }),
      refused('BAD_REQUEST'),
    )
    await assert.rejects(
      run(notifications.preview, { notification: 'layout', subject: 'x'.repeat(501), body: '' }),
      invalid,
    )
  })

  test('the preview renders unsaved Liquid and answers a problem instead of failing', async () => {
    const ok = await run<{ sample: boolean; subject: string }>(notifications.preview, {
      notification: 'order_confirmation',
      subject: 'Hi {{ order.name }}',
      body: '<p>x</p>',
    })
    assert.deepEqual([ok.sample, ok.subject], [true, 'Hi #1001'])
    const bad = await run<{ problem: { message: string } | null }>(notifications.preview, {
      notification: 'order_confirmation',
      subject: 'S',
      body: '{{ x | nope }}',
    })
    assert.ok(bad.problem)
  })

  test('the test send goes to the signed-in person, and is BAD_REQUEST while email is off', async () => {
    await assert.rejects(
      run(notifications.test, { notification: 'order_confirmation', subject: 'S', body: '<p>x</p>' }),
      refused('BAD_REQUEST'),
    )
    await fx.turnOn()
    assert.deepEqual(
      await run(notifications.test, { notification: 'order_confirmation', subject: 'S', body: '<p>x</p>' }),
      { to: 'staff@example.test' },
    )
    assert.deepEqual(received[0]?.to, ['staff@example.test'])
  })

  test('recent emails: the list is empty for a new shop', async () => {
    assert.deepEqual(await run(notifications.deliveries), [])
  })

  test('the abandoned cart settings say whether email is on, and are checked on change', async () => {
    assert.deepEqual(await run(notifications.abandonedCartSettings), {
      enabled: false,
      delayMinutes: 60,
      emailOn: false,
    })
    await fx.turnOn()
    assert.deepEqual(await run(notifications.updateAbandonedCartSettings, { enabled: true, delayMinutes: 120 }), {
      enabled: true,
      delayMinutes: 120,
      emailOn: true,
    })
    await assert.rejects(run(notifications.updateAbandonedCartSettings, { delayMinutes: 5 }), refused('BAD_REQUEST'))
    await assert.rejects(run(notifications.updateAbandonedCartSettings, { delayMinutes: 'soon' }), invalid)
  })
})
