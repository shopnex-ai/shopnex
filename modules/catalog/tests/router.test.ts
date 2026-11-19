import type { Conn } from '@shopnex/db'
// The admin product and collection routes, called through the real router with fake resolvers and an in-memory database: who may call
// them (staff, or an API token with the scope), the rule on `fulfilledBy`, how input is checked, and what the routes answer.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'
import { apps } from '@shopnex/core/schema'
import { hasScope } from '@shopnex/core/scopes'
import type { ApiScope } from '@shopnex/core/schema'
import * as fx from './fixtures'

const { db, eq, SHOP } = fx
const { configureRpc } = await import('@shopnex/rpc')
const { catalogModule } = await import('../src/catalog.module')

const { products, collections } = catalogModule.router
const shop = { id: SHOP, storefrontUrl: null } as never

// Who is calling: staff, nobody, or an API token with these scopes (and maybe an app behind it)
let caller: { kind: 'staff' } | { kind: 'none' } | { kind: 'token'; scopes: ApiScope[]; appId: string | null } = {
  kind: 'staff',
}
const asStaff = () => (caller = { kind: 'staff' })
const asToken = (scopes: ApiScope[], appId: string | null = null) => (caller = { kind: 'token', scopes, appId })

before(async () => {
  await fx.prepareDatabase()
  configureRpc({
    session: () =>
      Promise.resolve(
        caller.kind === 'staff' ? ({ session: { activeOrganizationId: SHOP }, user: { id: 'u1' } } as never) : null,
      ),
    adminShop: () => Promise.resolve({ shop, role: 'admin' as const, superAdmin: false }),
    token: () =>
      Promise.resolve(
        caller.kind === 'token' ? ({ shop, token: { scopes: caller.scopes, appId: caller.appId } } as never) : null,
      ),
    hasScope,
  })
})
beforeEach(() => {
  asStaff()
  return fx.cleanup()
})
after(async () => {
  asStaff()
  await fx.cleanup()
  await db.delete(apps).where(eq(apps.clientId, 'app_test_catalog'))
})

const ctx = { context: { headers: new Headers({ authorization: 'Bearer sk_test' }) } }
const staffCtx = { context: { headers: new Headers() } }
const run = <T>(procedure: unknown, input?: unknown) =>
  call(
    procedure as Parameters<typeof call>[0],
    input,
    (caller.kind === 'token' ? ctx : staffCtx) as never,
  ) as Promise<T>
const refused = (code: string) => (e: unknown) => e instanceof ORPCError && e.code === code
const MISSING = '00000000-0000-4000-8000-000000000000'
const page = { limit: 50, offset: 0 }

type Product = { id: string; title: string; slug: string; variants: { id: string }[]; priceCents: number }
type Collection = { id: string; slug: string }

describe('who may call', () => {
  test('nobody signed in is UNAUTHORIZED, on reading and on writing', async () => {
    caller = { kind: 'none' }
    await assert.rejects(run(products.list, page), refused('UNAUTHORIZED'))
    await assert.rejects(run(products.create, { title: 'x', priceCents: 1 }), refused('UNAUTHORIZED'))
    await assert.rejects(run(collections.list, page), refused('UNAUTHORIZED'))
  })

  test('an API token needs read_products to read and write_products to write (write includes read)', async () => {
    asToken(['read_products'])
    assert.equal((await run<{ total: number }>(products.list, page)).total, 0)
    await assert.rejects(run(products.create, { title: 'x', priceCents: 1 }), refused('FORBIDDEN'))
    await assert.rejects(run(collections.create, { title: 'x' }), refused('FORBIDDEN'))
    await assert.rejects(run(products.deleteMany, { ids: [MISSING] }), refused('FORBIDDEN'))
    asToken(['write_products'])
    assert.equal((await run<Product>(products.create, { title: 'x', priceCents: 1 })).title, 'x')
    assert.deepEqual(await run(collections.list, page), [])
    asToken(['read_orders'])
    await assert.rejects(run(products.list, page), refused('FORBIDDEN'))
  })

  test('publications have their own scopes: read_publications to see, write_publications to change', async () => {
    const p = await run<Product>(products.create, { title: 'x', priceCents: 1 })
    asToken(['write_products'])
    await assert.rejects(run(products.publications, { id: p.id }), refused('FORBIDDEN'))
    await assert.rejects(run(products.setPublications, { id: p.id, publications: [] }), refused('FORBIDDEN'))
    asToken(['read_publications'])
    assert.ok(Array.isArray(await run(products.publications, { id: p.id })))
    await assert.rejects(run(products.setPublications, { id: p.id, publications: [] }), refused('FORBIDDEN'))
    asToken(['write_publications'])
    assert.deepEqual(await run(products.setPublications, { id: p.id, publications: [] }), [])
  })
})

describe('products', () => {
  test('create takes a price or variants, never both and never neither', async () => {
    await assert.rejects(run(products.create, { title: 'x' }), refused('BAD_REQUEST'))
    await assert.rejects(
      run(products.create, { title: 'x', priceCents: 1, variants: [{ priceCents: 1 }] }),
      refused('BAD_REQUEST'),
    )
    await assert.rejects(run(products.create, { title: 'x', variants: [] }), refused('BAD_REQUEST'))
    assert.equal(await fx.productService.count(SHOP, {}, db), 0)
  })

  test('input is checked: an empty title, a bad slug, a negative price and an image that is not http(s) are BAD_REQUEST', async () => {
    for (const bad of [
      { title: '', priceCents: 1 },
      { title: 'x', priceCents: 1, slug: 'Not Valid' },
      { title: 'x', priceCents: -1 },
      { title: 'x', priceCents: 1, images: [{ url: 'javascript:alert(1)' }] },
      { title: 'x', priceCents: 1, status: 'published' },
    ])
      await assert.rejects(run(products.create, bad), refused('BAD_REQUEST'), JSON.stringify(bad))
  })

  test('create, get, update and list answer the product with its images, options and variants', async () => {
    const made = await run<Product>(products.create, {
      title: 'Tee',
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1000 },
        { options: { Size: 'M' }, priceCents: 1200 },
      ],
      images: [{ url: 'https://example.com/tee.png', alt: 'Tee' }],
    })
    assert.deepEqual([made.slug, made.priceCents, made.variants.length], ['tee', 1000, 2])
    const got = await run<Product & { images: unknown[]; options: unknown[] }>(products.get, { id: made.id })
    assert.deepEqual([got.images.length, got.options.length], [1, 1])
    const updated = await run<Product>(products.update, { id: made.id, title: 'Tee 2' })
    assert.deepEqual([updated.title, updated.slug], ['Tee 2', 'tee'])
    const listed = await run<{ items: (Product & { publications: unknown[] })[]; total: number }>(products.list, page)
    assert.equal(listed.total, 1)
    assert.ok(Array.isArray(listed.items[0]!.publications), 'the list also says where each is published')
  })

  test('an unknown product, or another shop’s, is NOT_FOUND; a taken slug is CONFLICT; bad variants are BAD_REQUEST', async () => {
    await fx.otherShop()
    const theirs = await fx.productService.create(fx.OTHER_SHOP, { title: 'Theirs', priceCents: 1 }, db)
    await assert.rejects(run(products.get, { id: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(run(products.get, { id: theirs.id }), refused('NOT_FOUND'))
    await assert.rejects(run(products.update, { id: MISSING, title: 'x' }), refused('NOT_FOUND'))
    await assert.rejects(
      run(products.setVariants, { id: MISSING, options: [], variants: [{ priceCents: 1 }] }),
      refused('NOT_FOUND'),
    )
    await assert.rejects(run(products.updateVariant, { variantId: MISSING, priceCents: 1 }), refused('NOT_FOUND'))
    await assert.rejects(run(products.publications, { id: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(run(products.setPublications, { id: MISSING, publications: [] }), refused('NOT_FOUND'))
    await run(products.create, { title: 'A', priceCents: 1 })
    await assert.rejects(run(products.create, { title: 'B', priceCents: 1, slug: 'a' }), refused('CONFLICT'))
    const p = await run<Product>(products.create, { title: 'C', priceCents: 1 })
    await assert.rejects(
      run(products.setVariants, {
        id: p.id,
        options: [{ name: 'Size', values: ['S'] }],
        variants: [{ options: { Size: 'XL' }, priceCents: 1 }],
      }),
      refused('BAD_REQUEST'),
    )
  })

  test('setVariants and updateVariant change the variants; the product price follows the lowest', async () => {
    const p = await run<Product>(products.create, { title: 'T', priceCents: 500 })
    const replaced = await run<Product>(products.setVariants, {
      id: p.id,
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 900 },
        { options: { Size: 'M' }, priceCents: 700 },
      ],
    })
    assert.equal(replaced.priceCents, 700)
    const one = await run<{ priceCents: number; available: boolean }>(products.updateVariant, {
      variantId: replaced.variants[0]!.id,
      priceCents: 300,
      inventoryQuantity: 0,
    })
    assert.deepEqual([one.priceCents, one.available], [300, false])
    assert.equal((await run<Product>(products.get, { id: p.id })).priceCents, 300)
  })

  test('deleteMany answers how many it removed, and takes up to 100 ids', async () => {
    const [a, b] = [
      await run<Product>(products.create, { title: 'A', priceCents: 1 }),
      await run<Product>(products.create, { title: 'B', priceCents: 1 }),
    ]
    assert.equal(await run(products.deleteMany, { ids: [a.id, b.id, MISSING] }), 2)
    await assert.rejects(run(products.deleteMany, { ids: [] }), refused('BAD_REQUEST'))
    await assert.rejects(
      run(products.deleteMany, { ids: Array.from({ length: 101 }, () => MISSING) }),
      refused('BAD_REQUEST'),
    )
  })

  test('addSamples adds the four sample products to an empty shop and 0 after that', async () => {
    assert.equal(await run(products.addSamples), 4)
    assert.equal(await run(products.addSamples), 0)
  })

  test('list filters by search and paginates; custom field filters with an unknown field are refused', async () => {
    for (const title of ['Alpha shirt', 'Beta shirt', 'Gamma mug']) await run(products.create, { title, priceCents: 1 })
    const found = await run<{ items: Product[]; total: number }>(products.list, { ...page, search: 'shirt' })
    assert.equal(found.total, 2)
    const paged = await run<{ items: Product[]; total: number }>(products.list, { limit: 1, offset: 1 })
    assert.deepEqual([paged.items.length, paged.total], [1, 3])
    await assert.rejects(run(products.list, { ...page, customField: ['nope:1'] }), (e) => e instanceof ORPCError)
  })
})

describe('fulfilledBy: which app ships a product', () => {
  let appId = ''
  before(async () => {
    const [row] = await db
      .insert(apps)
      .values({
        name: 'Carrier',
        appUrl: 'https://example.com',
        redirectUrls: [],
        scopes: [],
        clientId: 'app_test_catalog',
      })
      .returning()
    appId = row!.id
  })

  test('staff can clear it but cannot name an app', async () => {
    await assert.rejects(
      run(products.create, { title: 'x', priceCents: 1, fulfilledBy: 'app_test_catalog' }),
      refused('FORBIDDEN'),
    )
    const p = await run<Product>(products.create, { title: 'x', priceCents: 1, fulfilledBy: null })
    assert.equal((await run<{ fulfilledBy: string | null }>(products.get, { id: p.id })).fulfilledBy, null)
  })

  test('an app can set it to itself, and to nothing, but not to another app; a plain token cannot name any', async () => {
    asToken(['write_products'], appId)
    const p = await run<Product & { fulfilledBy: string | null }>(products.create, {
      title: 'x',
      priceCents: 1,
      fulfilledBy: 'app_test_catalog',
    })
    assert.equal(p.fulfilledBy, 'app_test_catalog')
    await assert.rejects(run(products.update, { id: p.id, fulfilledBy: 'app_someone_else' }), refused('FORBIDDEN'))
    assert.equal(
      (await run<{ fulfilledBy: string | null }>(products.update, { id: p.id, fulfilledBy: null })).fulfilledBy,
      null,
    )
    asToken(['write_products'], null)
    await assert.rejects(run(products.update, { id: p.id, fulfilledBy: 'app_test_catalog' }), refused('FORBIDDEN'))
  })

  test('an update that leaves it out is not checked', async () => {
    asToken(['write_products'], null)
    const p = await run<Product>(products.create, { title: 'x', priceCents: 1 })
    assert.equal((await run<Product>(products.update, { id: p.id, title: 'y' })).title, 'y')
  })
})

describe('collections', () => {
  test('create, get, list (with the product count and where it is published), update and delete', async () => {
    const c = await run<Collection>(collections.create, { title: 'Summer' })
    assert.equal(c.slug, 'summer')
    const p = await run<Product>(products.create, { title: 'P', priceCents: 1 })
    await run(collections.addProduct, { id: c.id, productId: p.id })
    const got = await run<{ productCount: number; publications: unknown[] }>(collections.get, { id: c.id })
    assert.equal(got.productCount, 1)
    assert.ok(Array.isArray(got.publications))
    assert.equal((await run<unknown[]>(collections.list, page)).length, 1)
    assert.equal((await run<{ title: string }>(collections.update, { id: c.id, title: 'Winter' })).title, 'Winter')
    assert.deepEqual(await run(collections.delete, { id: c.id }), { ok: true })
    await assert.rejects(run(collections.get, { id: c.id }), refused('NOT_FOUND'))
    await assert.rejects(run(collections.delete, { id: c.id }), refused('NOT_FOUND'))
  })

  test('members are added and removed with ok, listed in order, and a stranger’s id is NOT_FOUND', async () => {
    const c = await run<Collection>(collections.create, { title: 'C' })
    const [a, b] = [
      await run<Product>(products.create, { title: 'A', priceCents: 1 }),
      await run<Product>(products.create, { title: 'B', priceCents: 1 }),
    ]
    assert.deepEqual(await run(collections.addProduct, { id: c.id, productId: b.id }), { ok: true })
    await run(collections.addProduct, { id: c.id, productId: a.id })
    assert.deepEqual(
      (await run<{ title: string }[]>(collections.products, { id: c.id })).map((m) => m.title),
      ['B', 'A'],
    )
    assert.deepEqual(await run(collections.removeProduct, { id: c.id, productId: b.id }), { ok: true })
    assert.equal((await run<unknown[]>(collections.products, { id: c.id })).length, 1)
    await assert.rejects(run(collections.addProduct, { id: c.id, productId: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(run(collections.addProduct, { id: MISSING, productId: a.id }), refused('NOT_FOUND'))
  })

  test('a taken slug is CONFLICT, and publications can be read and set', async () => {
    const c = await run<Collection>(collections.create, { title: 'C', slug: 'mine' })
    await assert.rejects(run(collections.create, { title: 'D', slug: 'mine' }), refused('CONFLICT'))
    const ch = await fx.channel()
    assert.deepEqual(
      (
        await run<{ channelId: string }[]>(collections.setPublications, {
          id: c.id,
          publications: [{ channelId: ch.id }],
        })
      ).map((x) => x.channelId),
      [ch.id],
    )
    assert.equal((await run<unknown[]>(collections.publications, { id: c.id })).length >= 1, true)
    await assert.rejects(run(collections.publications, { id: MISSING }), refused('NOT_FOUND'))
    await assert.rejects(run(collections.setPublications, { id: MISSING, publications: [] }), refused('NOT_FOUND'))
    await assert.rejects(
      run(collections.setPublications, { id: c.id, publications: [{ channelId: ch.id }, { channelId: ch.id }] }),
      refused('BAD_REQUEST'),
      'each channel once',
    )
  })

  test('deleteMany answers how many it removed', async () => {
    const [a, b] = [
      await run<Collection>(collections.create, { title: 'A' }),
      await run<Collection>(collections.create, { title: 'B' }),
    ]
    assert.equal(await run(collections.deleteMany, { ids: [a.id, b.id, MISSING] }), 2)
  })
})
