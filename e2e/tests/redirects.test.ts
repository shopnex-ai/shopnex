// URL redirects end to end: staff manage them, the Storefront API resolves them, the storefront answers 301 where it
// would show a 404, and renaming a product adds its redirect. Needs the storefront running for the last two
// (STOREFRONT_URL, default http://localhost:4321).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const STOREFRONT = (process.env.STOREFRONT_URL ?? 'http://localhost:4321').replace(/\/$/, '')
const fx = new Fixtures()
const run = Date.now().toString(36)

let owner: Awaited<ReturnType<Fixtures['account']>>
let token: Record<string, string>
let storefront: Record<string, string>
const redirectIds: string[] = []
const productIds: string[] = []

const make = async (fromPath: string, toPath: string) => {
  const created = ok(await call('POST', '/admin/redirects', { fromPath, toPath }, owner.headers))
  redirectIds.push(created.id)
  return created
}

before(async () => {
  await requireApp()
  await fx.init()
  owner = await fx.account('owner')
  token = await fx.token(['write_products'])
  storefront = { 'x-shopnex-key': (await fx.storefrontKey(SHOP)).token }
})

after(async () => {
  for (const id of redirectIds) await call('DELETE', `/admin/redirects/${id}`, undefined, owner.headers)
  for (const id of productIds) await call('DELETE', `/admin/products/${id}`, undefined, token)
  await fx.cleanup()
  await closeDb()
})

describe('url redirects', () => {
  test('staff add, find, edit and delete a redirect', async () => {
    const created = await make(`/old-${run}/`, `/pages/new-${run}`)
    assert.equal(created.fromPath, `/old-${run}`)

    const found = ok(await call('GET', `/admin/redirects?search=old-${run}`, undefined, owner.headers))
    assert.deepEqual(
      found.items.map((r: { id: string }) => r.id),
      [created.id],
    )

    const edited = ok(
      await call('PATCH', `/admin/redirects/${created.id}`, { toPath: '/collections/all' }, owner.headers),
    )
    assert.equal(edited.toPath, '/collections/all')

    const again = await call('POST', '/admin/redirects', { fromPath: `/old-${run}`, toPath: '/x' }, owner.headers)
    assert.equal(again.status, 409, 'one redirect per old URL')

    const bad = await call('POST', '/admin/redirects', { fromPath: 'no-slash', toPath: '/x' }, owner.headers)
    assert.equal(bad.status, 400)

    ok(await call('DELETE', `/admin/redirects/${created.id}`, undefined, owner.headers))
    const gone = ok(await call('GET', `/admin/redirects?search=old-${run}`, undefined, owner.headers))
    assert.equal(gone.total, 0)
  })

  test('the Storefront API resolves a path, and says NOT_FOUND for any other', async () => {
    await make(`/resolve-${run}`, 'https://example.com/landing')
    const hit = ok(await call('GET', `/storefront/redirects/resolve?path=/resolve-${run}/`, undefined, storefront))
    assert.deepEqual(hit, { target: 'https://example.com/landing' })
    const miss = await call('GET', `/storefront/redirects/resolve?path=/nothing-${run}`, undefined, storefront)
    assert.equal(miss.status, 404)
  })

  test('the storefront answers 301 where it would show a 404, and keeps the visitor’s query', async () => {
    await make(`/moved-${run}`, '/collections/all')
    const moved = await fetch(`${STOREFRONT}/moved-${run}?utm_source=mail`, { redirect: 'manual' })
    assert.equal(moved.status, 301)
    assert.equal(new URL(moved.headers.get('location')!, STOREFRONT).pathname, '/collections/all')
    assert.equal(new URL(moved.headers.get('location')!, STOREFRONT).search, '?utm_source=mail')

    const missing = await fetch(`${STOREFRONT}/missing-${run}`, { redirect: 'manual' })
    assert.equal(missing.status, 404)
  })

  test('renaming a product through the API redirects its old address', async () => {
    const product = ok(
      await call('POST', '/admin/products', { title: `Mug ${run}`, slug: `mug-${run}`, priceCents: 1200 }, token),
    )

    productIds.push(product.id)
    ok(await call('PATCH', `/admin/products/${product.id}`, { slug: `ceramic-mug-${run}` }, token))

    const hit = ok(await call('GET', `/storefront/redirects/resolve?path=/products/mug-${run}`, undefined, storefront))
    assert.deepEqual(hit, { target: `/products/ceramic-mug-${run}` })
    const listed = ok(await call('GET', `/admin/redirects?search=mug-${run}`, undefined, owner.headers))
    redirectIds.push(...listed.items.map((r: { id: string }) => r.id))
  })
})
