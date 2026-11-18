// Signing in to the storefront with a code: the code goes to the sender that is given (customers cannot send email itself), the limits
// that protect the mailbox and the shop, the staff accounts that must not be signed in this way, and the customer record that the
// first sign-in creates.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { user as userTable } from '@shopnex/core/schema'
import { customers } from '../src/customers.schema'

// Set before the modules load: they read these when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'accounts-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { accountService, AccountError } = await import('../src')
const { rateLimits } = await import('@shopnex/auth/schema')
const { eq, like } = await import('drizzle-orm')

const SHOP = 'default'
let counter = 0
const address = () => `shopper-${Date.now().toString(36)}${(++counter).toString(36)}@example.test`
const sent: { to: string; code: string }[] = []
const send = (to: string, code: string) => {
  sent.push({ to, code })
  return Promise.resolve()
}
const refused = (code: string) => (e: unknown) => e instanceof AccountError && e.code === code

before(prepareDatabase)
beforeEach(async () => {
  sent.length = 0
  await db.delete(rateLimits).where(like(rateLimits.key, 'login-%'))
})
after(async () => {
  await db.delete(rateLimits).where(like(rateLimits.key, 'login-%'))
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('asking for a code', () => {
  test('goes to the sender given, once, to the address in lower case and trimmed, with a code of six digits', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, `  ${email.toUpperCase()} `, send)
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.to, email)
    assert.match(sent[0]!.code, /^\d{6}$/)
  })

  test('an address that is not one is refused and nothing is sent', async () => {
    for (const bad of ['', 'nobody', 'a@b', 'x '.repeat(5), `${'a'.repeat(250)}@example.test`])
      await assert.rejects(accountService.requestLoginCode(SHOP, bad, send), refused('INVALID_EMAIL'), bad)
    assert.deepEqual(sent, [])
  })

  test('what the sender throws comes out as it is (the shop has email off, say), not as an account error', async () => {
    const off = new Error('EMAIL_OFF')
    await assert.rejects(
      accountService.requestLoginCode(SHOP, address(), () => Promise.reject(off)),
      (e: unknown) => e === off,
    )
  })

  test('four codes for one address in the window, then TOO_MANY_REQUESTS; another address is not affected', async () => {
    const email = address()
    for (let i = 0; i < 4; i++) await accountService.requestLoginCode(SHOP, email, send)
    await assert.rejects(accountService.requestLoginCode(SHOP, email, send), refused('TOO_MANY_REQUESTS'))
    assert.equal(sent.length, 4)
    await accountService.requestLoginCode(SHOP, address(), send)
    assert.equal(sent.length, 5)
  })

  test('the limit by visitor address counts across addresses', async () => {
    for (let i = 0; i < 20; i++) await accountService.requestLoginCode(SHOP, address(), send, { ip: '203.0.113.7' })
    await assert.rejects(
      accountService.requestLoginCode(SHOP, address(), send, { ip: '203.0.113.7' }),
      refused('TOO_MANY_REQUESTS'),
    )
    await accountService.requestLoginCode(SHOP, address(), send, { ip: '203.0.113.8' })
  })

  test('a staff account that was never verified is sent nothing (a code would lock the owner out), and nothing says so', async () => {
    const email = address()
    await db.insert(userTable).values({ id: `u-${email}`, name: 'Owner', email, emailVerified: false })
    await accountService.requestLoginCode(SHOP, email, send)
    assert.deepEqual(sent, [])
    await db.delete(userTable).where(eq(userTable.id, `u-${email}`))
  })
})

describe('signing in with the code', () => {
  test('the first sign-in makes the customer of the shop, linked to the login, and the token starts a session', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send)
    const { token, customer } = await accountService.verifyLoginCode(SHOP, email, ` ${sent[0]!.code} `)
    assert.ok(token)
    assert.deepEqual([customer.email, customer.shopId], [email, SHOP])
    assert.ok(customer.userId)
    assert.equal((await accountService.fromToken(SHOP, token))?.id, customer.id)
    assert.equal(
      await accountService.fromToken('another-shop', token),
      null,
      'the customer of one shop is nobody in another',
    )
    await accountService.signOut(token)
    assert.equal(await accountService.fromToken(SHOP, token), null)
    await db.delete(customers).where(eq(customers.id, customer.id))
    await db.delete(userTable).where(eq(userTable.id, customer.userId))
  })

  test('a guest who ordered before gets the record back, linked to the login', async () => {
    const email = address()
    const [guest] = await db.insert(customers).values({ shopId: SHOP, email, name: 'Guest' }).returning()
    await accountService.requestLoginCode(SHOP, email, send)
    const { customer } = await accountService.verifyLoginCode(SHOP, email, sent[0]!.code)
    assert.equal(customer.id, guest!.id)
    assert.ok(customer.userId)
    await db.delete(customers).where(eq(customers.id, guest!.id))
    await db.delete(userTable).where(eq(userTable.id, customer.userId))
  })

  test('a wrong code, a malformed address and a staff account all answer the same INVALID_CODE', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send)
    await assert.rejects(accountService.verifyLoginCode(SHOP, email, '000000x'), refused('INVALID_CODE'))
    await assert.rejects(accountService.verifyLoginCode(SHOP, 'nobody', '123456'), refused('INVALID_CODE'))
    const staff = address()
    await db.insert(userTable).values({ id: `u-${staff}`, name: 'Owner', email: staff, emailVerified: false })
    await assert.rejects(accountService.verifyLoginCode(SHOP, staff, '123456'), refused('INVALID_CODE'))
    await db.delete(userTable).where(eq(userTable.id, `u-${staff}`))
  })

  test('ten attempts for one address in the window, right or wrong, then TOO_MANY_REQUESTS', async () => {
    const email = address()
    for (let i = 0; i < 10; i++)
      await assert.rejects(accountService.verifyLoginCode(SHOP, email, '000000'), refused('INVALID_CODE'))
    await assert.rejects(accountService.verifyLoginCode(SHOP, email, '000000'), refused('TOO_MANY_REQUESTS'))
  })
})

describe('the profile', () => {
  test('the name and phone can change, and the phone can be cleared', async () => {
    const [c] = await db
      .insert(customers)
      .values({ shopId: SHOP, email: address(), name: 'A', phone: '+1' })
      .returning()
    const changed = await accountService.updateProfile(SHOP, c!.id, { name: 'B', phone: null })
    assert.deepEqual([changed?.name, changed?.phone], ['B', null])
    await db.delete(customers).where(eq(customers.id, c!.id))
  })
})
