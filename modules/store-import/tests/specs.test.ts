// Facts a store lists beside a product (Shopify data tags, WooCommerce attributes, weight) become product custom fields.
import assert from 'node:assert/strict'
import test, { before, describe } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { products } from '@shopnex/catalog/schema'
import { shops } from '@shopnex/core/schema'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { customFieldService } = await import('@shopnex/custom-fields')
const svc = await import('../src/store-import')
const { fieldKey, specsFromTags, MAX_FIELDS } = await import('../src/specs')

before(() => prepareDatabase())

let counter = 0
async function newShop() {
  const id = `specs-${++counter}`
  await db.insert(shops).values({ id, name: 'Test shop', slug: id, currency: 'USD' })
  return id
}

const json = (value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
const hooks = (fetchImpl: (input: string | URL | Request) => Promise<Response>) => ({
  wait: true,
  fetcher: { pauseMs: 0, checkHost: async () => {}, fetchImpl: fetchImpl as typeof fetch },
})

const shopifyProduct = (i: number, tags: string[]) => ({
  id: i,
  title: `Shoe ${i}`,
  handle: `shoe-${i}`,
  body_html: '<p>x</p>',
  vendor: 'Co',
  product_type: 'Shoe',
  tags,
  options: [{ name: 'Title', values: ['Default Title'] }],
  variants: [{ sku: `S${i}`, price: '50.00', compare_at_price: null, available: true }],
  images: [],
})
const shopify = (items: unknown[]) => async (input: string | URL | Request) => {
  const url = new URL(String(input))
  if (url.pathname === '/products.json')
    return json({ products: url.searchParams.get('limit') === '1' ? items.slice(0, 1) : items })
  if (url.pathname === '/meta.json') return json({ name: 'Shoes', currency: 'USD' })
  return new Response('no', { status: 404 })
}

const wooProduct = (i: number, extra: Record<string, unknown> = {}) => ({
  id: i,
  name: `Shirt ${i}`,
  type: 'simple',
  sku: `W${i}`,
  description: '<p>x</p>',
  prices: { price: '2500', regular_price: '2500', currency_code: 'USD', currency_minor_unit: 2 },
  images: [],
  categories: [],
  tags: [],
  attributes: [],
  is_in_stock: true,
  ...extra,
})
const woo = (items: unknown[]) => async (input: string | URL | Request) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith('/wc/store/v1/products')) return json(items, { 'x-wp-total': String(items.length) })
  return new Response('no', { status: 404 })
}

const stored = async (shopId: string, title: string) => {
  const [row] = await db
    .select({ customFields: products.customFields, tags: products.tags })
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.title, title)))
  return row
}

describe('reading specs', () => {
  test('a label becomes a key themes can address', () => {
    assert.equal(fieldKey('Care Instructions'), 'care_instructions')
    assert.equal(fieldKey('Größe (EU)'), 'gro_e_eu')
    assert.equal(fieldKey('3D print'), 'f_3d_print')
    assert.equal(fieldKey('---'), null)
    assert.ok((fieldKey('x'.repeat(200)) ?? '').length <= 40)
  })

  test('data tags are read, ordinary tags are not, and a repeated key keeps every value', () => {
    assert.deepEqual(
      specsFromTags([
        'sale',
        'allbirds::gender => unisex',
        'filter::Material => Wool',
        'filter::Material => Cotton',
        'x::y',
      ]),
      [
        { label: 'Gender', value: 'unisex' },
        { label: 'Material', value: 'Wool, Cotton' },
      ],
    )
    assert.deepEqual(specsFromTags(['a => ', ' => b']), [])
    // An app's per-item keys carry a generated id
    assert.deepEqual(
      specsFromTags(['allbirdskit::kit-discount-69llI09wAImGAsGtS9wOgp => 18', 'loop::returnable => true']),
      [{ label: 'Returnable', value: 'true' }],
    )
  })
})

describe('a Shopify store’s data tags', () => {
  test('become text custom fields shown on the storefront, and stay out of the tags', async () => {
    const shopId = await newShop()
    const job = await svc.start(
      shopId,
      { url: 'https://shoes.example.com' },
      db,
      hooks(
        shopify([
          shopifyProduct(1, ['sale', 'brand::gender => unisex', 'brand::material => Wool']),
          shopifyProduct(2, ['brand::gender => women']),
        ]),
      ),
    )
    assert.equal(job.status, 'done', job.error ?? '')
    assert.equal(job.counts?.customFields, 2)

    const defs = await customFieldService.list(shopId, 'product', db)
    assert.deepEqual(defs.map((d) => [d.key, d.label, d.type, d.storefront]).sort(), [
      ['gender', 'Gender', 'text', true],
      ['material', 'Material', 'text', true],
    ])
    const first = await stored(shopId, 'Shoe 1')
    assert.deepEqual(first?.customFields, { gender: 'unisex', material: 'Wool' })
    assert.deepEqual(first?.tags, ['sale'])
    assert.deepEqual((await stored(shopId, 'Shoe 2'))?.customFields, { gender: 'women' })
  })

  test('the tags of a real Allbirds product (recorded from allbirds.com/products.json): app ids stay out', async () => {
    const shopId = await newShop()
    const tags = [
      'allbirds::carbon-score => 4.52',
      'allbirds::cfId => color-womens-tree-runners-wheat-dark-beige',
      'allbirds::complete => true',
      'allbirds::edition => limited',
      'allbirds::gender => womens',
      'allbirds::hue => beige',
      'allbirds::hue => grey',
      'allbirds::master => womens-tree-runners',
      'allbirds::material => tree',
      'allbirds::price-tier => msrp',
      'allbirds::silhouette => runner',
      'allbirdskit::kit-discount-69llI09wAImGAsGtS9wOgp => 18',
      'allbirdskit::kit-id => 69llI09wAImGAsGtS9wOgp',
      'allbirdskit::kit-size-69llI09wAImGAsGtS9wOgp => 2',
      'bfcm-womens',
      'FINAL SALE',
      'loop::returnable => true',
      'tier-2',
    ]
    const job = await svc.start(
      shopId,
      { url: 'https://allbirds.example.com' },
      db,
      hooks(shopify([shopifyProduct(1, tags)])),
    )
    assert.equal(job.status, 'done', job.error ?? '')
    const row = await stored(shopId, 'Shoe 1')
    assert.deepEqual(row?.customFields, {
      carbon_score: '4.52',
      cfid: 'color-womens-tree-runners-wheat-dark-beige',
      complete: 'true',
      edition: 'limited',
      gender: 'womens',
      hue: 'beige, grey',
      master: 'womens-tree-runners',
      material: 'tree',
      price_tier: 'msrp',
      silhouette: 'runner',
      kit_id: '69llI09wAImGAsGtS9wOgp',
      returnable: 'true',
    })
    assert.deepEqual(row?.tags, ['bfcm-womens', 'FINAL SALE', 'tier-2'])
  })

  test('a field the shop already has of another type is left alone and the product still comes across', async () => {
    const shopId = await newShop()
    await customFieldService.create(shopId, { resource: 'product', key: 'gender', label: 'Gender', type: 'number' }, db)
    const job = await svc.start(
      shopId,
      { url: 'https://shoes.example.com' },
      db,
      hooks(shopify([shopifyProduct(1, ['b::gender => unisex', 'b::fit => slim'])])),
    )
    assert.equal(job.status, 'done', job.error ?? '')
    assert.deepEqual((await stored(shopId, 'Shoe 1'))?.customFields, { fit: 'slim' })
    assert.equal((await customFieldService.list(shopId, 'product', db)).find((d) => d.key === 'gender')?.type, 'number')
  })

  test('at most a few fields are added, the most common first, and a long value is cut', async () => {
    const shopId = await newShop()
    const many = Array.from({ length: MAX_FIELDS + 5 }, (_, i) => `b::f${i} => v`)
    const items = [shopifyProduct(1, [...many, `b::f0 => ${'z'.repeat(2000)}`]), shopifyProduct(2, ['b::f3 => v'])]
    const job = await svc.start(shopId, { url: 'https://shoes.example.com' }, db, hooks(shopify(items)))
    assert.equal(job.status, 'done', job.error ?? '')
    const defs = await customFieldService.list(shopId, 'product', db)
    assert.equal(defs.length, MAX_FIELDS)
    assert.ok(
      defs.some((d) => d.key === 'f3'),
      'the field both products carry is kept',
    )
    assert.ok(
      Object.values((await stored(shopId, 'Shoe 1'))?.customFields ?? {}).every((v) => String(v).length <= 1000),
    )
  })

  test('a store with no data tags adds no fields', async () => {
    const shopId = await newShop()
    const job = await svc.start(
      shopId,
      { url: 'https://shoes.example.com' },
      db,
      hooks(shopify([shopifyProduct(1, ['sale'])])),
    )
    assert.equal(job.status, 'done', job.error ?? '')
    assert.equal(job.counts?.customFields, 0)
    assert.deepEqual(await customFieldService.list(shopId, 'product', db), [])
  })
})

describe('a WooCommerce store’s attributes', () => {
  test('become custom fields: attributes, weight and size, but not what variations choose between', async () => {
    const shopId = await newShop()
    const item = wooProduct(1, {
      attributes: [
        { name: 'Material', has_variations: false, terms: [{ name: 'Cotton' }, { name: 'Linen' }] },
        { name: 'Color', has_variations: true, terms: [{ name: 'Red' }] },
      ],
      formatted_weight: '0.4 kg',
      formatted_dimensions: '30 × 20 × 2 cm',
    })
    const job = await svc.start(
      shopId,
      { url: 'https://shirts.example.com' },
      db,
      hooks(woo([item, wooProduct(2, { formatted_weight: 'N/A', formatted_dimensions: 'N/A' })])),
    )
    assert.equal(job.status, 'done', job.error ?? '')
    assert.equal(job.platform, 'woocommerce')
    assert.equal(job.counts?.customFields, 3)
    assert.deepEqual((await stored(shopId, 'Shirt 1'))?.customFields, {
      material: 'Cotton, Linen',
      weight: '0.4 kg',
      dimensions: '30 × 20 × 2 cm',
    })
    assert.deepEqual((await stored(shopId, 'Shirt 2'))?.customFields, {})
  })
})
