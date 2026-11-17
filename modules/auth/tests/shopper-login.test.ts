// Customer sign-in codes: the emailOTP endpoints only work for our own server code, the platform role check, and the rate limit
// that is shared through the database.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: they read these when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'shopper-login-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { auth } = await import('../src')
const { currentOtpSender, isOtpPath, withOtpSender, withOtpSignIn } = await import('../src/shopper-login')
const { SUPER_ADMIN_ROLE, isSuperAdmin } = await import('../src/roles')
const { takeRate } = await import('../src/rate-limit')
const { eq } = await import('drizzle-orm')

before(prepareDatabase)
after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

const post = (path: string, body: unknown) =>
  auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
  )

describe('which paths are the sign-in code endpoints', () => {
  test('/email-otp/* and /sign-in/email-otp, and nothing else', () => {
    assert.equal(isOtpPath('/email-otp/send-verification-otp'), true)
    assert.equal(isOtpPath('/email-otp/check-verification-otp'), true)
    assert.equal(isOtpPath('/sign-in/email-otp'), true)
    for (const path of ['/sign-in/email', '/sign-up/email', '/email-otpx', '/sign-in/email-otp/more', '/get-session'])
      assert.equal(isOtpPath(path), false, path)
  })
})

describe('the sender of codes', () => {
  test('is there only inside withOtpSender, and is the one given', async () => {
    assert.equal(currentOtpSender(), undefined)
    const sent: string[] = []
    const send = (email: string, code: string) => {
      sent.push(`${email}:${code}`)
      return Promise.resolve()
    }
    await withOtpSender(send, async () => {
      assert.equal(currentOtpSender(), send)
      await Promise.resolve()
      assert.equal(currentOtpSender(), send, 'still there after an await')
    })
    assert.equal(currentOtpSender(), undefined)
  })

  test('inside withOtpSignIn a code is checked but never sent', async () => {
    await withOtpSignIn(async () => {
      const send = currentOtpSender()
      assert.ok(send)
      await assert.rejects(send('a@b.c', '123456'), /A code is not sent while signing in/)
    })
  })
})

describe('the endpoints over HTTP', () => {
  test('answer 403 "Not available" when no server code supplied a sender, so nobody can send mail or sign up through them', async () => {
    for (const [path, body] of [
      ['/email-otp/send-verification-otp', { email: 'someone@example.com', type: 'sign-in' }],
      ['/sign-in/email-otp', { email: 'someone@example.com', otp: '123456' }],
      ['/email-otp/check-verification-otp', { email: 'someone@example.com', type: 'sign-in', otp: '123456' }],
    ] as const) {
      const res = await post(path, body)
      assert.equal(res.status, 403, path)
      assert.match(await res.text(), /Not available/)
    }
    const users = await db.select().from(schema.user).where(eq(schema.user.email, 'someone@example.com'))
    assert.equal(users.length, 0, 'no account was made')
  })
})

describe('platform roles', () => {
  test('only superadmin is a super admin', () => {
    assert.equal(SUPER_ADMIN_ROLE, 'superadmin')
    assert.equal(isSuperAdmin({ role: 'superadmin' }), true)
    for (const role of ['user', 'admin', 'owner', '', null, undefined])
      assert.equal(isSuperAdmin({ role }), false, String(role))
  })
})

describe('takeRate: login-code limits shared through the database', () => {
  const rows = () => db.select().from(schema.rateLimits)

  test('lets the first uses through up to max, then says how many seconds until the window ends', async () => {
    assert.equal(await takeRate('t:basic', 3, 60_000), null)
    assert.equal(await takeRate('t:basic', 3, 60_000), null)
    assert.equal(await takeRate('t:basic', 3, 60_000), null)
    const wait = await takeRate('t:basic', 3, 60_000)
    assert.ok(wait !== null && wait >= 1 && wait <= 60, `waits up to a minute, got ${String(wait)}`)
  })

  test('keys are separate', async () => {
    assert.equal(await takeRate('t:a', 1, 60_000), null)
    assert.notEqual(await takeRate('t:a', 1, 60_000), null)
    assert.equal(await takeRate('t:b', 1, 60_000), null)
  })

  test('uses past the cap are counted but do not push the end of the window out', async () => {
    const key = createHash('sha256').update('t:fixed').digest('hex')
    const row = async () => (await rows()).find((r) => r.key === key)!
    await takeRate('t:fixed', 1, 60_000)
    const started = await row()
    assert.equal(started.count, 1)
    await takeRate('t:fixed', 1, 60_000)
    await takeRate('t:fixed', 1, 3_600_000)
    const after = await row()
    assert.equal(after.count, 3, 'counted')
    assert.equal(after.resetAt.getTime(), started.resetAt.getTime(), 'the window ends when it always did')
  })

  test('the window starts again once it has ended', async () => {
    await takeRate('t:reset', 1, 60_000)
    assert.notEqual(await takeRate('t:reset', 1, 60_000), null)
    await db.update(schema.rateLimits).set({ resetAt: new Date(Date.now() - 1000) })
    assert.equal(await takeRate('t:reset', 1, 60_000), null, 'a new window')
  })

  test('the key is stored as a hash: no email address or visitor address in the table', async () => {
    await takeRate('login:someone@example.com', 5, 60_000)
    const all = await rows()
    assert.ok(all.length > 0)
    for (const row of all) {
      assert.match(row.key, /^[0-9a-f]{64}$/)
      assert.ok(!row.key.includes('example.com'))
    }
  })

  test('concurrent uses do not slip under the cap', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => takeRate('t:race', 3, 60_000)))
    assert.equal(results.filter((r) => r === null).length, 3)
  })
})
