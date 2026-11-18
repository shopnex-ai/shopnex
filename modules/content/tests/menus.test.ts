// Menus: handles per shop, links that must point at something that exists in the shop, and how the storefront turns the stored tree into
// addresses (dropping what is gone, unpublished or not for sale).
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { menus } from '../src/content.schema'

const { db, eq, menuService, pageService, item, SHOP, OTHER_SHOP } = fx
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
    const m = await menuService.create(SHOP, { handle: 'main-menu', title: 'Main', items }, db)
    assert.deepEqual(m.items, items)
    await assert.rejects(
      menuService.create(SHOP, { handle: 'main-menu', title: 'Again', items: [] }, db),
      refused('HANDLE_TAKEN'),
    )
    await menuService.create(OTHER_SHOP, { handle: 'main-menu', title: 'Theirs', items: [] }, db)
  })

  test('list is oldest first and the shop’s own; getById and getByHandle are scoped to the shop', async () => {
    const a = await menuService.create(SHOP, { handle: 'a', title: 'A', items: [] }, db)
    const b = await menuService.create(SHOP, { handle: 'b', title: 'B', items: [] }, db)
    await db
      .update(menus)
      .set({ createdAt: new Date('2026-01-01') })
      .where(eq(menus.id, a.id))
    await db
      .update(menus)
      .set({ createdAt: new Date('2026-01-02') })
      .where(eq(menus.id, b.id))
    await menuService.create(OTHER_SHOP, { handle: 'c', title: 'C', items: [] }, db)
    assert.deepEqual(
      (await menuService.list(SHOP, db)).map((m) => m.id),
      [a.id, b.id],
    )
    assert.equal((await menuService.getById(SHOP, a.id, db))?.handle, 'a')
    assert.equal(await menuService.getById(OTHER_SHOP, a.id, db), null)
    assert.equal((await menuService.getByHandle(SHOP, 'b', db))?.id, b.id)
    assert.equal(await menuService.getByHandle(OTHER_SHOP, 'b', db), null)
  })
})

describe('links must point at something in the shop', () => {
  test('a collection, product or page that does not exist, at any depth, refuses the whole menu', async () => {
    for (const type of ['collection', 'product', 'page'] as const) {
      await assert.rejects(
        menuService.create(
          SHOP,
          {
            handle: `bad-${type}`,
            title: 'Bad',
            items: [item('frontpage', { items: [item(type, { resourceId: MISSING })] })],
          },
          db,
        ),
        refused('RESOURCE_NOT_FOUND'),
        type,
      )
    }
    assert.equal((await menuService.list(SHOP, db)).length, 0, 'nothing was saved')
  })

  test('one that belongs to another shop is refused as well', async () => {
    const theirs = await fx.collection({ shopId: OTHER_SHOP })
    await assert.rejects(
      menuService.create(SHOP, { handle: 'x', title: 'X', items: [item('collection', { resourceId: theirs.id })] }, db),
      refused('RESOURCE_NOT_FOUND'),
    )
  })

  test('links to things that exist, and links that need nothing, are accepted', async () => {
    const [c, p, page] = [
      await fx.collection(),
      await fx.product(),
      await pageService.create(SHOP, { title: 'Ok' }, db),
    ]
    const m = await menuService.create(
      SHOP,
      {
        handle: 'ok',
        title: 'Ok',
        items: [
          item('collection', { resourceId: c.id }),
          item('product', { resourceId: p.id }),
          item('page', { resourceId: page.id }),
          item('http', { url: 'https://example.test' }),
          item('search'),
        ],
      },
      db,
    )
    assert.equal(m.items.length, 5)
  })
})

describe('updating and removing', () => {
  test('changes what is given and checks it; an unknown or another shop’s menu is null', async () => {
    const m = await menuService.create(SHOP, { handle: 'upd', title: 'Old', items: [] }, db)
    const changed = await menuService.update(SHOP, m.id, { title: 'New' }, db)
    assert.deepEqual([changed?.title, changed?.handle], ['New', 'upd'])
    assert.ok(changed!.updatedAt.getTime() >= m.updatedAt.getTime())
    assert.equal(await menuService.update(OTHER_SHOP, m.id, { title: 'No' }, db), null)
    assert.equal(await menuService.update(SHOP, MISSING, { title: 'No' }, db), null)
    await assert.rejects(
      menuService.update(SHOP, m.id, { items: [item('product', { resourceId: MISSING })] }, db),
      refused('RESOURCE_NOT_FOUND'),
    )
    assert.deepEqual((await menuService.getById(SHOP, m.id, db))?.items, [], 'a refused update changed nothing')
  })

  test('a handle can be kept, but not taken from another menu', async () => {
    const [a, b] = [
      await menuService.create(SHOP, { handle: 'one', title: '1', items: [] }, db),
      await menuService.create(SHOP, { handle: 'two', title: '2', items: [] }, db),
    ]
    assert.equal((await menuService.update(SHOP, a.id, { handle: 'one' }, db))?.handle, 'one')
    await assert.rejects(menuService.update(SHOP, b.id, { handle: 'one' }, db), refused('HANDLE_TAKEN'))
  })

  test('removing returns the menu; another shop’s or a second time is null', async () => {
    const m = await menuService.create(SHOP, { handle: 'bye', title: 'Bye', items: [] }, db)
    assert.equal(await menuService.remove(OTHER_SHOP, m.id, db), null)
    assert.equal((await menuService.remove(SHOP, m.id, db))?.id, m.id)
    assert.equal(await menuService.remove(SHOP, m.id, db), null)
  })
})

describe('resolve: the stored tree as addresses', () => {
  test('fixed links have fixed addresses, and the stored url of a typed link is not used', async () => {
    const out = await menuService.resolve(
      SHOP,
      [
        item('frontpage', { url: 'https://ignored.test' }),
        item('catalog'),
        item('search'),
        item('http', { url: 'https://example.test/x' }),
      ],
      db,
    )
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
      await pageService.create(SHOP, { title: 'Our Story' }, db),
    ]
    const out = await menuService.resolve(
      SHOP,
      [
        item('collection', { resourceId: c.id }),
        item('product', { resourceId: p.id }),
        item('page', { resourceId: page.id }),
      ],
      db,
    )
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
    const hidden = await pageService.create(SHOP, { title: 'Hidden', published: false }, db)
    const out = await menuService.resolve(
      SHOP,
      [
        item('product', { resourceId: draft.id, items: [item('catalog')] }),
        item('page', { resourceId: hidden.id }),
        item('collection', { resourceId: MISSING }),
        item('http', { url: null }),
        item('product', { resourceId: live.id }),
      ],
      db,
    )
    assert.deepEqual(
      out.map((i) => i.url),
      ['/products/on-sale'],
    )
  })

  test('a link keeps its children, resolved too, and loses the ones that are gone', async () => {
    const c = await fx.collection({ slug: 'kids' })
    const out = await menuService.resolve(
      SHOP,
      [
        item('frontpage', {
          title: 'Home',
          items: [item('collection', { resourceId: c.id, title: 'Kids' }), item('page', { resourceId: MISSING })],
        }),
      ],
      db,
    )
    assert.equal(out.length, 1)
    assert.deepEqual(
      out[0]!.items.map((i) => [i.title, i.url]),
      [['Kids', '/collections/kids']],
    )
  })

  test('it only sees this shop’s collections, products and pages', async () => {
    const theirs = await fx.collection({ shopId: OTHER_SHOP, slug: 'theirs' })
    assert.deepEqual(await menuService.resolve(SHOP, [item('collection', { resourceId: theirs.id })], db), [])
  })
})

describe('the menus a new shop starts with', () => {
  test('a header and a footer menu with links that need no content, made once and never replacing a menu the merchant has', async () => {
    const s = await fx.shop()
    await menuService.create(s.id, { handle: 'main-menu', title: 'Mine', items: [] }, db)
    await seedDefaultMenu(db, s.id)
    await seedDefaultMenu(db, s.id)
    const menus = await menuService.list(s.id, db)
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
    await seedDefaultMenu(db, s.id)
    const main = await menuService.getByHandle(s.id, 'main-menu', db)
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
