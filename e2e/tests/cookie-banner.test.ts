// The cookie banner setting: who can change it, that it defaults to off, and that the storefront API tells a storefront.
// What the visitor sees is in browser/cookie-consent.spec.ts. Puts the shop's setting back at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { getShopById, updateShop } from '@shopnex/tenancy'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
let owner: Record<string, string>
let member: Record<string, string>
let storefront: Record<string, string>
let original: boolean

before(async () => {
  await requireApp()
  await fx.init()
  original = (await getShopById(SHOP))!.cookieBanner
  owner = (await fx.account('owner')).headers
  member = (await fx.account('member')).headers
  storefront = { 'x-shopnex-key': (await fx.storefrontKey(SHOP)).token }
})

after(async () => {
  await updateShop(SHOP, { cookieBanner: original })
  await fx.cleanup()
  await closeDb()
})

const banner = async () => ok(await call('GET', '/storefront/shop', undefined, storefront)).cookieBanner

describe('cookie banner setting', () => {
  test('is off until the shop turns it on, and the storefront API says which', async () => {
    await updateShop(SHOP, { cookieBanner: false })
    assert.equal(await banner(), false)
    assert.equal(ok(await call('GET', '/admin/shop', undefined, owner)).cookieBanner, false)

    const saved = ok(await call('PATCH', '/admin/shop', { cookieBanner: true }, owner))
    assert.equal(saved.cookieBanner, true)
    assert.equal(await banner(), true)

    ok(await call('PATCH', '/admin/shop', { cookieBanner: false }, owner))
    assert.equal(await banner(), false)
  })

  test('changing it leaves the other settings alone', async () => {
    const before = ok(await call('GET', '/admin/shop', undefined, owner))
    const after = ok(await call('PATCH', '/admin/shop', { cookieBanner: true }, owner))
    assert.deepEqual({ ...after, cookieBanner: before.cookieBanner }, before)
  })

  test('only owners and admins can change it, and it must be a boolean', async () => {
    await updateShop(SHOP, { cookieBanner: false })
    assert.equal((await call('PATCH', '/admin/shop', { cookieBanner: true }, member)).status, 403, 'staff')
    assert.equal((await call('PATCH', '/admin/shop', { cookieBanner: true }, {})).status, 401, 'nobody')
    assert.equal((await call('PATCH', '/admin/shop', { cookieBanner: 'yes' }, owner)).status, 400, 'not a boolean')
    assert.equal(await banner(), false)
  })
})
