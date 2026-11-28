import type { Conn } from '@shopnex/db'
// The public Storefront API for what a shopper browses: the shop, products (list, filters, sorting, paging, facets, one), collections, pages,
// menus and the theme. Through the real router with an in-memory database, the way a storefront calls it. Only what is active and published
// on the storefront's channel is ever shown.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { ORPCError } from '@orpc/server'
import * as fx from './fixtures'

const { db, eq, sf, run, SHOP, MISSING } = fx
const { shops } = fx
const { appService } = await import('@shopnex/apps')
const { apps } = await import('@shopnex/core/schema')

const refused = (code: string, status?: number) => (e: unknown) =>
  e instanceof ORPCError && e.code === code && (status === undefined || e.status === status)
const page = { first: 20 }
type Node = { id: string; handle: string; title: string }
type Connection<T = Node> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
const handles = (c: Connection) => c.nodes.map((n) => n.handle)

before(fx.setup)
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('the shop and who is asking', () => {
  test('the shop as the storefront needs it: name, handle, currency, SEO and the cookie banner', async () => {
    await db
      .update(shops)
      .set({ name: 'Maison', currency: 'EUR', seoTitle: 'Maison — shop', cookieBanner: true })
      .where(eq(shops.id, SHOP))
    const shop = await run<Record<string, unknown>>(sf.shop!.get)
    assert.deepEqual(
      [shop.id, shop.name, shop.currencyCode, shop.seo, shop.cookieBanner],
      [SHOP, 'Maison', 'EUR', { title: 'Maison — shop', description: null }, true],
    )
    assert.equal(typeof shop.handle, 'string')
    await db.update(shops).set({ cookieBanner: false }).where(eq(shops.id, SHOP))
  })

  test('the scripts installed apps add to the online store are part of the shop, and only while installed', async () => {
    const appUrl = 'http://127.0.0.1:4999'
    const { app } = await appService.registerApp(
      { name: `Widget ${Date.now()}`, appUrl, redirectUrls: [], scopes: ['write_storefront'] },
      null,
    )
    try {
      assert.deepEqual((await run<{ scripts: string[] }>(sf.shop!.get)).scripts, [], 'none to begin with')
      const installation = await appService.installManaged({
        appId: app.id,
        shopId: SHOP,
        userId: null as unknown as string,
        scopes: ['write_storefront'],
      })
      const src = `${appUrl}/widget.js?shop=${SHOP}`
      await appService.configureStorefrontScripts(SHOP, app.id, [src], db)
      assert.deepEqual((await run<{ scripts: string[] }>(sf.shop!.get)).scripts, [src])
      await appService.uninstall(SHOP, installation.id)
      assert.deepEqual((await run<{ scripts: string[] }>(sf.shop!.get)).scripts, [], 'gone with the app')
    } finally {
      await db.delete(apps).where(eq(apps.id, app.id))
    }
  })

  test('a publishable key is the shop and the channel of the key; an unknown or revoked one is UNAUTHORIZED', async () => {
    const { channel, key } = await fx.quietChannel()
    const onStore = await fx.product({ title: 'On the store' })
    const onQuiet = await fx.product({ title: 'On the quiet channel' })
    await fx.channelService.getById
    const { publicationService } = await import('@shopnex/channels')
    await publicationService.set(SHOP, 'product', onQuiet.id, [{ channelId: channel.id }], db)
    const quiet = await run<Connection>(sf.products!.list, page, { [fx.PUBLISHABLE_KEY_HEADER]: key })
    assert.deepEqual(
      quiet.nodes.map((n) => n.id),
      [onQuiet.id],
    )
    assert.deepEqual(
      (await run<Connection>(sf.products!.list, page)).nodes.map((n) => n.id),
      [onStore.id, onQuiet.id].filter((id) => id === onStore.id || false),
    )
    await assert.rejects(run(sf.shop!.get, undefined, { [fx.PUBLISHABLE_KEY_HEADER]: 'pk_unknown' }), (e: unknown) => {
      assert.ok(e instanceof ORPCError)
      assert.equal(e.code, 'UNAUTHORIZED')
      assert.match(e.message, /Invalid or revoked publishable key/)
      return true
    })
    const keys = await fx.storefrontKeyService.list(SHOP, db)
    await fx.storefrontKeyService.revoke(SHOP, keys.find((k) => k.channelId === channel.id)!.id, db)
    await assert.rejects(run(sf.shop!.get, undefined, { [fx.PUBLISHABLE_KEY_HEADER]: key }), refused('UNAUTHORIZED'))
  })
})

describe('listing products', () => {
  test('only active products published on the channel, newest first, in the contract’s shape', async () => {
    const a = await fx.product({ title: 'A', vendor: 'Acme', productType: 'Shirts', tags: ['x'] })
    await new Promise((r) => setTimeout(r, 5))
    await fx.product({ title: 'B' })
    await fx.product({ title: 'Draft', status: 'draft' })
    await fx.product({ title: 'Archived', status: 'archived' })
    await fx.product({ title: 'Theirs' }, fx.OTHER_SHOP)
    const list = await run<Connection>(sf.products!.list, page)
    assert.deepEqual(
      list.nodes.map((n) => n.title),
      ['B', 'A'],
    )
    assert.deepEqual(list.pageInfo, { hasNextPage: false, endCursor: list.pageInfo.endCursor })
    assert.ok(list.pageInfo.endCursor)
    const first = list.nodes[1] as unknown as Record<string, unknown>
    assert.deepEqual(
      [first.id, first.handle, first.vendor, first.productType, first.tags],
      [a.id, a.slug, 'Acme', 'Shirts', ['x']],
    )
  })

  test('pages by cursor: first and after, with hasNextPage and an endCursor that continues where it stopped', async () => {
    for (const t of ['P1', 'P2', 'P3']) {
      await fx.product({ title: t })
      await new Promise((r) => setTimeout(r, 5))
    }
    const one = await run<Connection>(sf.products!.list, { first: 2, sortKey: 'TITLE' })
    assert.deepEqual([one.nodes.map((n) => n.title), one.pageInfo.hasNextPage], [['P1', 'P2'], true])
    const two = await run<Connection>(sf.products!.list, { first: 2, sortKey: 'TITLE', after: one.pageInfo.endCursor! })
    assert.deepEqual([two.nodes.map((n) => n.title), two.pageInfo.hasNextPage], [['P3'], false])
    await assert.rejects(
      run(sf.products!.list, { first: 2, after: 'garbage' }),
      (e: unknown) => e instanceof ORPCError && e.code === 'BAD_REQUEST' && /Invalid cursor/.test(e.message),
    )
  })

  test('sorts by title or price, either way', async () => {
    await fx.product({ title: 'B', priceCents: 300 })
    await fx.product({ title: 'A', priceCents: 900 })
    await fx.product({ title: 'C', priceCents: 100 })
    const titles = async (input: object) =>
      (await run<Connection>(sf.products!.list, { ...page, ...input })).nodes.map((n) => n.title)
    assert.deepEqual(await titles({ sortKey: 'TITLE' }), ['A', 'B', 'C'])
    assert.deepEqual(await titles({ sortKey: 'TITLE', reverse: true }), ['C', 'B', 'A'])
    assert.deepEqual(await titles({ sortKey: 'PRICE' }), ['C', 'B', 'A'])
    assert.deepEqual(await titles({ sortKey: 'PRICE', reverse: 'true' }), ['A', 'B', 'C'])
  })

  test('filters: search, vendor, type, tag, price range, available — values within one match any, different filters all apply', async () => {
    await fx.product({ title: 'Blue shirt', vendor: 'Acme', productType: 'Shirts', tags: ['summer'], priceCents: 2000 })
    await fx.product({ title: 'Red mug', vendor: 'Bobs', productType: 'Mugs', tags: ['red'], priceCents: 800 })
    await fx.product({
      title: 'Green hat',
      vendor: 'Acme',
      productType: 'Hats',
      tags: ['summer'],
      variants: [{ priceCents: 1500, inventoryQuantity: 0 }],
    })
    const found = async (input: object) =>
      (await run<Connection>(sf.products!.list, { ...page, sortKey: 'TITLE', ...input })).nodes.map((n) => n.title)
    assert.deepEqual(await found({ query: 'SHIRT' }), ['Blue shirt'])
    assert.deepEqual(await found({ vendor: ['Acme'] }), ['Blue shirt', 'Green hat'])
    assert.deepEqual(await found({ vendor: ['Acme', 'Bobs'], productType: ['Mugs', 'Hats'] }), ['Green hat', 'Red mug'])
    assert.deepEqual(await found({ tag: ['red', 'summer'] }), ['Blue shirt', 'Green hat', 'Red mug'])
    assert.deepEqual(await found({ minPrice: 1000, maxPrice: 1800 }), ['Green hat'])
    assert.deepEqual(await found({ available: true }), ['Blue shirt', 'Red mug'])
    assert.deepEqual(await found({ vendor: ['Acme'], available: 'true', maxPrice: 5000 }), ['Blue shirt'])
  })

  test('a custom field filter works only for fields the shop shows on the storefront', async () => {
    await fx.customFieldService.create(
      SHOP,
      { resource: 'product', key: 'material', label: 'Material', type: 'text', storefront: true },
      db,
    )
    await fx.customFieldService.create(
      SHOP,
      { resource: 'product', key: 'secret', label: 'Secret', type: 'text', storefront: false },
      db,
    )
    await fx.product({ title: 'Linen', customFields: { material: 'Linen', secret: 'x' } })
    await fx.product({ title: 'Cotton', customFields: { material: 'Cotton', secret: 'x' } })
    const found = async (customField: string[]) =>
      (await run<Connection>(sf.products!.list, { ...page, customField })).nodes.map((n) => n.title)
    assert.deepEqual(await found(['material:Linen']), ['Linen'])
    await assert.rejects(found(['secret:x']))
    const [shown] = (
      await run<Connection<{ customFields: Record<string, unknown> }>>(sf.products!.list, {
        ...page,
        customField: ['material:Linen'],
      })
    ).nodes
    assert.deepEqual(shown?.customFields, { material: 'Linen' }, 'the hidden field is not shown')
  })

  test('a collection shows its published products in its own order; one not published on the channel has no products', async () => {
    const [a, b] = [await fx.product({ title: 'A' }), await fx.product({ title: 'B' })]
    const live = await fx.collectionService.create(SHOP, { title: 'Picks' }, db)
    await fx.collectionService.addProduct(SHOP, live.id, b.id, db)
    await fx.collectionService.addProduct(SHOP, live.id, a.id, db)
    assert.deepEqual(
      (await run<Connection>(sf.products!.list, { ...page, collection: live.slug })).nodes.map((n) => n.title),
      ['B', 'A'],
    )
    const { channel } = await fx.quietChannel()
    const { publicationService } = await import('@shopnex/channels')
    await publicationService.set(SHOP, 'collection', live.id, [{ channelId: channel.id }], db)
    assert.deepEqual(await run(sf.products!.list, { ...page, collection: live.slug }), {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    })
    assert.deepEqual(await run(sf.products!.list, { ...page, collection: 'nope' }), {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    })
  })

  test('facets count what the shopper could filter by, for the same collection and search', async () => {
    await fx.product({ title: 'Blue shirt', vendor: 'Acme', productType: 'Shirts', tags: ['summer'], priceCents: 2000 })
    await fx.product({
      title: 'Red shirt',
      vendor: 'Acme',
      productType: 'Shirts',
      tags: ['summer', 'red'],
      priceCents: 1000,
    })
    await fx.product({ title: 'Draft', vendor: 'Hidden', status: 'draft' })
    const f = await run<{ vendors: unknown; productTypes: unknown; tags: unknown; price: unknown }>(
      sf.products!.facets,
      {},
    )
    assert.deepEqual(f.vendors, [{ value: 'Acme', count: 2 }])
    assert.deepEqual(f.productTypes, [{ value: 'Shirts', count: 2 }])
    assert.deepEqual(f.tags, [
      { value: 'summer', count: 2 },
      { value: 'red', count: 1 },
    ])
    assert.deepEqual(f.price, {
      min: { amountMinor: 1000, currencyCode: 'USD' },
      max: { amountMinor: 2000, currencyCode: 'USD' },
    })
    const narrowed = await run<{ price: unknown }>(sf.products!.facets, { query: 'blue' })
    assert.deepEqual(narrowed.price, {
      min: { amountMinor: 2000, currencyCode: 'USD' },
      max: { amountMinor: 2000, currencyCode: 'USD' },
    })
    assert.deepEqual(await run(sf.products!.facets, { collection: 'nope' }), {
      vendors: [],
      productTypes: [],
      tags: [],
      price: null,
    })
  })
})

describe('one product', () => {
  test('by id and by handle, with prices, images, options, variants and the collections it is in', async () => {
    const p = await fx.product({
      title: 'Tee',
      descriptionHtml: '<p>Soft</p>',
      images: [{ url: 'https://example.com/tee.png', alt: 'A tee' }],
      seo: { title: 'SEO tee', description: 'Desc' },
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1000, compareAtPriceCents: 1500, sku: 'TEE-S' },
        { options: { Size: 'M' }, priceCents: 1200, inventoryQuantity: 0, imageUrl: 'https://example.com/m.png' },
      ],
    })
    const c = await fx.collectionService.create(SHOP, { title: 'Summer' }, db)
    await fx.collectionService.addProduct(SHOP, c.id, p.id, db)
    const byId = await run<Record<string, any>>(sf.products!.get, { id: p.id })
    const byHandle = await run<Record<string, any>>(sf.products!.getByHandle, { handle: p.slug })
    assert.equal(byId.id, byHandle.id)
    assert.deepEqual(
      [byId.handle, byId.availableForSale, byId.collectionHandles, byId.seo],
      ['tee', true, ['summer'], { title: 'SEO tee', description: 'Desc' }],
    )
    assert.deepEqual(byId.priceRange, {
      minVariantPrice: { amountMinor: 1000, currencyCode: 'USD' },
      maxVariantPrice: { amountMinor: 1200, currencyCode: 'USD' },
    })
    assert.deepEqual(byId.compareAtPriceRange.minVariantPrice.amountMinor, 1500)
    assert.deepEqual(byId.featuredImage, {
      id: byId.images[0].id,
      url: 'https://example.com/tee.png',
      altText: 'A tee',
      width: null,
      height: null,
    })
    const [s, m] = byId.variants
    assert.deepEqual(
      [s.title, s.sku, s.availableForSale, s.price.amountMinor, s.compareAtPrice.amountMinor, s.image.url],
      ['S', 'TEE-S', true, 1000, 1500, 'https://example.com/tee.png'],
    )
    assert.deepEqual([m.availableForSale, m.compareAtPrice, m.image.url], [false, null, 'https://example.com/m.png'])
    assert.deepEqual(
      byId.options[0].optionValues.map((v: { name: string }) => v.name),
      ['S', 'M'],
    )
    assert.match(byId.createdAt, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('the description is the text, else the HTML as text; the HTML is the HTML, else the text as a paragraph, escaped', async () => {
    const htmlOnly = await fx.product({ title: 'H', descriptionHtml: '<p>One</p><p>Two &amp; three</p>' })
    const textOnly = await fx.product({ title: 'T', description: 'a < b' })
    const h = await run<Record<string, string>>(sf.products!.get, { id: htmlOnly.id })
    const t = await run<Record<string, string>>(sf.products!.get, { id: textOnly.id })
    assert.deepEqual([h.description, h.descriptionHtml], ['One Two & three', '<p>One</p><p>Two &amp; three</p>'])
    assert.deepEqual([t.description, t.descriptionHtml], ['a < b', '<p>a &lt; b</p>'])
  })

  test('a product that is a draft, archived, not published on the channel, unknown or another shop’s is NOT_FOUND', async () => {
    const draft = await fx.product({ title: 'D', status: 'draft' })
    const archived = await fx.product({ title: 'A', status: 'archived' })
    const hidden = await fx.product({ title: 'H' })
    const { channel } = await fx.quietChannel()
    const { publicationService } = await import('@shopnex/channels')
    await publicationService.set(SHOP, 'product', hidden.id, [{ channelId: channel.id }], db)
    const theirs = await fx.product({ title: 'T' }, fx.OTHER_SHOP)
    for (const p of [draft, archived, hidden, theirs]) {
      await assert.rejects(run(sf.products!.get, { id: p.id }), refused('NOT_FOUND'), p.title)
    }
    await assert.rejects(run(sf.products!.get, { id: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(run(sf.products!.getByHandle, { handle: draft.slug }), refused('NOT_FOUND'))
    await assert.rejects(run(sf.products!.getByHandle, { handle: 'nope' }), refused('NOT_FOUND'))
  })

  test('names only the collections that are published on the channel', async () => {
    const p = await fx.product({ title: 'Tee' })
    const [shown, hidden] = [
      await fx.collectionService.create(SHOP, { title: 'Shown' }, db),
      await fx.collectionService.create(SHOP, { title: 'Hidden' }, db),
    ]
    await fx.collectionService.addProduct(SHOP, shown.id, p.id, db)
    await fx.collectionService.addProduct(SHOP, hidden.id, p.id, db)
    const { channel } = await fx.quietChannel()
    const { publicationService } = await import('@shopnex/channels')
    await publicationService.set(SHOP, 'collection', hidden.id, [{ channelId: channel.id }], db)
    assert.deepEqual((await run<{ collectionHandles: string[] }>(sf.products!.get, { id: p.id })).collectionHandles, [
      'shown',
    ])
    assert.deepEqual(
      (await run<Connection<{ collectionHandles: string[] }>>(sf.products!.list, page)).nodes[0]?.collectionHandles,
      ['shown'],
    )
  })
})

describe('collections', () => {
  test('the published ones, oldest first, paged, with their image and SEO; one by handle', async () => {
    const a = await fx.collectionService.create(
      SHOP,
      {
        title: 'A',
        imageUrl: 'https://example.com/a.png',
        descriptionHtml: '<p>About A</p>',
        seo: { title: 'SEO A' },
      },
      db,
    )
    await new Promise((r) => setTimeout(r, 5))
    await fx.collectionService.create(SHOP, { title: 'B' }, db)
    await fx.collectionService.create(SHOP, { title: 'Theirs' }, db).then(() => undefined)
    const list = await run<Connection<Record<string, any>>>(sf.collections!.list, { first: 1 })
    assert.deepEqual([list.nodes.map((c) => c.title), list.pageInfo.hasNextPage], [['A'], true])
    const second = await run<Connection>(sf.collections!.list, { first: 5, after: list.pageInfo.endCursor! })
    assert.deepEqual(
      second.nodes.map((c) => c.title),
      ['B', 'Theirs'],
    )
    const one = await run<Record<string, any>>(sf.collections!.getByHandle, { handle: a.slug })
    assert.deepEqual(
      [one.id, one.title, one.image, one.seo, one.descriptionHtml],
      [
        a.id,
        'A',
        { id: null, url: 'https://example.com/a.png', altText: 'A', width: null, height: null },
        { title: 'SEO A', description: null },
        '<p>About A</p>',
      ],
    )
  })

  test('one that is not published on the channel, or does not exist, is NOT_FOUND and not listed', async () => {
    const hidden = await fx.collectionService.create(SHOP, { title: 'Hidden' }, db)
    const { channel, key } = await fx.quietChannel()
    assert.deepEqual(
      (await run<Connection>(sf.collections!.list, page, { [fx.PUBLISHABLE_KEY_HEADER]: key })).nodes,
      [],
    )
    await assert.rejects(
      run(sf.collections!.getByHandle, { handle: hidden.slug }, { [fx.PUBLISHABLE_KEY_HEADER]: key }),
      refused('NOT_FOUND'),
    )
    await assert.rejects(run(sf.collections!.getByHandle, { handle: 'nope' }), refused('NOT_FOUND'))
    assert.ok(channel)
  })
})

describe('pages and menus', () => {
  test('only published pages are listed or found, with a summary cut at a word', async () => {
    const long = `<p>${'word '.repeat(60)}</p>`
    await fx.pageService.create(SHOP, { handle: 'about', title: 'About', bodyHtml: '<p>Short <b>text</b></p>' }, db)
    await fx.pageService.create(SHOP, { handle: 'long', title: 'Long', bodyHtml: long }, db)
    await fx.pageService.create(SHOP, { handle: 'draft', title: 'Draft', bodyHtml: '<p>x</p>', published: false }, db)
    const later = await fx.pageService.create(SHOP, { handle: 'later', title: 'Later', bodyHtml: '<p>x</p>' }, db)
    await db
      .update(fx.schemas.pages)
      .set({ publishedAt: new Date(Date.now() + 3_600_000) })
      .where(eq(fx.schemas.pages.id, later.id))
    const list = await run<Connection>(sf.pages!.list, page)
    assert.deepEqual(list.nodes.map((p) => p.handle).sort(), ['about', 'long'])
    const about = await run<Record<string, any>>(sf.pages!.getByHandle, { handle: 'about' })
    assert.deepEqual([about.title, about.body, about.bodySummary], ['About', '<p>Short <b>text</b></p>', 'Short text'])
    const cut = (await run<Record<string, string>>(sf.pages!.getByHandle, { handle: 'long' })).bodySummary!
    assert.ok(cut.endsWith('…') && cut.length <= 151 && !/\s…$/.test(cut), cut)
    await assert.rejects(run(sf.pages!.getByHandle, { handle: 'draft' }), refused('NOT_FOUND'))
    await assert.rejects(run(sf.pages!.getByHandle, { handle: 'later' }), refused('NOT_FOUND'), 'scheduled for later')
    await assert.rejects(run(sf.pages!.getByHandle, { handle: 'nope' }), refused('NOT_FOUND'))
  })

  test('a menu with its links resolved to addresses, dropping what is gone, unpublished or not for sale; unknown handle is NOT_FOUND', async () => {
    const [p, soldOut, gone] = [
      await fx.product({ title: 'Tee' }),
      await fx.product({ title: 'Withdrawn' }),
      await fx.collectionService.create(SHOP, { title: 'Gone' }, db),
    ]
    const c = await fx.collectionService.create(SHOP, { title: 'Summer' }, db)
    const [pg, hiddenPage] = [
      await fx.pageService.create(SHOP, { handle: 'about', title: 'About', bodyHtml: '<p>x</p>' }, db),
      await fx.pageService.create(SHOP, { handle: 'hidden', title: 'Hidden', bodyHtml: '<p>x</p>' }, db),
    ]
    const item = (type: string, extra: object = {}) => ({
      id: `i-${fx.unique()}`,
      title: type,
      type,
      items: [],
      ...extra,
    })
    await fx.menuService.create(
      SHOP,
      {
        handle: 'main',
        title: 'Main',
        items: [
          item('frontpage', {
            items: [item('collection', { resourceId: c.id, items: [item('product', { resourceId: p.id })] })],
          }),
          item('product', { resourceId: soldOut.id }),
          item('page', { resourceId: pg.id }),
          item('page', { resourceId: hiddenPage.id }),
          item('http', { url: 'https://example.com/x' }),
          item('collection', { resourceId: gone.id }),
        ],
      } as never,
      db,
    )
    await fx.productService.update(SHOP, soldOut.id, { status: 'draft' }, db)
    await fx.pageService.update(SHOP, hiddenPage.id, { published: false }, db)
    await fx.collectionService.remove(SHOP, gone.id, db)
    const menu = await run<{ handle: string; items: Array<{ url: string; handle: string | null; items: any[] }> }>(
      sf.menu!.get,
      { handle: 'main' },
    )
    assert.equal(menu.handle, 'main')
    assert.deepEqual(
      menu.items.map((i) => i.url),
      ['/', '/pages/about', 'https://example.com/x'],
    )
    assert.deepEqual(
      [menu.items[0]!.items[0]!.url, menu.items[0]!.items[0]!.handle, menu.items[0]!.items[0]!.items[0]!.url],
      ['/collections/summer', 'summer', `/products/${p.slug}`],
    )
    await assert.rejects(run(sf.menu!.get, { handle: 'nope' }), refused('NOT_FOUND'))
  })
})

describe('the theme', () => {
  const doc = (marker: string) => ({ settings: { marker }, pages: {} })

  test('a shop without themes: nothing to render but the defaults', async () => {
    assert.deepEqual(await run(sf.theme!.current, {}), { themeId: null, document: null, preview: false, files: null })
    assert.deepEqual(await run(sf.theme!.files, {}), { copyId: null, version: 0, files: {} })
    assert.deepEqual(await run(sf.theme!.get, { themeId: 'maison' }), { document: null, preview: false })
  })

  test('the live theme and its published document; what is only a draft is not shown without a preview token', async () => {
    const copy = (await fx.themeService.ensure(
      SHOP,
      { themeId: 'maison', name: 'Maison', draft: doc('draft') } as never,
      db,
    ))!
    assert.deepEqual(
      await run(sf.theme!.current, {}),
      { themeId: 'maison', document: null, preview: false, files: null },
      'live but never published',
    )
    await fx.themeService.publish(SHOP, copy.id, db)
    await fx.themeService.saveDraft(SHOP, copy.id, doc('newer draft') as never, db)
    const current = await run<Record<string, any>>(sf.theme!.current, {})
    assert.deepEqual(
      [current.themeId, current.document.settings.marker, current.preview, current.files],
      ['maison', 'draft', false, null],
    )
    assert.equal(
      (await run<Record<string, any>>(sf.theme!.get, { themeId: 'maison' })).document.settings.marker,
      'draft',
    )
    assert.deepEqual(await run(sf.theme!.get, { themeId: 'another' }), { document: null, preview: false })
  })

  test('a valid preview token shows the draft of that copy, marked as a preview; an invalid, expired or another shop’s one is ignored', async () => {
    const copy = (await fx.themeService.ensure(
      SHOP,
      { themeId: 'maison', name: 'Maison', draft: doc('published') } as never,
      db,
    ))!
    await fx.themeService.publish(SHOP, copy.id, db)
    await fx.themeService.saveDraft(SHOP, copy.id, doc('draft') as never, db)
    const { token } = fx.createPreviewToken(SHOP, copy.id)
    const preview = await run<Record<string, any>>(sf.theme!.current, { previewToken: token })
    assert.deepEqual([preview.preview, preview.document.settings.marker, preview.themeId], [true, 'draft', 'maison'])
    const viaGet = await run<Record<string, any>>(sf.theme!.get, { themeId: 'maison', previewToken: token })
    assert.deepEqual([viaGet.preview, viaGet.document.settings.marker], [true, 'draft'])
    assert.deepEqual(
      await run(sf.theme!.get, { themeId: 'another', previewToken: token }),
      { document: null, preview: false },
      'a preview of one theme is not shown as another',
    )
    for (const bad of [
      'garbage',
      fx.createPreviewToken(SHOP, copy.id, Date.now() - 2 * 3_600_000).token,
      fx.createPreviewToken('another-shop', copy.id).token,
    ]) {
      const shown = await run<Record<string, any>>(sf.theme!.current, { previewToken: bad })
      assert.deepEqual([shown.preview, shown.document.settings.marker], [false, 'published'], bad.slice(0, 12))
    }
  })

  test('edited code files: announced by current, and served by files with their version — the draft in a preview, the published ones live', async () => {
    const copy = (await fx.themeService.ensure(
      SHOP,
      { themeId: 'maison', name: 'Maison', draft: doc('a') } as never,
      db,
    ))!
    await fx.themeService.publish(SHOP, copy.id, db)
    await fx.themeService.saveFile(SHOP, copy.id, 'snippets/hello.liquid', '<p>draft</p>', db)
    const { token } = fx.createPreviewToken(SHOP, copy.id)
    const preview = await run<{ copyId: string; version: number; files: Record<string, string> }>(sf.theme!.files, {
      previewToken: token,
    })
    assert.deepEqual([preview.copyId, Object.keys(preview.files)], [copy.id, ['snippets/hello.liquid']])
    assert.deepEqual((await run<{ files: object }>(sf.theme!.files, {})).files, {}, 'unpublished code is not live')
    assert.equal((await run<Record<string, any>>(sf.theme!.current, { previewToken: token })).files.copyId, copy.id)
    await fx.themeService.publishCode(SHOP, copy.id, undefined, db)
    const live = await run<{ copyId: string; files: Record<string, string> }>(sf.theme!.files, {})
    assert.deepEqual([live.copyId, live.files['snippets/hello.liquid']], [copy.id, '<p>draft</p>'])
    assert.deepEqual((await run<Record<string, any>>(sf.theme!.current, {})).files.copyId, copy.id)
  })
})
