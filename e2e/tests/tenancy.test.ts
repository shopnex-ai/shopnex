// Shop isolation end to end: what a token or a publishable key reaches depends on its shop and nothing else.
// The server runs in single mode (one default shop), so a second shop is created in the database; tokens and
// keys of that shop are resolved by the same code that separates shops in multi mode. Host-based resolution
// (TENANCY_MODE=multi) needs its own server and isn't covered here.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { revokeApiToken } from '@shopnex/tenancy'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36).toUpperCase()

let otherId: string
let a: Record<string, string> // token of the default shop
let b: Record<string, string> // token of the other shop

before(async () => {
  await requireApp()
  await fx.init()
  otherId = (await fx.shop()).id
  const scopes = ['write_discounts', 'write_products', 'write_customers', 'write_orders'] as const
  a = await fx.token([...scopes])
  b = await fx.token([...scopes], otherId)
})

after(async () => {
  await fx.cleanup()
  await closeDb()
})

describe('admin API tokens', () => {
  test('a token acts in its own shop', async () => {
    assert.equal(ok(await call('GET', '/admin/shop', undefined, a)).id, SHOP)
    assert.equal(ok(await call('GET', '/admin/shop', undefined, b)).id, otherId)
  })

  test("one shop's data is invisible to another shop's token", async () => {
    const d = ok(await call('POST', '/admin/discounts', { code: `E2E${run}ISO`, type: 'percentage', value: 10 }, a))
    fx.discount(d.id)

    const ids = (list: any[]) => list.map((x) => x.id)
    assert.ok(ids(ok(await call('GET', '/admin/discounts', undefined, a))).includes(d.id))
    assert.ok(!ids(ok(await call('GET', '/admin/discounts', undefined, b))).includes(d.id))

    // By id the discount doesn't exist for the other shop: not readable, not editable, not deletable
    assert.equal((await call('GET', `/admin/discounts/${d.id}`, undefined, b)).status, 404)
    assert.equal((await call('PATCH', `/admin/discounts/${d.id}`, { value: 99 }, b)).status, 404)
    assert.equal((await call('DELETE', `/admin/discounts/${d.id}`, undefined, b)).status, 404)
    assert.equal(ok(await call('GET', `/admin/discounts/${d.id}`, undefined, a)).value, 10, 'left alone')
  })

  test('the other shop starts empty: no products, customers or orders of the default shop', async () => {
    const products = ok(await call('GET', '/admin/products', undefined, b))
    assert.equal(products.total, 0)
    assert.deepEqual(products.items, [])
    assert.ok(ok(await call('GET', '/admin/products', undefined, a)).total > 0, 'the default shop has products')

    for (const path of ['/admin/customers', '/admin/orders']) {
      const body = ok(await call('GET', path, undefined, b))
      assert.equal((body.items ?? body).length, 0, path)
    }
  })

  test('the same code can be used in both shops, each with its own discount', async () => {
    const code = `E2E${run}BOTH`
    const x = ok(await call('POST', '/admin/discounts', { code, type: 'percentage', value: 5 }, a))
    const y = ok(await call('POST', '/admin/discounts', { code, type: 'percentage', value: 15 }, b))
    fx.discount(x.id)
    assert.notEqual(x.id, y.id)
    assert.equal(y.value, 15)
  })

  test('headers cannot move a token to another shop', async () => {
    const key = await fx.storefrontKey(otherId)
    const r = await call('GET', '/admin/shop', undefined, {
      ...a,
      'x-shopnex-key': key.token,
      'x-forwarded-host': 'other.example.com',
    })
    assert.equal(ok(r).id, SHOP)
  })

  test('a revoked token stops working, the other shop is unaffected', async () => {
    const t = await fx.mintToken(['read_products'])
    ok(await call('GET', '/admin/products', undefined, t.headers))
    assert.ok(await revokeApiToken(SHOP, t.id))
    assert.equal((await call('GET', '/admin/products', undefined, t.headers)).status, 401)
    ok(await call('GET', '/admin/shop', undefined, b))
  })

  test("a shop cannot revoke another shop's token", async () => {
    const t = await fx.mintToken(['read_products'], otherId)
    assert.equal(await revokeApiToken(SHOP, t.id), null)
    ok(await call('GET', '/admin/products', undefined, t.headers))
  })
})

describe('storefront keys', () => {
  test('a publishable key selects its shop', async () => {
    const key = await fx.storefrontKey(otherId)
    const shop = ok(await call('GET', '/storefront/shop', undefined, { 'x-shopnex-key': key.token }))
    assert.match(shop.name, /^E2E shop /)

    const own = await fx.storefrontKey(SHOP)
    const mine = ok(await call('GET', '/storefront/shop', undefined, { 'x-shopnex-key': own.token }))
    assert.doesNotMatch(mine.name, /^E2E shop /)
  })

  test("the other shop's storefront has none of the default shop's catalog", async () => {
    const key = await fx.storefrontKey(otherId)
    const products = ok(await call('GET', '/storefront/products', undefined, { 'x-shopnex-key': key.token }))
    assert.equal((products.nodes ?? products.edges ?? products.items).length, 0)

    const own = await fx.storefrontKey(SHOP)
    const mine = ok(await call('GET', '/storefront/products', undefined, { 'x-shopnex-key': own.token }))
    assert.ok((mine.nodes ?? mine.edges ?? mine.items).length > 0)
  })

  test('an unknown key is an error, never a fallback to the default shop', async () => {
    const r = await call('GET', '/storefront/shop', undefined, { 'x-shopnex-key': 'pk_does-not-exist' })
    assert.equal(r.status, 401)
  })

  test('a revoked key stops working', async () => {
    const key = await fx.storefrontKey(otherId)
    ok(await call('GET', '/storefront/shop', undefined, { 'x-shopnex-key': key.token }))
    await db.update(schema.storefrontKeys).set({ revokedAt: new Date() }).where(eq(schema.storefrontKeys.id, key.id))
    assert.equal((await call('GET', '/storefront/shop', undefined, { 'x-shopnex-key': key.token })).status, 401)
  })

  test('a publishable key opens nothing in the admin API', async () => {
    const key = await fx.storefrontKey(SHOP)
    assert.equal((await call('GET', '/admin/shop', undefined, { 'x-shopnex-key': key.token })).status, 401)
    assert.equal((await call('GET', '/admin/shop', undefined, { authorization: `Bearer ${key.token}` })).status, 401)
  })
})
