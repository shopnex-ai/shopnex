// Open sign-up (OPEN_SIGNUP=true in multi-shop mode) through Better Auth's own HTTP handler: the per-address cap is checked before
// the account is made (429), and so is the cap for everyone. Caps are set tiny so the test stays short.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { user } from '@shopnex/core/schema'

// Set before the modules load: they read these when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.TENANCY_MODE = 'multi'
process.env.OPEN_SIGNUP = 'true'
process.env.SIGNUP_RATE_PER_IP = '1'
process.env.SIGNUP_RATE_GLOBAL = '2'
process.env.SHOPNEX_SECRET ??= 'open-signup-limits-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { auth } = await import('../src')
const { SIGNUP_LIMIT_MESSAGE, resetSignupLimits } = await import('../src/signup-limit')
const { eq } = await import('drizzle-orm')

before(async () => {
  await prepareDatabase()
  resetSignupLimits()
})
after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

const signUp = (email: string, ip: string) =>
  auth.handler(
    new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': ip },
      body: JSON.stringify({ name: 'New', email, password: 'a-long-enough-password-1' }),
    }),
  )
const exists = async (email: string) =>
  (await db.select({ id: user.id }).from(user).where(eq(user.email, email))).length === 1

describe('open sign-up caps', () => {
  test('the first sign-up from an address works', { timeout: 60_000 }, async () => {
    const res = await signUp('first@example.com', '203.0.113.1')
    assert.equal(res.status, 200)
    assert.ok(await exists('first@example.com'))
  })

  test(
    'a second from the same address is refused with 429 before an account is made',
    { timeout: 60_000 },
    async () => {
      const res = await signUp('second@example.com', '203.0.113.1')
      assert.equal(res.status, 429)
      assert.match(await res.text(), new RegExp(SIGNUP_LIMIT_MESSAGE))
      assert.equal(await exists('second@example.com'), false)
    },
  )

  test(
    'another address works until the cap for everyone is used, then even a new address is refused',
    { timeout: 120_000 },
    async () => {
      assert.equal((await signUp('third@example.com', '203.0.113.2')).status, 200)
      const res = await signUp('fourth@example.com', '203.0.113.3')
      assert.equal(res.status, 429)
      assert.equal(await exists('fourth@example.com'), false)
    },
  )
})
