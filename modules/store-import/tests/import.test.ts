// The whole import against an in-memory database, with a fake store behind `fetch` (no network).
import assert from 'node:assert/strict'
import test, { before, describe } from 'node:test'
import { eq } from 'drizzle-orm'
import { products } from '@shopnex/catalog/schema'
import { shops } from '@shopnex/core/schema'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { productService } = await import('@shopnex/catalog')
const { menuService, pageService, seedDefaultMenu } = await import('@shopnex/content')
const { themeService } = await import('@shopnex/theme')
const svc = await import('../src/store-import')
const { StoreImportError } = await import('../src/store-import.errors')
const { storeImports } = await import('../src/store-import.schema')

before(() => prepareDatabase())

let counter = 0
async function newShop(currency = 'USD') {
  const id = `import-${++counter}`
  await db.insert(shops).values({ id, name: 'Test shop', slug: id, currency })
  return id
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
const missing = () => new Response('not found', { status: 404 })

const body = `<p>${'About this shop. '.repeat(20)}</p>`
/** A Shopify store with `n` products, in `currency`, whose home page says `lang` */
function shopifyStore({ n = 8, currency = 'EUR', lang = 'de' } = {}) {
  const items = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `Müsli ${i + 1}`,
    handle: `musli-${i + 1}`,
    body_html: '<p>Lecker</p>',
    vendor: 'Muesli Co',
    product_type: i % 2 ? 'Müsli' : 'Riegel',
    tags: 'bio, vegan',
    options: [{ name: 'Title', values: ['Default Title'] }],
    // Every product shares one SKU: the catalog needs them unique across the shop
    variants: [{ sku: 'SAME', price: '4.50', compare_at_price: null, available: true }],
    images: [{ src: `https://cdn.example.com/${i + 1}.jpg`, alt: null }],
  }))
  return async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === '/products.json')
      return json({ products: url.searchParams.get('limit') === '1' ? items.slice(0, 1) : items })
    if (url.pathname === '/meta.json') return json({ name: 'Müsli Shop', currency })
    if (url.pathname === '/pages.json') {
      return json({
        pages: [
          { title: 'Versand', handle: 'versand', body_html: body },
          { title: 'Datenschutz', handle: 'datenschutz', body_html: body },
          { title: 'Gewinnspiel Teilnahmebedingungen', handle: 'gewinnspiel', body_html: body },
        ],
      })
    }
    if (url.pathname === '/')
      return new Response(
        `<html lang="${lang}"><head><link rel="icon" href="/fav.png"></head><body><header><img class="logo" src="/logo.png"></header></body></html>`,
      )
    return missing()
  }
}

const hooks = (fetchImpl: (input: string | URL | Request) => Promise<Response>) => ({
  wait: true,
  fetcher: { pauseMs: 0, checkHost: async () => {}, fetchImpl: fetchImpl as typeof fetch },
})
const rejects = (code: string) => (e: unknown) => e instanceof StoreImportError && e.code === code

describe('importing into a new shop', () => {
  test('brings products, collections, pages and menus across, and sets the shop up from the store', async () => {
    const shopId = await newShop()
    const job = await svc.start(shopId, { url: 'https://www.musli.example.com/products/x' }, db, hooks(shopifyStore()))
    assert.equal(job.status, 'done', job.error ?? '')
    assert.equal(job.platform, 'shopify')
    assert.equal(job.origin, 'https://www.musli.example.com')
    assert.equal(job.counts?.products, 8)
    assert.equal(job.counts?.branded, true)
    assert.equal(job.counts?.currency, 'EUR')
    assert.equal(job.counts?.language, 'de')
    assert.equal(job.counts?.collections, 2)
    assert.equal(job.counts?.pages, 2) // the prize draw page is left out

    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId))
    assert.equal(shop?.currency, 'EUR')
    assert.equal(shop?.language, 'de')
    assert.equal(shop?.name, 'Müsli Shop')
    assert.equal(shop?.logo, 'https://www.musli.example.com/logo.png')

    const main = await menuService.getByHandle(shopId, 'main-menu', db)
    assert.deepEqual(
      main?.items.map((i) => i.type),
      ['frontpage', 'catalog', 'collection', 'collection'],
    )
    const footer = await menuService.getByHandle(shopId, 'footer', db)
    assert.deepEqual(
      footer?.items.map((i) => i.type),
      ['page', 'page', 'search'],
    )

    const live = await themeService.getLive(shopId, db)
    assert.equal(live?.themeId, 'storeplate')
    const settings = (live?.published as { settings: Record<string, string> }).settings
    assert.equal(settings.favicon, 'https://www.musli.example.com/fav.png')
    assert.equal(settings.logo, 'https://www.musli.example.com/logo.png')
  })

  test('a contact form page becomes a Contact page of the footer’s details, and the menu links to it', async () => {
    const shopId = await newShop()
    const base = shopifyStore()
    const home = `<html lang="en"><head><title>Müsli Shop</title></head><body>
      <header><nav class="header__inline-menu"><ul><li><a href="/pages/contact">Contact us</a></li></ul></nav></header>
      <footer><h2>CONTACT US :</h2><ul><li>Hotline: +49 30 1234</li><li>Email: hi@musli.example.com</li></ul></footer></body></html>`
    const withHome = async (input: string | URL | Request) =>
      new URL(String(input)).pathname === '/' ? new Response(home) : base(input)
    const job = await svc.start(shopId, { url: 'musli.example.com' }, db, hooks(withHome))
    assert.equal(job.status, 'done', job.error ?? '')

    const page = (await pageService.list(shopId, db)).find((p) => p.handle === 'contact')
    assert.equal(page?.title, 'Contact us')
    assert.match(page?.bodyHtml ?? '', /Hotline: \+49 30 1234/)
    const main = await menuService.getByHandle(shopId, 'main-menu', db)
    assert.deepEqual(
      main?.items.map((i) => [i.title, i.type, i.resourceId]),
      [['Contact us', 'page', page?.id]],
    )
  })

  test('a store that blocks the importer is told so, not called unreadable', async () => {
    const shopId = await newShop()
    const blocked = async () => new Response('Verifying your connection...', { status: 403 })
    const job = await svc.start(shopId, { url: 'musli.example.com' }, db, hooks(blocked))
    assert.equal(job.status, 'failed')
    assert.match(job.error ?? '', /limiting automated reads/)
  })

  test('a SKU the whole shop already uses is blanked, so no product is lost to it', async () => {
    const shopId = await newShop()
    const job = await svc.start(shopId, { url: 'musli.example.com' }, db, hooks(shopifyStore({ n: 5 })))
    assert.equal(job.counts?.products, 5)
    assert.equal(job.problems.length, 0)
  })
})

describe('importing into a shop that already sells', () => {
  async function shopWithProduct(currency: string) {
    const shopId = await newShop(currency)
    await productService.create(shopId, { title: 'My own product', priceCents: 1000 }, db)
    await seedDefaultMenu(db, shopId)
    const main = await menuService.getByHandle(shopId, 'main-menu', db)
    return { shopId, main }
  }

  test('a store in another currency is refused, so its prices are not mislabeled', async () => {
    const { shopId } = await shopWithProduct('USD')
    const job = await svc.start(shopId, { url: 'musli.example.com' }, db, hooks(shopifyStore({ currency: 'EUR' })))
    assert.equal(job.status, 'failed')
    assert.match(job.error ?? '', /sells in EUR but your shop is set to USD/)
    const rows = await db.select().from(products).where(eq(products.shopId, shopId))
    assert.equal(rows.length, 1)
  })

  test('the same currency adds products and keeps the shop, its theme and its menus as they are', async () => {
    const { shopId } = await shopWithProduct('EUR')
    const [before] = await db.select().from(shops).where(eq(shops.id, shopId))
    const themesBefore = (await themeService.list(shopId, db)).length
    const job = await svc.start(shopId, { url: 'musli.example.com' }, db, hooks(shopifyStore({ currency: 'EUR' })))
    assert.equal(job.status, 'done', job.error ?? '')
    assert.equal(job.counts?.branded, false)
    const [after] = await db.select().from(shops).where(eq(shops.id, shopId))
    assert.equal(after?.name, before?.name)
    assert.equal(after?.language, before?.language)
    assert.equal((await themeService.list(shopId, db)).length, themesBefore)
    const rows = await db.select().from(products).where(eq(products.shopId, shopId))
    assert.equal(rows.length, 9)
  })

  test('a menu the owner has built is not replaced', async () => {
    const { shopId, main } = await shopWithProduct('EUR')
    assert.ok(main)
    await menuService.update(
      shopId,
      main.id,
      {
        items: [
          {
            id: crypto.randomUUID(),
            title: 'Lookbook',
            type: 'frontpage',
            items: [{ id: crypto.randomUUID(), title: 'Sub', type: 'catalog', items: [] }],
          },
        ],
      },
      db,
    )
    await svc.start(shopId, { url: 'musli.example.com' }, db, hooks(shopifyStore({ currency: 'EUR' })))
    const after = await menuService.getByHandle(shopId, 'main-menu', db)
    assert.deepEqual(
      after?.items.map((i) => i.title),
      ['Lookbook'],
    )
  })

  test('branding can be asked for, and then the shop switches currency', async () => {
    const { shopId } = await shopWithProduct('USD')
    const job = await svc.start(
      shopId,
      { url: 'musli.example.com', branding: true },
      db,
      hooks(shopifyStore({ currency: 'EUR' })),
    )
    assert.equal(job.status, 'done', job.error ?? '')
    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId))
    assert.equal(shop?.currency, 'EUR')
  })
})

describe('a store that sends hostile data', () => {
  test('is held to the product limits, and no script or javascript: address is stored', async () => {
    const shopId = await newShop()
    const big = 'x'.repeat(1_000_000)
    const evil = async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/products.json') {
        return json({
          products: [
            {
              id: 1,
              title: 'Hostile',
              handle: 'hostile',
              body_html: '<script>alert(1)</script><img src=x onerror=alert(2)><p>ok</p>',
              vendor: big,
              product_type: big,
              tags: '',
              options: [{ name: 'Title', values: ['Default Title'] }],
              variants: [{ sku: 'a', price: '3.00', available: true }],
              images: [{ src: 'javascript:alert(1)' }, { src: 'https://cdn.example.com/1.jpg' }],
            },
          ],
        })
      }
      if (url.pathname === '/meta.json') return json({ name: big, currency: 'USD' })
      if (url.pathname === '/') {
        return new Response('<html lang="en"><header><img class="logo" src="javascript:alert(1)"></header></html>')
      }
      return missing()
    }
    const job = await svc.start(shopId, { url: 'evil.example.com' }, db, hooks(evil))
    assert.equal(job.status, 'done', job.error ?? '')
    const [row] = await db.select().from(products).where(eq(products.shopId, shopId))
    assert.equal(row?.vendor.length, 200)
    assert.equal(row?.productType.length, 200)
    assert.doesNotMatch(row?.descriptionHtml ?? '', /script|onerror/i)
    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId))
    assert.equal(shop?.name.length, 100)
    assert.equal(shop?.logo, null)
    const live = await themeService.getLive(shopId, db)
    const settings = (live?.published as { settings: Record<string, string> }).settings
    assert.equal(settings.logo, undefined)
  })
})

describe('what is refused or fails', () => {
  test('an address that is not a public store address never starts', async () => {
    const shopId = await newShop()
    for (const url of ['localhost', '10.0.0.1', 'http://169.254.169.254', 'not a url'])
      await assert.rejects(svc.start(shopId, { url }, db, hooks(shopifyStore())), rejects('INVALID_STORE_ADDRESS'), url)
    assert.equal(await svc.latest(shopId, db), null)
  })

  test('a store that is neither Shopify nor WooCommerce fails with words the owner can act on', async () => {
    const shopId = await newShop()
    const job = await svc.start(
      shopId,
      { url: 'plain.example.com' },
      db,
      hooks(async () => missing()),
    )
    assert.equal(job.status, 'failed')
    assert.match(job.error ?? '', /Shopify store with a public catalog or a WooCommerce store/)
  })

  test('an unexpected error is not shown to the owner as it is', async () => {
    const shopId = await newShop()
    const job = await svc.start(shopId, { url: 'musli.example.com' }, db, {
      wait: true,
      fetcher: {
        pauseMs: 0,
        checkHost: async () => {},
        fetchImpl: (async () => {
          throw new TypeError('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2')
        }) as typeof fetch,
      },
    })
    assert.equal(job.status, 'failed')
    assert.doesNotMatch(job.error ?? '', /hunter2|10\.1\.2\.3/)
  })

  test('a second import cannot start while one runs, and a finished one frees the shop', async () => {
    const shopId = await newShop()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow = shopifyStore()
    const first = await svc.start(shopId, { url: 'musli.example.com' }, db, {
      fetcher: {
        pauseMs: 0,
        checkHost: async () => {},
        fetchImpl: (async (input: string | URL | Request) => (await gate, slow(input))) as typeof fetch,
      },
    })
    assert.equal(first.status, 'running')
    await assert.rejects(
      svc.start(shopId, { url: 'musli.example.com' }, db, hooks(shopifyStore())),
      rejects('IMPORT_RUNNING'),
    )
    release()
    for (let i = 0; i < 200 && (await svc.get(shopId, first.id, db))?.status === 'running'; i++)
      await new Promise((r) => setTimeout(r, 50))
    assert.equal((await svc.get(shopId, first.id, db))?.status, 'done')
    const next = await svc.start(shopId, { url: 'musli.example.com' }, db, hooks(shopifyStore()))
    assert.equal(next.status, 'done')
  })

  test('a shop may start only a few imports a day', async () => {
    const shopId = await newShop()
    for (let i = 0; i < 5; i++)
      await svc.start(
        shopId,
        { url: 'plain.example.com' },
        db,
        hooks(async () => missing()),
      )
    await assert.rejects(
      svc.start(
        shopId,
        { url: 'plain.example.com' },
        db,
        hooks(async () => missing()),
      ),
      rejects('IMPORT_LIMIT'),
    )
  })

  test('an import that stopped moving is reported as failed', async () => {
    const shopId = await newShop()
    const [row] = await db
      .insert(storeImports)
      .values({ shopId, origin: 'https://musli.example.com', updatedAt: new Date(Date.now() - 11 * 60_000) })
      .returning()
    const got = await svc.get(shopId, row!.id, db)
    assert.equal(got?.status, 'failed')
    assert.match(got?.error ?? '', /stopped before it finished/)
  })

  test('one shop cannot read another shop’s import', async () => {
    const a = await newShop()
    const b = await newShop()
    const job = await svc.start(
      a,
      { url: 'plain.example.com' },
      db,
      hooks(async () => missing()),
    )
    assert.equal(await svc.get(b, job.id, db), null)
    assert.equal(await svc.latest(b, db), null)
  })
})
