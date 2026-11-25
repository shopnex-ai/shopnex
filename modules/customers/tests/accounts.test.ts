// Signing in to the storefront with a code: the code goes to the sender that is given (customers cannot send email itself), the limits
// that protect the mailbox and the shop, the customer record that the first sign-in creates, and the boundaries
// (GHSA-w9q2-8c32-gmhm): a code and a session belong to one shop, and neither is ever a staff session.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shops, user as userTable } from '@shopnex/core/schema'
import { customerLoginCodes, customerSessions, customers } from '../src/customers.schema'

// Set before the modules load: they read these when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'accounts-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'
process.env.TENANCY_MODE = 'multi'
process.env.ROOT_DOMAIN = 'shopnex.test'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { accountService, AccountError } = await import('../src')
const { rateLimits, session: authSessions } = await import('@shopnex/auth/schema')
const { auth } = await import('@shopnex/auth')
const { eq, like } = await import('drizzle-orm')

const SHOP = 'default'
const OTHER_SHOP = 'other-shop'
let counter = 0
const address = () => `shopper-${Date.now().toString(36)}${(++counter).toString(36)}@example.test`
const sent: { to: string; code: string }[] = []
const send = (to: string, code: string) => {
  sent.push({ to, code })
  return Promise.resolve()
}
const refused = (code: string) => (e: unknown) => e instanceof AccountError && e.code === code

before(async () => {
  await prepareDatabase()
  await db.insert(shops).values({ id: OTHER_SHOP, name: 'Other', slug: OTHER_SHOP }).onConflictDoNothing()
})
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
    await accountService.requestLoginCode(SHOP, `  ${email.toUpperCase()} `, send, db)
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.to, email)
    assert.match(sent[0]!.code, /^\d{6}$/)
  })

  test('an address that is not one is refused and nothing is sent', async () => {
    for (const bad of ['', 'nobody', 'a@b', 'x '.repeat(5), `${'a'.repeat(250)}@example.test`])
      await assert.rejects(accountService.requestLoginCode(SHOP, bad, send, db), refused('INVALID_EMAIL'), bad)
    assert.deepEqual(sent, [])
  })

  test('what the sender throws comes out as it is (the shop has email off, say), not as an account error', async () => {
    const off = new Error('EMAIL_OFF')
    await assert.rejects(
      accountService.requestLoginCode(SHOP, address(), () => Promise.reject(off), db),
      (e: unknown) => e === off,
    )
  })

  test('four codes for one address in the window, then TOO_MANY_REQUESTS; another address is not affected', async () => {
    const email = address()
    for (let i = 0; i < 4; i++) await accountService.requestLoginCode(SHOP, email, send, db)
    await assert.rejects(accountService.requestLoginCode(SHOP, email, send, db), refused('TOO_MANY_REQUESTS'))
    assert.equal(sent.length, 4)
    await accountService.requestLoginCode(SHOP, address(), send, db)
    assert.equal(sent.length, 5)
  })

  test('the limit by visitor address counts across addresses', async () => {
    for (let i = 0; i < 20; i++) await accountService.requestLoginCode(SHOP, address(), send, db, { ip: '203.0.113.7' })
    await assert.rejects(
      accountService.requestLoginCode(SHOP, address(), send, db, { ip: '203.0.113.7' }),
      refused('TOO_MANY_REQUESTS'),
    )
    await accountService.requestLoginCode(SHOP, address(), send, db, { ip: '203.0.113.8' })
  })
})

describe('signing in with the code', () => {
  test('the first sign-in makes the customer of the shop, and the token starts a session', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    const { token, customer } = await accountService.verifyLoginCode(SHOP, email, ` ${sent[0]!.code} `, db)
    assert.ok(token)
    assert.deepEqual([customer.email, customer.shopId], [email, SHOP])
    assert.equal(customer.userId, null, 'a customer is not a user of the staff login')
    assert.equal((await accountService.fromToken(SHOP, token, db))?.id, customer.id)
    assert.equal(
      await accountService.fromToken('another-shop', token, db),
      null,
      'the customer of one shop is nobody in another',
    )
    await accountService.signOut(token, db)
    assert.equal(await accountService.fromToken(SHOP, token, db), null)
    await db.delete(customers).where(eq(customers.id, customer.id))
  })

  test('a guest who ordered before gets the record back', async () => {
    const email = address()
    const [guest] = await db.insert(customers).values({ shopId: SHOP, email, name: 'Guest' }).returning()
    await accountService.requestLoginCode(SHOP, email, send, db)
    const { customer } = await accountService.verifyLoginCode(SHOP, email, sent[0]!.code, db)
    assert.equal(customer.id, guest!.id)
    await db.delete(customers).where(eq(customers.id, guest!.id))
  })

  test('a wrong code, a malformed address and an address that asked for nothing all answer the same INVALID_CODE', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    await assert.rejects(accountService.verifyLoginCode(SHOP, email, '000000x', db), refused('INVALID_CODE'))
    await assert.rejects(accountService.verifyLoginCode(SHOP, 'nobody', '123456', db), refused('INVALID_CODE'))
    await assert.rejects(accountService.verifyLoginCode(SHOP, address(), '123456', db), refused('INVALID_CODE'))
  })

  test('a code works once, and asking again replaces it', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    const first = sent[0]!.code
    await accountService.requestLoginCode(SHOP, email, send, db)
    const second = sent[1]!.code
    if (first !== second)
      await assert.rejects(accountService.verifyLoginCode(SHOP, email, first, db), refused('INVALID_CODE'))
    await accountService.verifyLoginCode(SHOP, email, second, db)
    await assert.rejects(accountService.verifyLoginCode(SHOP, email, second, db), refused('INVALID_CODE'))
  })

  test('five wrong guesses spend the code: the right one no longer works', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    const code = sent[0]!.code
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++)
      await assert.rejects(accountService.verifyLoginCode(SHOP, email, wrong, db), refused('INVALID_CODE'))
    await assert.rejects(accountService.verifyLoginCode(SHOP, email, code, db), refused('INVALID_CODE'))
  })

  test('an expired code is refused', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    await db
      .update(customerLoginCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(customerLoginCodes.email, email))
    await assert.rejects(accountService.verifyLoginCode(SHOP, email, sent[0]!.code, db), refused('INVALID_CODE'))
  })

  test('a code that could not be sent is not left behind', async () => {
    const email = address()
    await assert.rejects(accountService.requestLoginCode(SHOP, email, () => Promise.reject(new Error('off')), db))
    assert.deepEqual(await db.select().from(customerLoginCodes).where(eq(customerLoginCodes.email, email)), [])
  })

  test('the code and the token are stored as hashes', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    const code = sent[0]!.code
    const [stored] = await db.select().from(customerLoginCodes).where(eq(customerLoginCodes.email, email))
    assert.ok(stored && !stored.codeHash.includes(code) && stored.codeHash.length === 64)
    const { token } = await accountService.verifyLoginCode(SHOP, email, code, db)
    const sessions = await db.select().from(customerSessions)
    assert.ok(sessions.every((row) => row.tokenHash !== token && row.tokenHash.length === 64))
  })

  test('ten attempts for one address in the window, right or wrong, then TOO_MANY_REQUESTS', async () => {
    const email = address()
    for (let i = 0; i < 10; i++)
      await assert.rejects(accountService.verifyLoginCode(SHOP, email, '000000', db), refused('INVALID_CODE'))
    await assert.rejects(accountService.verifyLoginCode(SHOP, email, '000000', db), refused('TOO_MANY_REQUESTS'))
  })
})

// GHSA-w9q2-8c32-gmhm: one shop's owner chooses that shop's SMTP server, so every code it sends is theirs to read
describe("a code and a session are one shop's", () => {
  test('a code asked for through one shop is worthless in another, even for a customer who already has a session there', async () => {
    const email = address()
    const [victim] = await db.insert(customers).values({ shopId: OTHER_SHOP, email, name: 'Victim' }).returning()
    // The victim has signed in to their own shop before
    await accountService.requestLoginCode(OTHER_SHOP, email, send, db)
    await accountService.verifyLoginCode(OTHER_SHOP, email, sent[0]!.code, db)

    sent.length = 0
    await accountService.requestLoginCode(SHOP, email, send, db) // the attacker's shop; its sender reads the code
    const stolen = sent[0]!.code
    await assert.rejects(accountService.verifyLoginCode(OTHER_SHOP, email, stolen, db), refused('INVALID_CODE'))
    const attacker = await accountService.verifyLoginCode(SHOP, email, stolen, db)
    assert.notEqual(attacker.customer.id, victim!.id, 'their own shop gives them their own record')
    assert.equal(await accountService.fromToken(OTHER_SHOP, attacker.token, db), null, 'and no way into the other shop')
    assert.equal((await accountService.fromToken(SHOP, attacker.token, db))?.id, attacker.customer.id)
  })

  test('the same address is a separate customer in each shop', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    const one = await accountService.verifyLoginCode(SHOP, email, sent[0]!.code, db)
    await accountService.requestLoginCode(OTHER_SHOP, email, send, db)
    const two = await accountService.verifyLoginCode(OTHER_SHOP, email, sent[1]!.code, db)
    assert.notEqual(one.customer.id, two.customer.id)
    assert.equal(await accountService.fromToken(OTHER_SHOP, one.token, db), null)
    assert.equal(await accountService.fromToken(SHOP, two.token, db), null)
  })

  test('a code is bound to the shop even when asked for twice in a row through different shops', async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    await accountService.requestLoginCode(OTHER_SHOP, email, send, db)
    // Each shop keeps its own code
    await accountService.verifyLoginCode(SHOP, email, sent[0]!.code, db)
    await accountService.verifyLoginCode(OTHER_SHOP, email, sent[1]!.code, db)
  })
})

// The same address as a staff member: customer sign-in must neither sign in as them nor touch their login
describe('staff accounts', () => {
  test('a customer sign-in with a staff address does not become their staff session, and leaves their login alone', async () => {
    const email = address()
    const id = `staff-${email}`
    await db.insert(userTable).values({ id, name: 'Owner', email, emailVerified: true })
    const sessionsBefore = (await db.select().from(authSessions).where(eq(authSessions.userId, id))).length

    await accountService.requestLoginCode(SHOP, email, send, db)
    const { token } = await accountService.verifyLoginCode(SHOP, email, sent[0]!.code, db)

    // Not a session of the staff login, whichever way it is presented
    for (const headers of [
      new Headers({ authorization: `Bearer ${token}` }),
      new Headers({ cookie: `better-auth.session_token=${token}` }),
    ])
      assert.equal(await auth.api.getSession({ headers }), null)
    assert.equal((await db.select().from(authSessions).where(eq(authSessions.userId, id))).length, sessionsBefore)
    const [staff] = await db.select().from(userTable).where(eq(userTable.id, id))
    assert.equal(staff?.emailVerified, true)
    await db.delete(userTable).where(eq(userTable.id, id))
  })

  test("a customer's token cannot create a shop or reach any Better Auth endpoint", async () => {
    const email = address()
    await accountService.requestLoginCode(SHOP, email, send, db)
    const { token } = await accountService.verifyLoginCode(SHOP, email, sent[0]!.code, db)
    const headers = new Headers({ authorization: `Bearer ${token}` })
    await assert.rejects(auth.api.createOrganization({ headers, body: { name: 'Mine', slug: `mine-${Date.now()}` } }))
    assert.equal(
      (await db.select().from(userTable).where(eq(userTable.email, email))).length,
      0,
      'no staff user was made',
    )
  })
})

describe('the profile', () => {
  test('the name and phone can change, and the phone can be cleared', async () => {
    const [c] = await db
      .insert(customers)
      .values({ shopId: SHOP, email: address(), name: 'A', phone: '+1' })
      .returning()
    const changed = await accountService.updateProfile(SHOP, c!.id, { name: 'B', phone: null }, db)
    assert.deepEqual([changed?.name, changed?.phone], ['B', null])
    await db.delete(customers).where(eq(customers.id, c!.id))
  })
})
