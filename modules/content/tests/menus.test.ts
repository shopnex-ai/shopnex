// Menus: handles per shop, links that must point at something that exists in the shop, and how the storefront turns the stored tree into
// addresses (dropping what is gone, unpublished or not for sale).
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { menus } from '../src/content.schema'

const { db, eq, content, item, SHOP, OTHER_SHOP } = fx
const { ContentError, MENU_MAX_DEPTH, MENU_ITEM_TYPES, seedDefaultMenu } = await import('../src')

const refused = (code: string) => (e: unknown) => e instanceof ContentError && e.code === code
const MISSING = '00000000-0000-4000-8000-000000000000'

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('what a menu is made of', () => {
  test('the link types and the depth the admin offers', () => {
    assert.deepEqual([...MENU_ITEM_TYPES], ['frontpage', 'catalog', 'collection', 'product', 'page', 'search', 'http'])
    assert.equal(MENU_MAX_DEPTH, 3)
  })
})

describe('creating and reading menus', () => {
  test('a menu keeps its tree as given, and a handle is used once per shop', async () => {
    const items = [item('frontpage', { items: [item('catalog')] })]
    const m = await content.menus.create(SHOP, { handle: 'main-menu', title: 'Main', items })
    assert.deepEqual(m.items, items)
    await assert.rejects(
      content.menus.create(SHOP, { handle: 'main-menu', title: 'Again', items: [] }),
      refused('HANDLE_TAKEN'),
    )
    await content.menus.create(OTHER_SHOP, { handle: 'main-menu', title: 'Theirs', items: [] })
  })

  test('list is oldest first and the shop’s own; getById and getByHandle are scoped to the shop', async () => {
    const a = await content.menus.create(SHOP, { handle: 'a', title: 'A', items: [] })
    const b = await content.menus.create(SHOP, { handle: 'b', title: 'B', items: [] })
    await db
      .update(menus)
      .set({ createdAt: new Date('2026-01-01') })
      .where(eq(menus.id, a.id))
    await db
      .update(menus)
      .set({ createdAt: new Date('2026-01-02') })
      .where(eq(menus.id, b.id))
    await content.menus.create(OTHER_SHOP, { handle: 'c', title: 'C', items: [] })
    assert.deepEqual(
      (await content.menus.list(SHOP)).map((m) => m.id),
      [a.id, b.id],
    )
    assert.equal((await content.menus.getById(SHOP, a.id))?.handle, 'a')
    assert.equal(await content.menus.getById(OTHER_SHOP, a.id), null)
    assert.equal((await content.menus.getByHandle(SHOP, 'b'))?.id, b.id)
    assert.equal(await content.menus.getByHandle(OTHER_SHOP, 'b'), null)
  })
})

describe('links must point at something in the shop', () => {
  test('a collection, product or page that does not exist, at any depth, refuses the whole menu', async () => {
    for (const type of ['collection', 'product', 'page'] as const) {
      await assert.rejects(
        content.menus.create(SHOP, {
          handle: `bad-${type}`,
          title: 'Bad',
          items: [item('frontpage', { items: [item(type, { resourceId: MISSING })] })],
        }),
        refused('RESOURCE_NOT_FOUND'),
        type,
      )
    }
    assert.equal((await content.menus.list(SHOP)).length, 0, 'nothing was saved')
  })

  test('one that belongs to another shop is refused as well', async () => {
    const theirs = await fx.collection({ shopId: OTHER_SHOP })
    await assert.rejects(
      content.menus.create(SHOP, { handle: 'x', title: 'X', items: [item('collection', { resourceId: theirs.id })] }),
      refused('RESOURCE_NOT_FOUND'),
    )
  })

  test('links to things that exist, and links that need nothing, are accepted', async () => {
    const [c, p, page] = [await fx.collection(), await fx.product(), await content.pages.create(SHOP, { title: 'Ok' })]
    const m = await content.menus.create(SHOP, {
      handle: 'ok',
      title: 'Ok',
      items: [
        item('collection', { resourceId: c.id }),
        item('product', { resourceId: p.id }),
        item('page', { resourceId: page.id }),
        item('http', { url: 'https://example.test' }),
        item('search'),
      ],
    })
    assert.equal(m.items.length, 5)
  })
})

describe('updating and removing', () => {
  test('changes what is given and checks it; an unknown or another shop’s menu is null', async () => {
    const m = await content.menus.create(SHOP, { handle: 'upd', title: 'Old', items: [] })
    const changed = await content.menus.update(SHOP, m.id, { title: 'New' })
    assert.deepEqual([changed?.title, changed?.handle], ['New', 'upd'])
    assert.ok(changed!.updatedAt.getTime() >= m.updatedAt.getTime())
    assert.equal(await content.menus.update(OTHER_SHOP, m.id, { title: 'No' }), null)
    assert.equal(await content.menus.update(SHOP, MISSING, { title: 'No' }), null)
    await assert.rejects(
      content.menus.update(SHOP, m.id, { items: [item('product', { resourceId: MISSING })] }),
      refused('RESOURCE_NOT_FOUND'),
    )
    assert.deepEqual((await content.menus.getById(SHOP, m.id))?.items, [], 'a refused update changed nothing')
  })

  test('a handle can be kept, but not taken from another menu', async () => {
    const [a, b] = [
      await content.menus.create(SHOP, { handle: 'one', title: '1', items: [] }),
      await content.menus.create(SHOP, { handle: 'two', title: '2', items: [] }),
    ]
    assert.equal((await content.menus.update(SHOP, a.id, { handle: 'one' }))?.handle, 'one')
    await assert.rejects(content.menus.update(SHOP, b.id, { handle: 'one' }), refused('HANDLE_TAKEN'))
  })

  test('removing returns the menu; another shop’s or a second time is null', async () => {
    const m = await content.menus.create(SHOP, { handle: 'bye', title: 'Bye', items: [] })
    assert.equal(await content.menus.remove(OTHER_SHOP, m.id), null)
    assert.equal((await content.menus.remove(SHOP, m.id))?.id, m.id)
    assert.equal(await content.menus.remove(SHOP, m.id), null)
  })

  test('removing many deletes only this shop’s menus and counts them', async () => {
    const a = await menuService.create(SHOP, { handle: 'bulk-a', title: 'A', items: [] }, db)
    const b = await menuService.create(SHOP, { handle: 'bulk-b', title: 'B', items: [] }, db)
    assert.equal(await menuService.removeMany(OTHER_SHOP, [a.id, b.id], db), 0)
    assert.equal(await menuService.removeMany(SHOP, [a.id, b.id], db), 2)
    assert.equal(await menuService.getById(SHOP, a.id, db), null)
  })
})

describe('resolve: the stored tree as addresses', () => {
  test('fixed links have fixed addresses, and the stored url of a typed link is not used', async () => {
    const out = await content.menus.resolve(SHOP, [
      item('frontpage', { url: 'https://ignored.test' }),
      item('catalog'),
      item('search'),
      item('http', { url: 'https://example.test/x' }),
    ])
    assert.deepEqual(
      out.map((i) => [i.type, i.url, i.handle, i.resourceId]),
      [
        ['frontpage', '/', null, null],
        ['catalog', '/collections/all', null, null],
        ['search', '/search', null, null],
        ['http', 'https://example.test/x', null, null],
      ],
    )
  })

  test('a collection, product or page becomes /<kind>/<handle> from its current handle', async () => {
    const [c, p, page] = [
      await fx.collection({ slug: 'summer-sale' }),
      await fx.product({ slug: 'linen-shirt' }),
      await content.pages.create(SHOP, { title: 'Our Story' }),
    ]
    const out = await content.menus.resolve(SHOP, [
      item('collection', { resourceId: c.id }),
      item('product', { resourceId: p.id }),
      item('page', { resourceId: page.id }),
    ])
    assert.deepEqual(
      out.map((i) => [i.url, i.handle, i.resourceId]),
      [
        ['/collections/summer-sale', 'summer-sale', c.id],
        ['/products/linen-shirt', 'linen-shirt', p.id],
        ['/pages/our-story', 'our-story', page.id],
      ],
    )
  })

  test('what is gone, unpublished or not for sale is dropped, and so is everything under it', async () => {
    const [draft, live] = [await fx.product({ status: 'draft' }), await fx.product({ slug: 'on-sale' })]
    const hidden = await content.pages.create(SHOP, { title: 'Hidden', published: false })
    const out = await content.menus.resolve(SHOP, [
      item('product', { resourceId: draft.id, items: [item('catalog')] }),
      item('page', { resourceId: hidden.id }),
      item('collection', { resourceId: MISSING }),
      item('http', { url: null }),
      item('product', { resourceId: live.id }),
    ])
    assert.deepEqual(
      out.map((i) => i.url),
      ['/products/on-sale'],
    )
  })

  test('a link keeps its children, resolved too, and loses the ones that are gone', async () => {
    const c = await fx.collection({ slug: 'kids' })
    const out = await content.menus.resolve(SHOP, [
      item('frontpage', {
        title: 'Home',
        items: [item('collection', { resourceId: c.id, title: 'Kids' }), item('page', { resourceId: MISSING })],
      }),
    ])
    assert.equal(out.length, 1)
    assert.deepEqual(
      out[0]!.items.map((i) => [i.title, i.url]),
      [['Kids', '/collections/kids']],
    )
  })

  test('it only sees this shop’s collections, products and pages', async () => {
    const theirs = await fx.collection({ shopId: OTHER_SHOP, slug: 'theirs' })
    assert.deepEqual(await content.menus.resolve(SHOP, [item('collection', { resourceId: theirs.id })]), [])
  })
})

describe('the menus a new shop starts with', () => {
  test('a header and a footer menu with links that need no content, made once and never replacing a menu the merchant has', async () => {
    const s = await fx.shop()
    await content.menus.create(s.id, { handle: 'main-menu', title: 'Mine', items: [] })
    await seedDefaultMenu(s.id, db)
    await seedDefaultMenu(s.id, db)
    const menus = await content.menus.list(s.id)
    assert.equal(menus.length, 2)
    assert.equal(menus.find((m) => m.handle === 'main-menu')?.title, 'Mine', 'the merchant’s menu is kept')
    const footer = menus.find((m) => m.handle === 'footer')!
    assert.deepEqual(
      footer.items.map((i) => [i.type, i.title]),
      [['search', 'Search']],
    )
  })

  test('on a fresh shop the header has Home and Shop all', async () => {
    const s = await fx.shop()
    await seedDefaultMenu(s.id, db)
    const main = await content.menus.getByHandle(s.id, 'main-menu')
    assert.deepEqual(
      main?.items.map((i) => [i.type, i.title]),
      [
        ['frontpage', 'Home'],
        ['catalog', 'Shop all'],
      ],
    )
    assert.equal(main?.title, 'Main menu')
  })
})
