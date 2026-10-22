// SEO basics every theme gets from the storefront: the homepage's title and description (Settings → General),
// canonical URLs, product structured data, robots.txt and sitemap.xml. Needs the storefront running
// (STOREFRONT_URL, default http://localhost:4321). Restores the shop's SEO fields at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { getShopById, updateShop } from '@shopnex/tenancy'
import { SHOP, call, closeDb, ok } from '../lib'

const STOREFRONT = (process.env.STOREFRONT_URL ?? 'http://localhost:4321').replace(/\/$/, '')

const page = async (path: string) => {
  const r = await fetch(STOREFRONT + path)
  return { status: r.status, type: r.headers.get('content-type') ?? '', text: await r.text() }
}
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]!))

let original: { seoTitle: string | null; seoDescription: string | null }

describe('seo', () => {
  before(async () => {
    const shop = await getShopById(SHOP)
    assert.ok(shop)
    original = { seoTitle: shop.seoTitle, seoDescription: shop.seoDescription }
  })

  after(async () => {
    await updateShop(SHOP, original)
    await closeDb()
  })

  test('the homepage uses the shop’s title and description, as is', async () => {
    const title = `E2E home ${Date.now()}`
    await updateShop(SHOP, { seoTitle: title, seoDescription: 'Fine things <made> by hand' })

    const shop = ok(await call('GET', '/storefront/shop'))
    assert.deepEqual(shop.seo, { title, description: 'Fine things <made> by hand' })

    const home = await page('/')
    assert.match(home.text, new RegExp(`<title>${title}</title>`))
    assert.match(home.text, /<meta name="description" content="Fine things &lt;made&gt; by hand"/)
    assert.match(home.text, new RegExp(`<link rel="canonical" href="${STOREFRONT}/">`))
    assert.ok(jsonLd(home.text).some((d) => d['@type'] === 'WebSite'))
  })

  test('robots.txt points to the sitemap, which lists the catalog', async () => {
    const robots = await page('/robots.txt')
    assert.match(robots.type, /^text\/plain/)
    assert.match(robots.text, new RegExp(`^Sitemap: ${STOREFRONT}/sitemap.xml$`, 'm'))

    const sitemap = await page('/sitemap.xml')
    assert.match(sitemap.type, /^application\/xml/)
    assert.match(sitemap.text, new RegExp(`<loc>${STOREFRONT}/products</loc>`))
    const products = ok(await call('GET', '/storefront/products?first=1'))
    assert.ok(products.nodes.length, 'Need an active product in the shop')
    assert.match(sitemap.text, new RegExp(`<loc>${STOREFRONT}/products/${products.nodes[0].handle}</loc>`))
  })

  test('a product page has its canonical URL and Product structured data', async () => {
    const [product] = ok(await call('GET', '/storefront/products?first=1')).nodes
    const html = (await page(`/products/${product.handle}?variant=${product.variants[0].id}`)).text
    // The selected variant isn't part of the canonical address
    assert.match(html, new RegExp(`<link rel="canonical" href="${STOREFRONT}/products/${product.handle}">`))
    assert.match(html, /<meta property="og:type" content="product">/)
    assert.equal(html.match(/property="og:type"/g)?.length, 1)

    const data = jsonLd(html).find((d) => d['@type'] === 'Product')
    assert.ok(data)
    assert.equal(data.name, product.title)
    assert.equal(data.offers.length, product.variants.length)
    assert.equal(data.offers[0].priceCurrency, product.variants[0].price.currencyCode)
  })

  test('a missing page is kept out of search results', async () => {
    const missing = await page(`/products/e2e-missing-${Date.now()}`)
    assert.equal(missing.status, 404)
    assert.match(missing.text, /<meta name="robots" content="noindex">/)
    assert.doesNotMatch(missing.text, /rel="canonical"/)
  })
})
