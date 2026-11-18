// Products: creating (simple and with variants), slugs, partial updates, listing with its filters and sorts, counts and facets,
// deleting, and what a write sends to channels and webhooks. Every query is scoped to the shop.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, eq, productService, collectionService, variantService, CatalogError, SHOP, OTHER_SHOP } = fx
const refused = (code: string) => (e: unknown) => e instanceof CatalogError && e.code === code
const MISSING = '00000000-0000-4000-8000-000000000000'
const page = { limit: 50, offset: 0 }
const titles = (rows: { title: string }[]) => rows.map((r) => r.title)

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('creating a product', () => {
  test('a simple product has one default variant at its price, and a slug made from the title', async () => {
    const p = await productService.create(SHOP, { title: 'Linen Shirt', priceCents: 2500 })
    assert.equal(p.slug, 'linen-shirt')
    assert.equal(p.status, 'active')
    assert.equal(p.priceCents, 2500)
    assert.deepEqual([p.vendor, p.productType, p.tags], ['', '', []])
    assert.deepEqual(p.options, [])
    assert.equal(p.variants.length, 1)
    assert.deepEqual(
      [p.variants[0]!.title, p.variants[0]!.priceCents, p.variants[0]!.available, p.variants[0]!.options],
      ['Default Title', 2500, true, {}],
    )
    assert.deepEqual(p.images, [])
    assert.deepEqual(p.collectionSlugs, [])
  })

  test('it needs a price or variants, and not both', async () => {
    await assert.rejects(productService.create(SHOP, { title: 'x' }), refused('INVALID_VARIANTS'))
    await assert.rejects(
      productService.create(SHOP, { title: 'x', priceCents: 1, variants: [{ priceCents: 1 }] }),
      refused('HAS_VARIANTS'),
    )
    assert.equal(await productService.count(SHOP, {}), 0)
  })

  test('titles that give the same slug get -2, -3; a given slug is used as is and refused when taken', async () => {
    const slugs = []
    for (let i = 0; i < 3; i++) slugs.push((await productService.create(SHOP, { title: 'Mug', priceCents: 1 })).slug)
    assert.deepEqual(slugs, ['mug', 'mug-2', 'mug-3'])
    const own = await productService.create(SHOP, { title: 'Mug', priceCents: 1, slug: 'my-mug' })
    assert.equal(own.slug, 'my-mug')
    await assert.rejects(
      productService.create(SHOP, { title: 'Other', priceCents: 1, slug: 'my-mug' }),
      refused('SLUG_TAKEN'),
    )
    const theirs = await productService.create(OTHER_SHOP, { title: 'Mug', priceCents: 1, slug: 'my-mug' })
    assert.equal(theirs.slug, 'my-mug', 'another shop may use the same slug')
  })

  test('a title with nothing to make a slug of gets "product"', async () => {
    assert.equal((await productService.create(SHOP, { title: '日本', priceCents: 1 })).slug, 'product')
  })

  test('text fields are trimmed, tags are trimmed and de-duplicated, descriptionHtml is sanitized', async () => {
    const p = await productService.create(SHOP, {
      title: 'T',
      priceCents: 1,
      vendor: '  Acme ',
      productType: ' Shirts ',
      tags: [' a ', 'a', '', 'b'],
      descriptionHtml: '<p onclick="x()">Hi</p><script>x()</script>',
      description: 'Hi',
      seo: { title: 'SEO', description: 'Desc' },
    })
    assert.deepEqual([p.vendor, p.productType, p.tags], ['Acme', 'Shirts', ['a', 'b']])
    assert.equal(p.descriptionHtml, '<p>Hi</p>')
    assert.deepEqual([p.description, p.seoTitle, p.seoDescription], ['Hi', 'SEO', 'Desc'])
    const none = await productService.create(SHOP, {
      title: 'T',
      priceCents: 1,
      descriptionHtml: '<script>x()</script>',
    })
    assert.equal(none.descriptionHtml, null, 'HTML that sanitizes to nothing is stored as null')
  })

  test('images keep their order and alt text', async () => {
    const p = await productService.create(SHOP, {
      title: 'T',
      priceCents: 1,
      images: [{ url: 'https://e.test/1.png', alt: 'one' }, { url: 'https://e.test/2.png' }],
    })
    assert.deepEqual(
      p.images.map((i) => [i.url, i.alt]),
      [
        ['https://e.test/1.png', 'one'],
        ['https://e.test/2.png', null],
      ],
    )
  })

  test('with variants: the product price is the lowest variant price', async () => {
    const p = await productService.create(SHOP, {
      title: 'Tee',
      options: [{ name: 'Size', values: ['S', 'L'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 3000 },
        { options: { Size: 'L' }, priceCents: 2000 },
      ],
    })
    assert.equal(p.priceCents, 2000)
    assert.deepEqual(
      p.variants.map((v) => v.title),
      ['S', 'L'],
    )
  })

  test('is all or nothing: bad variants leave no product behind', async () => {
    await assert.rejects(
      productService.create(SHOP, {
        title: 'Bad',
        options: [{ name: 'Size', values: ['S'] }],
        variants: [{ options: { Size: 'XL' }, priceCents: 1 }],
      }),
      refused('INVALID_VARIANTS'),
    )
    assert.equal(await productService.count(SHOP, {}), 0)
  })

  test('a new product goes on the channels that want new products, and on no others', async () => {
    const auto = await fx.channel({ autoPublish: true })
    const manual = await fx.channel({ autoPublish: false })
    await productService.create(SHOP, { title: 'T', priceCents: 1 })
    const live = (id: string) => productService.list(SHOP, { ...page, channelId: id })
    assert.deepEqual(titles(await live(auto.id)), ['T'])
    assert.deepEqual(await live(manual.id), [])
  })
})

describe('reading products', () => {
  test('getById, getBySlug and getManyByIds are scoped to the shop', async () => {
    const a = await productService.create(SHOP, { title: 'A', priceCents: 1 })
    const b = await productService.create(OTHER_SHOP, { title: 'B', priceCents: 1 })
    assert.equal((await productService.getById(SHOP, a.id))?.title, 'A')
    assert.equal(await productService.getById(SHOP, b.id), null)
    assert.equal(await productService.getById(SHOP, MISSING), null)
    assert.equal((await productService.getBySlug(SHOP, 'a'))?.id, a.id)
    assert.equal(await productService.getBySlug(OTHER_SHOP, 'a'), null)
    assert.deepEqual(titles(await productService.getManyByIds(SHOP, [a.id, b.id])), ['A'])
    assert.deepEqual(await productService.getManyByIds(SHOP, []), [])
  })

  test('withDetails adds images, collection slugs, options and variants to many products at once', async () => {
    const a = await productService.create(SHOP, {
      title: 'A',
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1 },
        { options: { Size: 'M' }, priceCents: 2 },
      ],
      images: [{ url: 'https://e.test/a.png' }],
    })
    const b = await productService.create(SHOP, { title: 'B', priceCents: 5 })
    const c = await collectionService.create(SHOP, { title: 'Summer' })
    await collectionService.addProduct(SHOP, c.id, a.id)
    const rows = await productService.withDetails(await productService.getManyByIds(SHOP, [a.id, b.id]))
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]))
    assert.deepEqual(byTitle.A!.collectionSlugs, ['summer'])
    assert.equal(byTitle.A!.variants.length, 2)
    assert.equal(byTitle.A!.images.length, 1)
    assert.deepEqual(byTitle.B!.collectionSlugs, [])
    assert.equal(byTitle.B!.variants.length, 1)
    assert.deepEqual(await productService.withDetails([]), [])
  })
})

describe('updating a product', () => {
  test('changes only what it is given; null for an unknown product or another shop’s', async () => {
    const p = await productService.create(SHOP, { title: 'Old', priceCents: 100, vendor: 'Acme', tags: ['x'] })
    const u = await productService.update(SHOP, p.id, { title: 'New' })
    assert.deepEqual(
      [u?.title, u?.vendor, u?.tags, u?.slug],
      ['New', 'Acme', ['x'], 'old'],
      'the slug does not follow the title',
    )
    assert.equal(await productService.update(SHOP, MISSING, { title: 'x' }), null)
    const other = await productService.create(OTHER_SHOP, { title: 'Theirs', priceCents: 1 })
    assert.equal(await productService.update(SHOP, other.id, { title: 'Hijacked' }), null)
    assert.equal((await productService.getById(OTHER_SHOP, other.id))?.title, 'Theirs')
  })

  test('status, vendor, type, tags, description, fulfilledBy and SEO can be changed, and cleared where null is allowed', async () => {
    const p = await productService.create(SHOP, {
      title: 'T',
      priceCents: 1,
      descriptionHtml: '<p>x</p>',
      fulfilledBy: 'app_x',
      seo: { title: 's' },
    })
    const u = await productService.update(SHOP, p.id, {
      status: 'draft',
      vendor: ' V ',
      productType: ' P ',
      tags: ['t', 't'],
      descriptionHtml: null,
      fulfilledBy: null,
      seo: { title: null },
    })
    assert.deepEqual(
      [u?.status, u?.vendor, u?.productType, u?.tags, u?.descriptionHtml, u?.fulfilledBy, u?.seoTitle],
      ['draft', 'V', 'P', ['t'], null, null, null],
    )
  })

  test('descriptionHtml is sanitized on update too', async () => {
    const p = await productService.create(SHOP, { title: 'T', priceCents: 1 })
    const u = await productService.update(SHOP, p.id, { descriptionHtml: '<b onclick="x()">x</b>' })
    assert.equal(u?.descriptionHtml, '<b>x</b>')
  })

  test('the slug can change to a free one; a taken one is refused, the product’s own is fine', async () => {
    const a = await productService.create(SHOP, { title: 'A', priceCents: 1 })
    await productService.create(SHOP, { title: 'B', priceCents: 1 })
    assert.equal((await productService.update(SHOP, a.id, { slug: 'renamed' }))?.slug, 'renamed')
    assert.equal((await productService.update(SHOP, a.id, { slug: 'renamed' }))?.slug, 'renamed')
    await assert.rejects(productService.update(SHOP, a.id, { slug: 'b' }), refused('SLUG_TAKEN'))
  })

  test('images, when given, replace the whole set (an empty list removes them); left out, they stay', async () => {
    const p = await productService.create(SHOP, {
      title: 'T',
      priceCents: 1,
      images: [{ url: 'https://e.test/1.png' }, { url: 'https://e.test/2.png' }],
    })
    assert.equal((await productService.update(SHOP, p.id, { title: 'T2' }))?.images.length, 2)
    const swapped = await productService.update(SHOP, p.id, { images: [{ url: 'https://e.test/3.png', alt: 'c' }] })
    assert.deepEqual(
      swapped?.images.map((i) => i.url),
      ['https://e.test/3.png'],
    )
    assert.equal((await productService.update(SHOP, p.id, { images: [] }))?.images.length, 0)
  })

  test('priceCents sets the price of a simple product and the cache with it; with variants it is refused', async () => {
    const simple = await productService.create(SHOP, { title: 'Simple', priceCents: 100 })
    const u = await productService.update(SHOP, simple.id, { priceCents: 250 })
    assert.deepEqual([u?.priceCents, u?.variants[0]?.priceCents], [250, 250])
    const multi = await productService.create(SHOP, {
      title: 'Multi',
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1 },
        { options: { Size: 'M' }, priceCents: 2 },
      ],
    })
    await assert.rejects(productService.update(SHOP, multi.id, { priceCents: 5 }), refused('HAS_VARIANTS'))
  })

  test('a failure undoes the whole update', async () => {
    const a = await productService.create(SHOP, { title: 'A', priceCents: 1 })
    await productService.create(SHOP, { title: 'B', priceCents: 1 })
    await assert.rejects(productService.update(SHOP, a.id, { title: 'Changed', slug: 'b' }), refused('SLUG_TAKEN'))
    assert.equal((await productService.getById(SHOP, a.id))?.title, 'A')
  })
})

describe('deleting products', () => {
  test('removeMany deletes the shop’s own products with their variants, images and channel links, and says how many', async () => {
    const ch = await fx.channel({ autoPublish: true })
    const a = await productService.create(SHOP, {
      title: 'A',
      priceCents: 1,
      images: [{ url: 'https://e.test/1.png' }],
    })
    const b = await productService.create(SHOP, { title: 'B', priceCents: 1 })
    const other = await productService.create(OTHER_SHOP, { title: 'Theirs', priceCents: 1 })
    assert.equal(await productService.removeMany(SHOP, [a.id, other.id, MISSING]), 1)
    assert.equal(await productService.removeMany(SHOP, []), 0)
    assert.ok(await productService.getById(OTHER_SHOP, other.id), 'another shop’s product stays')
    assert.equal(
      (await db.select().from(schema.productVariants).where(eq(schema.productVariants.productId, a.id))).length,
      0,
    )
    assert.equal(
      (await db.select().from(schema.productImages).where(eq(schema.productImages.productId, a.id))).length,
      0,
    )
    assert.deepEqual(titles(await productService.list(SHOP, { ...page, channelId: ch.id })), ['B'])
    const { publicationService } = await import('@shopnex/channels')
    const links = await publicationService.listFor(SHOP, 'product', [a.id, b.id], db)
    assert.deepEqual(links.get(a.id), [], 'the deleted product’s publications are gone')
    assert.ok(
      links.get(b.id)?.some((x) => x.channelId === ch.id),
      'the other product keeps its own',
    )
  })
})

describe('listing, counting and filtering', () => {
  async function seed() {
    const mk = (input: Parameters<typeof productService.create>[1]) => productService.create(SHOP, input)
    const shirt = await mk({
      title: 'Blue Shirt',
      priceCents: 2000,
      vendor: 'Acme',
      productType: 'Shirts',
      tags: ['summer', 'blue'],
    })
    const mug = await mk({
      title: 'Red Mug',
      priceCents: 800,
      vendor: 'Bobs',
      productType: 'Mugs',
      tags: ['red'],
      status: 'draft',
    })
    const hat = await mk({
      title: 'Green Hat',
      vendor: 'Acme',
      productType: 'Hats',
      tags: ['summer'],
      options: [{ name: 'Size', values: ['S', 'L'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1500, sku: 'HAT-S', inventoryQuantity: 0 },
        { options: { Size: 'L' }, priceCents: 3500, sku: 'HAT-L', inventoryQuantity: 0 },
      ],
    })
    await mk({ title: 'Other 100% Cotton_x', priceCents: 100 })
    return { shirt, mug, hat }
  }

  test('newest first by default, paged; count agrees with list', async () => {
    await seed()
    const all = await productService.list(SHOP, page)
    assert.deepEqual(titles(all), ['Other 100% Cotton_x', 'Green Hat', 'Red Mug', 'Blue Shirt'])
    assert.deepEqual(titles(await productService.list(SHOP, { limit: 2, offset: 1 })), ['Green Hat', 'Red Mug'])
    assert.equal(await productService.count(SHOP, {}), 4)
    assert.equal(await productService.count(SHOP, { status: 'active' }), 3)
  })

  test('another shop’s products never show', async () => {
    await seed()
    await productService.create(OTHER_SHOP, { title: 'Theirs', priceCents: 1 })
    assert.equal(await productService.count(SHOP, {}), 4)
    assert.equal(await productService.count(OTHER_SHOP, {}), 1)
  })

  test('status filters; vendors, product types and tags match any of the values', async () => {
    await seed()
    assert.deepEqual(titles(await productService.list(SHOP, { ...page, status: 'draft' })), ['Red Mug'])
    assert.deepEqual(titles(await productService.list(SHOP, { ...page, vendors: ['Acme'], sortKey: 'TITLE' })), [
      'Blue Shirt',
      'Green Hat',
    ])
    assert.deepEqual(
      titles(
        await productService.list(SHOP, {
          ...page,
          vendors: ['Bobs', 'Acme'],
          productTypes: ['Mugs', 'Hats'],
          sortKey: 'TITLE',
        }),
      ),
      ['Green Hat', 'Red Mug'],
    )
    assert.deepEqual(titles(await productService.list(SHOP, { ...page, tags: ['summer', 'red'], sortKey: 'TITLE' })), [
      'Blue Shirt',
      'Green Hat',
      'Red Mug',
    ])
  })

  test('search is case-insensitive over title, vendor, type, tags and SKU, and % and _ are not wildcards', async () => {
    await seed()
    const found = async (search: string) =>
      titles(await productService.list(SHOP, { ...page, search, sortKey: 'TITLE' }))
    assert.deepEqual(await found('SHIRT'), ['Blue Shirt'])
    assert.deepEqual(await found('bobs'), ['Red Mug'])
    assert.deepEqual(await found('hats'), ['Green Hat'])
    assert.deepEqual(await found('summ'), ['Blue Shirt', 'Green Hat'])
    assert.deepEqual(await found('hat-l'), ['Green Hat'])
    assert.deepEqual(await found('  mug  '), ['Red Mug'], 'the term is trimmed')
    assert.deepEqual(await found('100%'), ['Other 100% Cotton_x'])
    assert.deepEqual(await found('%'), ['Other 100% Cotton_x'], 'matches the character, not everything')
    assert.deepEqual(await found('_'), ['Other 100% Cotton_x'])
    assert.equal(await productService.count(SHOP, { search: 'shirt' }), 1)
  })

  test('a price range matches when some variant is inside it', async () => {
    await seed()
    const within = async (min?: number, max?: number) =>
      titles(await productService.list(SHOP, { ...page, minPriceCents: min, maxPriceCents: max, sortKey: 'TITLE' }))
    assert.deepEqual(await within(1000, 2500), ['Blue Shirt', 'Green Hat'])
    assert.deepEqual(await within(3000), ['Green Hat'])
    assert.deepEqual(await within(undefined, 100), ['Other 100% Cotton_x'])
    assert.deepEqual(await within(1600, 3000), ['Blue Shirt'])
  })

  test('available means some variant can be bought: stock not tracked, or above zero', async () => {
    const { hat } = await seed()
    assert.deepEqual(titles(await productService.list(SHOP, { ...page, available: true, sortKey: 'TITLE' })), [
      'Blue Shirt',
      'Other 100% Cotton_x',
      'Red Mug',
    ])
    await variantService.update(SHOP, hat.variants[0]!.id, { inventoryQuantity: 3 })
    assert.equal(await productService.count(SHOP, { available: true }), 4)
  })

  test('sorting by title, price and creation, each reversible', async () => {
    await seed()
    const order = async (sortKey: 'TITLE' | 'PRICE' | 'CREATED_AT', reverse?: boolean) =>
      titles(await productService.list(SHOP, { ...page, sortKey, reverse }))
    assert.deepEqual(await order('TITLE'), ['Blue Shirt', 'Green Hat', 'Other 100% Cotton_x', 'Red Mug'])
    assert.deepEqual(await order('TITLE', true), ['Red Mug', 'Other 100% Cotton_x', 'Green Hat', 'Blue Shirt'])
    assert.deepEqual(await order('PRICE'), ['Other 100% Cotton_x', 'Red Mug', 'Green Hat', 'Blue Shirt'])
    assert.deepEqual(await order('CREATED_AT'), ['Blue Shirt', 'Red Mug', 'Green Hat', 'Other 100% Cotton_x'])
    assert.deepEqual(await order('CREATED_AT', true), ['Other 100% Cotton_x', 'Green Hat', 'Red Mug', 'Blue Shirt'])
  })

  test('a collection filter lists its members in the collection’s own order (MANUAL), and sortKey overrides it', async () => {
    const { shirt, mug, hat } = await seed()
    const c = await collectionService.create(SHOP, { title: 'Picks' })
    for (const p of [hat, shirt, mug]) await collectionService.addProduct(SHOP, c.id, p.id)
    assert.deepEqual(titles(await productService.list(SHOP, { ...page, collection: 'picks' })), [
      'Green Hat',
      'Blue Shirt',
      'Red Mug',
    ])
    assert.deepEqual(
      titles(await productService.list(SHOP, { ...page, collection: 'picks', sortKey: 'MANUAL', reverse: true })),
      ['Red Mug', 'Blue Shirt', 'Green Hat'],
    )
    assert.deepEqual(titles(await productService.list(SHOP, { ...page, collection: 'picks', sortKey: 'TITLE' })), [
      'Blue Shirt',
      'Green Hat',
      'Red Mug',
    ])
    assert.equal(await productService.count(SHOP, { collection: 'picks' }), 3)
    assert.equal(await productService.count(SHOP, { collection: 'nope' }), 0)
    assert.deepEqual(
      titles(await productService.list(SHOP, { ...page, collection: 'picks', status: 'active', sortKey: 'TITLE' })),
      ['Blue Shirt', 'Green Hat'],
    )
  })

  test('channelId lists only what is published on that channel now (a scheduled publication is not live yet)', async () => {
    const { shirt, mug } = await seed()
    const ch = await fx.channel()
    await productService.setPublications(SHOP, shirt.id, [{ channelId: ch.id }])
    await productService.setPublications(SHOP, mug.id, [
      { channelId: ch.id, publishAt: new Date(Date.now() + 3_600_000) },
    ])
    assert.deepEqual(titles(await productService.list(SHOP, { ...page, channelId: ch.id })), ['Blue Shirt'])
    assert.equal(await productService.count(SHOP, { channelId: ch.id }), 1)
  })

  test('facets count what the matching products have, most common first, with the price range of their variants', async () => {
    await seed()
    const f = await productService.facets(SHOP, {})
    assert.deepEqual(
      f.vendors,
      [
        { value: 'Acme', count: 2 },
        { value: 'Bobs', count: 1 },
      ],
      'products without a vendor are left out',
    )
    assert.deepEqual(
      f.productTypes.map((t) => t.value),
      ['Hats', 'Mugs', 'Shirts'],
    )
    assert.deepEqual(f.tags, [
      { value: 'summer', count: 2 },
      { value: 'blue', count: 1 },
      { value: 'red', count: 1 },
    ])
    assert.deepEqual(f.price, { minCents: 100, maxCents: 3500 })
    const active = await productService.facets(SHOP, { status: 'active', vendors: ['Acme'] })
    assert.deepEqual(active.vendors, [{ value: 'Acme', count: 2 }], 'the filter’s own selection is counted')
    assert.deepEqual(active.price, { minCents: 1500, maxCents: 3500 })
    assert.deepEqual(await productService.facets(SHOP, { search: 'nothing-matches' }), {
      vendors: [],
      productTypes: [],
      tags: [],
      price: null,
    })
  })
})

describe('what a write tells webhooks', () => {
  test('create queues product.created with the product as the admin API returns it; update queues product.updated', async () => {
    const hook = await fx.endpoint(['product.created', 'product.updated'])
    const p = await productService.create(SHOP, { title: 'Hooked', priceCents: 700 })
    await productService.update(SHOP, p.id, { title: 'Hooked 2' })
    const sent = await fx.deliveries(hook.id)
    assert.deepEqual(sent.map((d) => d.topic).sort(), ['product.created', 'product.updated'])
    const created = sent.find((d) => d.topic === 'product.created')!.data
    assert.deepEqual([created.id, created.title, created.priceCents], [p.id, 'Hooked', 700])
    assert.equal((sent.find((d) => d.topic === 'product.updated')!.data as { title: string }).title, 'Hooked 2')
  })

  test('nothing is queued for an endpoint not subscribed to the topic, and a write that fails queues nothing', async () => {
    const quiet = await fx.endpoint(['product.updated'])
    const loud = await fx.endpoint(['product.created'])
    await assert.rejects(
      productService.create(SHOP, {
        title: 'Bad',
        options: [{ name: 'Size', values: ['S'] }],
        variants: [{ options: { Size: 'XL' }, priceCents: 1 }],
      }),
    )
    assert.deepEqual(await fx.deliveries(loud.id), [], 'the rolled-back create queued nothing')
    await productService.create(SHOP, { title: 'Fine', priceCents: 1 })
    assert.deepEqual(await fx.deliveries(quiet.id), [])
    assert.equal((await fx.deliveries(loud.id)).length, 1)
  })

  test('setPublications puts the product on exactly those channels, queues product.updated, and gives back the publications; null for an unknown product', async () => {
    const hook = await fx.endpoint(['product.updated'])
    const [a, b] = [await fx.channel(), await fx.channel()]
    const p = await productService.create(SHOP, { title: 'Pub', priceCents: 1 })
    const first = await productService.setPublications(SHOP, p.id, [{ channelId: a.id }])
    assert.deepEqual(
      first?.map((x) => x.channelId),
      [a.id],
    )
    const second = await productService.setPublications(SHOP, p.id, [{ channelId: b.id }])
    assert.deepEqual(
      second?.map((x) => x.channelId),
      [b.id],
      'a channel left out is removed',
    )
    assert.equal((await fx.deliveries(hook.id)).length, 2)
    assert.equal(await productService.setPublications(SHOP, MISSING, []), null)
  })
})

describe('sample products', () => {
  test('seedSampleProducts adds four only into an empty shop, and says how many', async () => {
    const { seedSampleProducts } = await import('../src')
    assert.equal(await seedSampleProducts(OTHER_SHOP), 4)
    assert.equal(await seedSampleProducts(OTHER_SHOP), 0, 'a second click adds nothing')
    const rows = await productService.list(OTHER_SHOP, { ...page, sortKey: 'TITLE' })
    assert.deepEqual(titles(rows), ['Ceramic Cup', 'Classic Tee', 'Leather Jacket', 'Leather Shoulder Bag'])
    const jacket = await productService.withDetails(rows.filter((r) => r.title === 'Leather Jacket'))
    assert.deepEqual(
      jacket[0]!.variants.map((v) => v.title),
      ['S', 'M', 'L'],
    )
    assert.ok(rows.every((r) => r.vendor === 'Sample' && r.tags.includes('sample')))
  })
})
