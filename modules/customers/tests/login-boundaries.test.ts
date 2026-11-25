// Customer sign-in must not cross a boundary (GHSA-w9q2-8c32-gmhm): a code is one shop's, a customer token is never a staff
// session, and a customer cannot create a shop. Written to fail on the code before the fix (it used only functions that
// exist in both), so it also guards against going back to a shared login.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { shops, user as userTable } from '@shopnex/core/schema'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'regression-secret-0123456789-0123456789'
process.env.APP_URL = 'http://localhost:3000'
process.env.TENANCY_MODE = 'multi'
process.env.ROOT_DOMAIN = 'shopnex.test'
delete process.env.OPEN_SIGNUP

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { accountService } = await import('../src')
const { auth } = await import('@shopnex/auth')
const { shopMembers } = await import('../../tenancy/src/tenancy.schema')

const A = 'shop-a'
const B = 'shop-b'
before(async () => {
  await prepareDatabase()
  await db.insert(shops).values([
    { id: A, name: 'A', slug: A },
    { id: B, name: 'B', slug: B },
  ])
})
after(() => setImmediate(() => process.exit()))

async function codeThrough(shop: string, email: string) {
  let code = ''
  await accountService.requestLoginCode(
    shop,
    email,
    (_to, c) => {
      code = c
      return Promise.resolve()
    },
    db,
  )
  return code
}

test('1. a code asked for through shop A is refused at shop B', async () => {
  const email = 'victim-customer@example.test'
  const stolen = await codeThrough(A, email) // the attacker's SMTP reads it
  await assert.rejects(accountService.verifyLoginCode(B, email, stolen, db))
})

test('2. a customer sign-in with a verified staff address is not a staff session', async () => {
  const email = 'staff-victim@example.test'
  await db.insert(userTable).values({ id: 'staff-1', name: 'Staff', email, emailVerified: true })
  await db.insert(shopMembers).values({ id: 'm1', organizationId: B, userId: 'staff-1', role: 'owner' } as never)
  let token: string
  try {
    token = (await accountService.verifyLoginCode(A, email, await codeThrough(A, email), db)).token
  } catch {
    return // refused outright: also fine
  }
  const bearer = await auth.api
    .getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })
    .catch(() => null)
  const cookie = await auth.api
    .getSession({ headers: new Headers({ cookie: `better-auth.session_token=${token}` }) })
    .catch(() => null)
  assert.equal(bearer, null, 'the token acted as a staff session through a bearer header')
  assert.equal(cookie, null, 'the token acted as a staff session through a cookie')
})

test('3. a customer token cannot create a shop on an invitation-only instance', async () => {
  const email = 'new-customer@example.test'
  const { token } = await accountService.verifyLoginCode(A, email, await codeThrough(A, email), db)
  const headers = new Headers({ authorization: `Bearer ${token}` })
  await assert.rejects(auth.api.createOrganization({ headers, body: { name: 'Mine', slug: 'mine-shop' } }))
})
