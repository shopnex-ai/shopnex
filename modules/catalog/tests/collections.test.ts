// Collections: slugs, partial updates, which channels they are on, and which products are in them and in what order.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, eq, productService, collectionService, CatalogError, SHOP, OTHER_SHOP } = fx
const refused = (code: string) => (e: unknown) => e instanceof CatalogError && e.code === code
const MISSING = '00000000-0000-4000-8000-000000000000'
const page = { limit: 50, offset: 0 }
const product = (title: string, shop = SHOP) => productService.create(shop, { title, priceCents: 100 })

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('creating a collection', () => {
  test('the slug is made from the title (-2, -3 when taken in the shop) or given and refused when taken', async () => {
    const slugs = []
    for (let i = 0; i < 3; i++) slugs.push((await collectionService.create(SHOP, { title: 'Summer' })).slug)
    assert.deepEqual(slugs, ['summer', 'summer-2', 'summer-3'])
    assert.equal((await collectionService.create(SHOP, { title: 'x', slug: 'mine' })).slug, 'mine')
    await assert.rejects(collectionService.create(SHOP, { title: 'y', slug: 'mine' }), refused('SLUG_TAKEN'))
    assert.equal((await collectionService.create(OTHER_SHOP, { title: 'y', slug: 'mine' })).slug, 'mine')
    assert.equal((await collectionService.create(SHOP, { title: '!!!' })).slug, 'collection')
  })

  test('description, image and SEO are stored and the HTML is sanitized (to null when nothing is left)', async () => {
    const c = await collectionService.create(SHOP, {
      title: 'C',
      description: 'plain',
      descriptionHtml: '<p onclick="x()">Hi</p>',
      imageUrl: 'https://e.test/c.png',
      seo: { title: 'S', description: 'D' },
    })
    assert.deepEqual(
      [c.description, c.descriptionHtml, c.imageUrl, c.seoTitle, c.seoDescription],
      ['plain', '<p>Hi</p>', 'https://e.test/c.png', 'S', 'D'],
    )
    assert.equal(
      (await collectionService.create(SHOP, { title: 'D', descriptionHtml: '<script>x()</script>' })).descriptionHtml,
      null,
    )
  })

  test('a new collection goes on the channels that want new ones only', async () => {
    const auto = await fx.channel({ autoPublish: true })
    const manual = await fx.channel()
    await collectionService.create(SHOP, { title: 'Live' })
    assert.deepEqual(
      (await collectionService.list(SHOP, { ...page, channelId: auto.id })).map((c) => c.title),
      ['Live'],
    )
    assert.deepEqual(await collectionService.list(SHOP, { ...page, channelId: manual.id }), [])
  })
})

describe('reading collections', () => {
  test('list is oldest first, paged and the shop’s own; getById, getBySlug are scoped to the shop', async () => {
    const [a, b] = [
      await collectionService.create(SHOP, { title: 'A' }),
      await collectionService.create(SHOP, { title: 'B' }),
    ]
    const theirs = await collectionService.create(OTHER_SHOP, { title: 'Theirs' })
    assert.deepEqual(
      (await collectionService.list(SHOP, page)).map((c) => c.title),
      ['A', 'B'],
    )
    assert.deepEqual(
      (await collectionService.list(SHOP, { limit: 1, offset: 1 })).map((c) => c.title),
      ['B'],
    )
    assert.equal((await collectionService.getById(SHOP, a.id))?.title, 'A')
    assert.equal(await collectionService.getById(SHOP, theirs.id), null)
    assert.equal(await collectionService.getById(SHOP, MISSING), null)
    assert.equal((await collectionService.getBySlug(SHOP, 'b'))?.id, b.id)
    assert.equal(await collectionService.getBySlug(SHOP, 'theirs'), null)
  })

  test('liveSlugs names which of the slugs are on the channel now', async () => {
    const ch = await fx.channel()
    const [a] = [
      await collectionService.create(SHOP, { title: 'A' }),
      await collectionService.create(SHOP, { title: 'B' }),
    ]
    const { publicationService } = await import('@shopnex/channels')
    await publicationService.set(SHOP, 'collection', a.id, [{ channelId: ch.id }], db)
    assert.deepEqual([...(await collectionService.liveSlugs(SHOP, ch.id, ['a', 'b', 'zzz']))], ['a'])
    assert.equal((await collectionService.liveSlugs(SHOP, ch.id, [])).size, 0)
    assert.equal((await collectionService.liveSlugs(OTHER_SHOP, ch.id, ['a'])).size, 0)
  })
})

describe('updating a collection', () => {
  test('changes only what is given, null for an unknown or another shop’s collection', async () => {
    const c = await collectionService.create(SHOP, {
      title: 'Old',
      description: 'keep',
      imageUrl: 'https://e.test/1.png',
    })
    const u = await collectionService.update(SHOP, c.id, { title: 'New' })
    assert.deepEqual([u?.title, u?.slug, u?.description, u?.imageUrl], ['New', 'old', 'keep', 'https://e.test/1.png'])
    const cleared = await collectionService.update(SHOP, c.id, {
      description: null,
      imageUrl: null,
      descriptionHtml: '<b onclick="x()">b</b>',
      seo: { title: 'T' },
    })
    assert.deepEqual(
      [cleared?.description, cleared?.imageUrl, cleared?.descriptionHtml, cleared?.seoTitle],
      [null, null, '<b>b</b>', 'T'],
    )
    assert.equal(await collectionService.update(SHOP, MISSING, { title: 'x' }), null)
    const theirs = await collectionService.create(OTHER_SHOP, { title: 'Theirs' })
    assert.equal(await collectionService.update(SHOP, theirs.id, { title: 'Hijacked' }), null)
  })

  test('the slug can change to a free one, not to a taken one, and may stay as it is', async () => {
    const a = await collectionService.create(SHOP, { title: 'A' })
    await collectionService.create(SHOP, { title: 'B' })
    assert.equal((await collectionService.update(SHOP, a.id, { slug: 'a' }))?.slug, 'a')
    assert.equal((await collectionService.update(SHOP, a.id, { slug: 'renamed' }))?.slug, 'renamed')
    await assert.rejects(collectionService.update(SHOP, a.id, { slug: 'b' }), refused('SLUG_TAKEN'))
  })
})

describe('deleting collections', () => {
  test('remove deletes one and its links but not its products; null when it is not the shop’s', async () => {
    const ch = await fx.channel({ autoPublish: true })
    const c = await collectionService.create(SHOP, { title: 'C' })
    const p = await product('P')
    await collectionService.addProduct(SHOP, c.id, p.id)
    const theirs = await collectionService.create(OTHER_SHOP, { title: 'T' })
    assert.equal(await collectionService.remove(SHOP, theirs.id), null)
    assert.equal((await collectionService.remove(SHOP, c.id))?.id, c.id)
    assert.ok(await productService.getById(SHOP, p.id), 'the product stays')
    assert.equal(
      (await db.select().from(schema.productCollections).where(eq(schema.productCollections.collectionId, c.id)))
        .length,
      0,
    )
    assert.deepEqual(await collectionService.list(SHOP, { ...page, channelId: ch.id }), [])
    const { publicationService } = await import('@shopnex/channels')
    const links = await publicationService.listFor(SHOP, 'collection', [c.id], db)
    assert.deepEqual(links.get(c.id), [], 'its publications are gone')
    assert.equal(await collectionService.remove(SHOP, c.id), null)
  })

  test('removeMany deletes the shop’s own and says how many', async () => {
    const [a, b] = [
      await collectionService.create(SHOP, { title: 'A' }),
      await collectionService.create(SHOP, { title: 'B' }),
    ]
    const theirs = await collectionService.create(OTHER_SHOP, { title: 'T' })
    assert.equal(await collectionService.removeMany(SHOP, [a.id, theirs.id, MISSING]), 1)
    assert.equal(await collectionService.removeMany(SHOP, []), 0)
    assert.deepEqual(
      (await collectionService.list(SHOP, page)).map((c) => c.id),
      [b.id],
    )
    assert.ok(await collectionService.getById(OTHER_SHOP, theirs.id))
  })
})

describe('the products in a collection', () => {
  test('new members go to the end, in order; adding one again changes nothing; listProducts gives title and status in that order', async () => {
    const c = await collectionService.create(SHOP, { title: 'C' })
    const [x, y, z] = [
      await product('X'),
      await product('Y'),
      await productService.create(SHOP, { title: 'Z', priceCents: 1, status: 'draft' }),
    ]
    for (const p of [y, x, z]) await collectionService.addProduct(SHOP, c.id, p.id)
    await collectionService.addProduct(SHOP, c.id, y.id)
    assert.deepEqual(await collectionService.listProducts(SHOP, c.id), [
      { id: y.id, title: 'Y', status: 'active' },
      { id: x.id, title: 'X', status: 'active' },
      { id: z.id, title: 'Z', status: 'draft' },
    ])
  })

  test('removeProduct takes it out and the rest keep their order; removing a non-member is fine', async () => {
    const c = await collectionService.create(SHOP, { title: 'C' })
    const [x, y] = [await product('X'), await product('Y')]
    await collectionService.addProduct(SHOP, c.id, x.id)
    await collectionService.addProduct(SHOP, c.id, y.id)
    await collectionService.removeProduct(SHOP, c.id, x.id)
    await collectionService.removeProduct(SHOP, c.id, x.id)
    assert.deepEqual(
      (await collectionService.listProducts(SHOP, c.id)).map((p) => p.title),
      ['Y'],
    )
    const z = await product('Z')
    await collectionService.addProduct(SHOP, c.id, z.id)
    assert.deepEqual(
      (await collectionService.listProducts(SHOP, c.id)).map((p) => p.title),
      ['Y', 'Z'],
    )
  })

  test('both must be the shop’s: nothing is ever linked across shops', async () => {
    const mine = await collectionService.create(SHOP, { title: 'Mine' })
    const theirs = await collectionService.create(OTHER_SHOP, { title: 'Theirs' })
    const myProduct = await product('Mine')
    const theirProduct = await product('Theirs', OTHER_SHOP)
    await assert.rejects(collectionService.addProduct(SHOP, theirs.id, myProduct.id), refused('COLLECTION_NOT_FOUND'))
    await assert.rejects(collectionService.addProduct(SHOP, mine.id, theirProduct.id), refused('PRODUCT_NOT_FOUND'))
    await assert.rejects(collectionService.addProduct(SHOP, MISSING, myProduct.id), refused('COLLECTION_NOT_FOUND'))
    await assert.rejects(
      collectionService.removeProduct(SHOP, theirs.id, theirProduct.id),
      refused('COLLECTION_NOT_FOUND'),
    )
    assert.equal((await db.select().from(schema.productCollections)).length, 0)
  })

  test('productCounts says how many each collection has, for the shop’s own collections only', async () => {
    const [a, b] = [
      await collectionService.create(SHOP, { title: 'A' }),
      await collectionService.create(SHOP, { title: 'B' }),
    ]
    const theirs = await collectionService.create(OTHER_SHOP, { title: 'T' })
    for (const t of ['1', '2']) await collectionService.addProduct(SHOP, a.id, (await product(t)).id)
    await collectionService.addProduct(OTHER_SHOP, theirs.id, (await product('t', OTHER_SHOP)).id)
    const counts = await collectionService.productCounts(SHOP, [a.id, b.id, theirs.id])
    assert.deepEqual([counts.get(a.id), counts.get(b.id), counts.get(theirs.id)], [2, undefined, undefined])
    assert.equal((await collectionService.productCounts(SHOP, [])).size, 0)
  })

  test('deleting a product takes it out of its collections', async () => {
    const c = await collectionService.create(SHOP, { title: 'C' })
    const p = await product('P')
    await collectionService.addProduct(SHOP, c.id, p.id)
    await productService.removeMany(SHOP, [p.id])
    assert.deepEqual(await collectionService.listProducts(SHOP, c.id), [])
  })
})
