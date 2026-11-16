// URL redirects on a real in-memory database (PGlite): the rules for a redirect, and the ones a renamed product,
// collection or page adds by itself.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { prepareDatabase } = await import('@shopnex/db')
const { CatalogError, collectionService, productService, redirectService } = await import('@shopnex/catalog')
const { pageService } = await import('../src')

const SHOP = 'default'

before(async () => {
  await prepareDatabase()
})

after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

const rejectsWith = (code: string, work: Promise<unknown>) =>
  assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof CatalogError, String(error))
    assert.equal(error.code, code)
    return true
  })

const all = async () =>
  Object.fromEntries(
    (await redirectService.list(SHOP, { limit: 100, offset: 0 })).items.map((r) => [r.fromPath, r.toPath]),
  )

describe('a redirect', () => {
  test('is created from a path, and a trailing slash does not matter when it is looked up', async () => {
    const created = await redirectService.create(SHOP, { fromPath: ' /old-shipping/ ', toPath: '/pages/shipping' })
    assert.equal(created.fromPath, '/old-shipping')
    assert.equal(await redirectService.resolve(SHOP, '/old-shipping'), '/pages/shipping')
    assert.equal(await redirectService.resolve(SHOP, '/old-shipping/'), '/pages/shipping')
    assert.equal(await redirectService.resolve(SHOP, '/nothing-here'), null)
  })

  test('may go to another site', async () => {
    const created = await redirectService.create(SHOP, { fromPath: '/blog', toPath: 'https://blog.example.com' })
    assert.equal(created.toPath, 'https://blog.example.com/')
  })

  test('refuses a second redirect from the same path', async () => {
    await rejectsWith('REDIRECT_TAKEN', redirectService.create(SHOP, { fromPath: '/old-shipping', toPath: '/x' }))
  })

  test('refuses what cannot work', async () => {
    for (const [fromPath, toPath] of [
      ['old', '/new'], // not a path
      ['//evil.example', '/new'], // not on this store
      ['/old?x=1', '/new'], // a query is not part of the path
      ['/', '/new'], // the front page
      ['/same', '/same'], // a loop
      ['/old', 'javascript:alert(1)'], // not http(s)
      ['/old', '//evil.example'], // protocol-relative
      ['/old', ''],
    ]) {
      await rejectsWith('REDIRECT_INVALID', redirectService.create(SHOP, { fromPath, toPath: toPath! }))
    }
  })

  test('can be edited, and cannot take the place of another', async () => {
    const a = await redirectService.create(SHOP, { fromPath: '/edit-a', toPath: '/one' })
    await redirectService.create(SHOP, { fromPath: '/edit-b', toPath: '/two' })
    const saved = await redirectService.update(SHOP, a.id, { toPath: '/three' })
    assert.equal(saved?.toPath, '/three')
    await rejectsWith('REDIRECT_TAKEN', redirectService.update(SHOP, a.id, { fromPath: '/edit-b' }))
    assert.equal(await redirectService.update(SHOP, crypto.randomUUID(), { toPath: '/x' }), null)
  })

  test('is deleted one at a time or many at once, and only in its own shop', async () => {
    const a = await redirectService.create(SHOP, { fromPath: '/del-a', toPath: '/x' })
    const b = await redirectService.create(SHOP, { fromPath: '/del-b', toPath: '/x' })
    assert.equal((await redirectService.remove('other-shop', a.id)) ?? null, null)
    assert.equal((await redirectService.remove(SHOP, a.id))?.id, a.id)
    assert.equal(await redirectService.removeMany('other-shop', [b.id]), 0)
    assert.equal(await redirectService.removeMany(SHOP, [b.id]), 1)
  })

  test('is found by search on either address', async () => {
    await redirectService.create(SHOP, { fromPath: '/find-me-100%', toPath: '/somewhere-else' })
    const byFrom = await redirectService.list(SHOP, { search: 'find-me-100%', limit: 20, offset: 0 })
    assert.deepEqual(
      byFrom.items.map((r) => r.fromPath),
      ['/find-me-100%'],
    )
    const byTo = await redirectService.list(SHOP, { search: 'somewhere-else', limit: 20, offset: 0 })
    assert.equal(byTo.total, 1)
    assert.equal(
      (await redirectService.list(SHOP, { search: '%', limit: 20, offset: 0 })).total,
      1,
      '% is not a wildcard',
    )
  })
})

describe('a renamed product, collection or page', () => {
  test('a product keeps its old address', async () => {
    const product = await productService.create(SHOP, { title: 'Mug', slug: 'mug', priceCents: 1000 })
    await productService.update(SHOP, product.id, { slug: 'ceramic-mug' })
    assert.equal(await redirectService.resolve(SHOP, '/products/mug'), '/products/ceramic-mug')
    // Saving without a new slug adds nothing
    await productService.update(SHOP, product.id, { vendor: 'Acme' })
    assert.equal((await all())['/products/ceramic-mug'], undefined)
  })

  test('a collection keeps its old address', async () => {
    const collection = await collectionService.create(SHOP, { title: 'Summer', slug: 'summer' })
    await collectionService.update(SHOP, collection.id, { slug: 'summer-2026' })
    assert.equal(await redirectService.resolve(SHOP, '/collections/summer'), '/collections/summer-2026')
  })

  test('a page keeps its old address', async () => {
    const page = await pageService.create(SHOP, { title: 'Delivery', handle: 'delivery' })
    await pageService.update(SHOP, page.id, { handle: 'shipping-policy' })
    assert.equal(await redirectService.resolve(SHOP, '/pages/delivery'), '/pages/shipping-policy')
  })

  test('renaming twice leaves no chain: every old address goes straight to the current one', async () => {
    const product = await productService.create(SHOP, { title: 'Hat', slug: 'hat-a', priceCents: 500 })
    await productService.update(SHOP, product.id, { slug: 'hat-b' })
    await productService.update(SHOP, product.id, { slug: 'hat-c' })
    const redirects = await all()
    assert.equal(redirects['/products/hat-a'], '/products/hat-c')
    assert.equal(redirects['/products/hat-b'], '/products/hat-c')
  })

  test('renaming back to an old address removes the redirect that would loop', async () => {
    const product = await productService.create(SHOP, { title: 'Bag', slug: 'bag-a', priceCents: 500 })
    await productService.update(SHOP, product.id, { slug: 'bag-b' })
    await productService.update(SHOP, product.id, { slug: 'bag-a' })
    const redirects = await all()
    assert.equal(redirects['/products/bag-a'], undefined, 'the product lives there again')
    assert.equal(redirects['/products/bag-b'], '/products/bag-a')
  })

  test('a redirect to a handle that is taken by something else is replaced when it is renamed away', async () => {
    await redirectService.create(SHOP, { fromPath: '/products/scarf', toPath: '/collections/winter' })
    const product = await productService.create(SHOP, { title: 'Scarf', slug: 'scarf', priceCents: 500 })
    await productService.update(SHOP, product.id, { slug: 'wool-scarf' })
    assert.equal(await redirectService.resolve(SHOP, '/products/scarf'), '/products/wool-scarf')
  })
})
