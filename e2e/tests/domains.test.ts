// Storefront domains end to end: adding, verifying and removing a domain through the admin API, who may manage
// them, and that a domain belongs to one shop. DNS isn't available here, so verification is expected to fail
// until the row is marked verified directly. The server runs in single mode (the admin always acts in the default
// shop), so a second shop is driven through the service rather than the API; host-based resolution itself needs
// TENANCY_MODE=multi (see tenancy.test.ts).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, like } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { DomainError, domainService } from '@shopnex/tenancy'
import { Fixtures, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36)
const host = (name: string) => `${name}-${run}.e2e.example.com`

type Account = Awaited<ReturnType<Fixtures['account']>>
let owner: Account
let member: Account
let otherShop: string

before(async () => {
  await requireApp()
  await fx.init()
  otherShop = (await fx.shop()).id
  ;[owner, member] = await Promise.all([fx.account('owner'), fx.account('member')])
})

after(async () => {
  await db.delete(schema.shopDomains).where(like(schema.shopDomains.domain, `%-${run}.e2e.example.com`))
  await fx.cleanup()
  await closeDb()
})

const theirs = (id: string) => domainService.listDomains(otherShop).then((rows) => rows.some((r) => r.id === id))
const notFound = (error: unknown) => error instanceof DomainError && error.code === 'DOMAIN_NOT_FOUND'
const list = async (as: Account = owner) => ok(await call('GET', '/admin/domains', undefined, as.headers))
const add = (as: Account, domain: string) => call('POST', '/admin/domains', { domain }, as.headers)

describe('adding a domain', () => {
  test('it starts unverified with the TXT record to create', async () => {
    const d = ok(await add(owner, `https://${host('Add').toUpperCase()}/`))
    assert.equal(d.domain, host('add'), 'stored as a bare lowercase host')
    assert.equal(d.verified, false)
    assert.deepEqual(d.record, {
      type: 'TXT',
      name: `_shopnex-challenge.${host('add')}`,
      value: d.record.value,
    })
    assert.ok(d.record.value.length >= 16)
    assert.ok((await list()).domains.some((x: any) => x.id === d.id))
  })

  test('not a hostname: rejected', async () => {
    for (const bad of ['localhost', '127.0.0.1', 'shop.example.com:3000', 'not a domain']) {
      assert.equal((await add(owner, bad)).status, 400, bad)
    }
  })

  test('adding it twice is a conflict', async () => {
    ok(await add(owner, host('twice')))
    assert.equal((await add(owner, host('twice'))).status, 409)
  })

  test('another shop can take over a domain that was never verified', async () => {
    const mine = ok(await add(owner, host('claim')))
    const taken = await domainService.addDomain(otherShop, host('claim'))
    assert.notEqual(taken.verificationToken, mine.record.value, 'a fresh token')
    assert.ok(!(await list()).domains.some((x: any) => x.id === mine.id))
    assert.ok(await theirs(taken.id))
  })

  test('a verified domain cannot be taken by another shop', async () => {
    const mine = ok(await add(owner, host('held')))
    await db.update(schema.shopDomains).set({ verifiedAt: new Date() }).where(eq(schema.shopDomains.id, mine.id))
    await assert.rejects(domainService.addDomain(otherShop, host('held')), { code: 'DOMAIN_TAKEN' })
    assert.ok((await list()).domains.some((x: any) => x.id === mine.id && x.verified))
  })
})

describe('verifying a domain', () => {
  test('without the TXT record it stays pending', async () => {
    const d = ok(await add(owner, host('pending')))
    const result = ok(await call('POST', `/admin/domains/${d.id}/verify`, undefined, owner.headers))
    assert.equal(result.verified, false)
    assert.equal(result.domain.verified, false)
  })

  test("another shop's domain is not found", async () => {
    const d = ok(await add(owner, host('private')))
    await assert.rejects(domainService.verifyDomain(otherShop, d.id), notFound)
    await assert.rejects(domainService.removeDomain(otherShop, d.id), notFound)
    assert.ok(
      (await list()).domains.some((x: any) => x.id === d.id),
      'left alone',
    )
  })
})

describe('removing a domain', () => {
  test('it is gone from the list', async () => {
    const d = ok(await add(owner, host('remove')))
    ok(await call('DELETE', `/admin/domains/${d.id}`, undefined, owner.headers))
    assert.ok(!(await list()).domains.some((x: any) => x.id === d.id))
    assert.equal((await call('DELETE', `/admin/domains/${d.id}`, undefined, owner.headers)).status, 404)
  })
})

describe('who may manage domains', () => {
  test('plain staff cannot list, add, verify or remove', async () => {
    const d = ok(await add(owner, host('staff')))
    assert.equal((await call('GET', '/admin/domains', undefined, member.headers)).status, 403)
    assert.equal((await add(member, host('staff2'))).status, 403)
    assert.equal((await call('POST', `/admin/domains/${d.id}/verify`, undefined, member.headers)).status, 403)
    assert.equal((await call('DELETE', `/admin/domains/${d.id}`, undefined, member.headers)).status, 403)
  })
})
