// Authentication and authorization end to end: sessions, invitation-only sign-up, platform and shop roles,
// and what an API token may and may not reach. Accounts go through the real flow (invitation → sign-up → accept).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { revokeApiToken } from '@shopnex/tenancy'
import { Fixtures, PASSWORD, SHOP, authCall, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36).toUpperCase()

type Account = Awaited<ReturnType<Fixtures['account']>>
let owner: Account
let admin: Account
let member: Account
let outsider: Account
let superadmin: Account

before(async () => {
  await requireApp()
  await fx.init()
  ;[owner, admin, member, outsider, superadmin] = await Promise.all([
    fx.account('owner'),
    fx.account('admin'),
    fx.account('member'),
    fx.account('outsider'),
    fx.account('superadmin'),
  ])
})

after(async () => {
  await fx.cleanup()
  await closeDb()
})

describe('sessions', () => {
  test('the admin API needs a session', async () => {
    for (const path of ['/admin/shop', '/admin/staff', '/admin/api-tokens', '/admin/discounts']) {
      assert.equal((await call('GET', path)).status, 401, path)
    }
  })

  test('a made-up or tampered session cookie is not a session', async () => {
    const real = owner.headers.cookie
    const tampered = real.replace(/=(.)/, (_, c) => `=${c === 'a' ? 'b' : 'a'}`)
    for (const cookie of ['better-auth.session_token=nope', tampered]) {
      assert.equal((await call('GET', '/admin/shop', undefined, { cookie })).status, 401, cookie)
    }
  })

  test('sign in: the right password gets a session, the wrong one or an unknown email does not', async () => {
    const good = await authCall('/sign-in/email', { email: member.email, password: PASSWORD })
    assert.equal(good.status, 200, JSON.stringify(good.body))
    ok(await call('GET', '/admin/shop', undefined, { cookie: good.cookie! }))

    const wrong = await authCall('/sign-in/email', { email: member.email, password: PASSWORD + 'x' })
    assert.equal(wrong.status, 401)
    assert.equal(wrong.cookie, undefined)
    assert.equal((await authCall('/sign-in/email', { email: fx.email, password: PASSWORD })).status, 401)
  })

  test('signing out ends the session', async () => {
    const { cookie } = await authCall('/sign-in/email', { email: member.email, password: PASSWORD })
    ok(await call('GET', '/admin/shop', undefined, { cookie: cookie! }))
    assert.equal((await authCall('/sign-out', {}, cookie)).status, 200)
    assert.equal((await call('GET', '/admin/shop', undefined, { cookie: cookie! })).status, 401)
  })

  test('a banned account cannot sign in', async () => {
    const banned = await fx.account('member')
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, banned.id))
    const r = await authCall('/sign-in/email', { email: banned.email, password: PASSWORD })
    assert.equal(r.status, 403, JSON.stringify(r.body))
  })
})

describe('sign-up is by invitation only', () => {
  test('no invitation, no account', async () => {
    const email = fx.email
    const r = await authCall('/sign-up/email', { name: 'Nobody', email, password: PASSWORD })
    assert.equal(r.status, 403, JSON.stringify(r.body))
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, email))
    assert.equal(row, undefined)
  })

  test('an expired invitation does not count', async () => {
    const email = fx.email.replace('e2e-', 'e2e-expired-')
    await fx.invitation(SHOP, email, 'member', -1000)
    assert.equal((await authCall('/sign-up/email', { name: 'Late', email, password: PASSWORD })).status, 403)
  })

  test('a cancelled invitation does not count', async () => {
    const email = fx.email.replace('e2e-', 'e2e-cancelled-')
    const id = await fx.invitation(SHOP, email, 'member')
    await db.update(schema.shopInvitations).set({ status: 'canceled' }).where(eq(schema.shopInvitations.id, id))
    assert.equal((await authCall('/sign-up/email', { name: 'Gone', email, password: PASSWORD })).status, 403)
  })

  test('the invitation matches the email in any case', async () => {
    const email = fx.email.replace('e2e-', 'e2e-case-')
    await fx.invitation(SHOP, email.toUpperCase(), 'member')
    const r = await fx.signUp(email)
    assert.equal(r.status, 200, JSON.stringify(r.body))
  })

  test('accepting needs the invited account: someone else cannot take the invitation', async () => {
    const id = await fx.invitation(SHOP, fx.email.replace('e2e-', 'e2e-intended-'), 'admin')
    const r = await authCall('/organization/accept-invitation', { invitationId: id }, outsider.headers.cookie)
    assert.notEqual(r.status, 200)
    const [row] = await db
      .select({ userId: schema.shopMembers.userId })
      .from(schema.shopMembers)
      .where(eq(schema.shopMembers.userId, outsider.id))
    assert.equal(row, undefined, 'the outsider is still in no shop')
  })
})

describe('shop roles', () => {
  const status = (account: Account, path: string) => call('GET', path, undefined, account.headers).then((r) => r.status)

  test('a signed-in account that is in no shop is refused', async () => {
    assert.equal(await status(outsider, '/admin/shop'), 403)
    assert.equal(await status(outsider, '/admin/discounts'), 403)
  })

  test('every member of the shop reaches the shop-wide admin API', async () => {
    for (const a of [owner, admin, member, superadmin]) assert.equal(await status(a, '/admin/shop'), 200)
  })

  test('settings (staff, tokens, keys) are for owners and admins; members are refused', async () => {
    for (const path of ['/admin/staff', '/admin/api-tokens', '/admin/storefront-keys']) {
      assert.equal(await status(member, path), 403, `member ${path}`)
      assert.equal(await status(admin, path), 200, `admin ${path}`)
      assert.equal(await status(owner, path), 200, `owner ${path}`)
      assert.equal(await status(superadmin, path), 200, `superadmin ${path}`)
    }
  })

  test('the app registry is for platform super admins only, not even shop owners', async () => {
    assert.equal(await status(superadmin, '/admin/app-registry'), 200)
    for (const a of [owner, admin, member]) assert.equal(await status(a, '/admin/app-registry'), 403)
  })

  test('members cannot change shop settings', async () => {
    const r = await call('PATCH', '/admin/shop', { name: 'Hacked' }, member.headers)
    assert.ok([401, 403].includes(r.status), String(r.status))
    assert.notEqual(ok(await call('GET', '/admin/shop', undefined, owner.headers)).name, 'Hacked')
  })
})

describe('API tokens', () => {
  test('staff create a token: shown once, never listed, works until revoked', async () => {
    const created = ok(
      await call('POST', '/admin/api-tokens', { name: `E2E ${run}`, scopes: ['read_products'] }, owner.headers),
    )
    fx.apiToken(created.id)
    assert.match(created.token, /^sk_/)
    assert.equal(created.tokenHash, undefined)

    const listed = ok(await call('GET', '/admin/api-tokens', undefined, owner.headers)).find(
      (t: any) => t.id === created.id,
    )
    assert.ok(listed)
    assert.equal(listed.token, undefined, 'the secret is only in the creation response')
    assert.equal(listed.tokenHash, undefined)
    assert.equal(listed.tokenPrefix, created.token.slice(0, listed.tokenPrefix.length))

    const bearer = { authorization: `Bearer ${created.token}` }
    ok(await call('GET', '/admin/products', undefined, bearer))
    ok(await call('POST', `/admin/api-tokens/${created.id}/revoke`, {}, admin.headers))
    assert.equal((await call('GET', '/admin/products', undefined, bearer)).status, 401)
  })

  test('members cannot create tokens', async () => {
    const r = await call('POST', '/admin/api-tokens', { name: 'nope', scopes: ['read_products'] }, member.headers)
    assert.equal(r.status, 403)
  })

  test('a write scope includes read; a read scope does not include write; scopes do not cross resources', async () => {
    const write = await fx.token(['write_discounts'])
    const read = await fx.token(['read_discounts'])
    ok(await call('GET', '/admin/discounts', undefined, write))
    ok(await call('GET', '/admin/discounts', undefined, read))
    assert.equal(
      (await call('POST', '/admin/discounts', { code: `E2E${run}X`, type: 'percentage', value: 5 }, read)).status,
      403,
    )
    assert.equal((await call('GET', '/admin/products', undefined, write)).status, 403)
  })

  test('a token is not a staff session: settings stay out of reach, whatever its scopes', async () => {
    const all = await fx.token(['write_products', 'write_orders', 'write_customers', 'write_discounts'])
    for (const [method, path] of [
      ['GET', '/admin/staff'],
      ['GET', '/admin/api-tokens'],
      ['POST', '/admin/api-tokens'],
      ['GET', '/admin/storefront-keys'],
      ['GET', '/admin/app-registry'],
    ] as const) {
      const r = await call(method, path, method === 'POST' ? { name: 'x', scopes: ['read_products'] } : undefined, all)
      assert.ok([401, 403].includes(r.status), `${method} ${path} → ${r.status}`)
    }
  })

  test('garbage, truncated and revoked tokens are refused; a bearer header beats the cookie', async () => {
    for (const authorization of ['Bearer sk_nope', 'Bearer', 'Bearer ', 'Basic abc', 'Bearer sk_' + 'a'.repeat(43)]) {
      const r = await call('GET', '/admin/shop', undefined, { authorization })
      assert.equal(r.status, 401, authorization)
    }
    const t = await fx.mintToken(['read_products'])
    await revokeApiToken(SHOP, t.id)
    // A valid staff cookie does not rescue a revoked bearer token
    assert.equal((await call('GET', '/admin/shop', undefined, { ...t.headers, ...owner.headers })).status, 401)
  })
})
