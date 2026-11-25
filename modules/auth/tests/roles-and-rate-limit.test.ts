// Customer sign-in is not Better Auth's (no emailOTP endpoints), the platform role check, and the rate limit that is shared
// through the database.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { user } from '@shopnex/core/schema'

// Set before the modules load: they read these when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'shopper-login-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { auth } = await import('../src')
const { SUPER_ADMIN_ROLE, isSuperAdmin } = await import('../src/roles')
const { takeRate } = await import('../src/rate-limit')
const { rateLimits } = await import('../src/auth.schema')
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

describe("customers' sign-in is not part of Better Auth", () => {
  test('the emailOTP endpoints and bearer sessions do not exist, so no code or token can become a staff session', async () => {
    for (const [path, body] of [
      ['/email-otp/send-verification-otp', { email: 'someone@example.com', type: 'sign-in' }],
      ['/sign-in/email-otp', { email: 'someone@example.com', otp: '123456' }],
      ['/email-otp/check-verification-otp', { email: 'someone@example.com', type: 'sign-in', otp: '123456' }],
    ] as const)
      assert.equal((await post(path, body)).status, 404, path)
    const users = await db.select().from(user).where(eq(user.email, 'someone@example.com'))
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
  const rows = () => db.select().from(rateLimits)

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
    await db.update(rateLimits).set({ resetAt: new Date(Date.now() - 1000) })
    assert.equal(await takeRate('t:reset', 1, 60_000), null, 'a new window')
  })

  test('the key is stored as a hash: no email address or visitor address in the table', async () => {
    const key = 'login:someone@example.com'
    await takeRate(key, 5, 60_000)
    const all = await rows()
    for (const row of all) assert.match(row.key, /^[0-9a-f]{64}$/)
    assert.ok(
      all.some((row) => row.key === createHash('sha256').update(key).digest('hex')),
      'the row is under the hash of the key, not the key',
    )
  })

  test('concurrent uses do not slip under the cap', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => takeRate('t:race', 3, 60_000)))
    assert.equal(results.filter((r) => r === null).length, 3)
  })
})
