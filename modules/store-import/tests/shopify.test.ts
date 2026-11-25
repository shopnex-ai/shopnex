// What the Shopify reader keeps of a store's products.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Fetcher } from '../src/fetcher'
import { fetchShopify, isDataTag } from '../src/shopify'

const product = (tags: string | string[]) => ({
  id: 1,
  title: 'Anytime No Show Sock',
  handle: 'sock',
  body_html: '',
  vendor: 'Allbirds',
  product_type: 'Socks',
  tags,
  options: [{ name: 'Title', values: ['Default Title'] }],
  variants: [{ sku: 'S1', price: '12.00', compare_at_price: null, available: true }],
  images: [],
})

const tagsOf = async (tags: string | string[]) => {
  const fetcher = {
    json: async (url: string) => {
      if (url.includes('/products.json'))
        return url.includes('page=1') ? { products: [product(tags)] } : { products: [] }
      return {}
    },
  } as unknown as Fetcher
  const found = await fetchShopify('https://shop.example.com', 10, fetcher)
  return found.products[0]?.input.tags
}

describe('data tags', () => {
  test('namespace::key => value tags are recognised', () => {
    for (const tag of [
      'allbirds::gender => unisex',
      'allbirds::carbon-score => undefined',
      'allbirds::complete',
      'size => large',
    ]) {
      assert.equal(isDataTag(tag), true, tag)
    }
  })

  test('ordinary tags are not', () => {
    for (const tag of ['bfcm-mens', 'new arrivals', 'Summer 2026', 'a:b', 'fast=>furious', 'sale']) {
      assert.equal(isDataTag(tag), false, tag)
    }
  })

  test('are not imported, whether the feed sends the tags as a list or as one string', async () => {
    const sent = ['bfcm-mens', 'allbirds::gender => unisex', 'allbirds::material => cotton', 'sale']
    assert.deepEqual(await tagsOf(sent), ['bfcm-mens', 'sale'])
    assert.deepEqual(await tagsOf(sent.join(', ')), ['bfcm-mens', 'sale'])
  })
})

describe('the store’s own collections', () => {
  test('are read with the products in each, skipping the catch-all and empty ones', async () => {
    const fetcher = {
      json: async (url: string) => {
        if (url.includes('/collections.json'))
          return {
            collections: [
              { handle: 'all-products', title: 'All Products', products_count: 1 },
              {
                handle: 'bagpaks',
                title: 'Backpack',
                products_count: 1,
                image: { src: 'https://cdn.example.com/b.jpg' },
              },
              { handle: 'kids-bag', title: 'Kids Bag', products_count: 0 },
            ],
          }
        if (url.includes('/collections/bagpaks/products.json')) return { products: [{ handle: 'sock' }] }
        if (url.includes('/products.json'))
          return url.includes('page=1') ? { products: [product([])] } : { products: [] }
        return {}
      },
    } as unknown as Fetcher
    const found = await fetchShopify('https://shop.example.com', 10, fetcher)
    assert.equal(found.products[0]?.key, 'sock')
    assert.deepEqual(found.collections, [{ title: 'Backpack', image: 'https://cdn.example.com/b.jpg', keys: ['sock'] }])
  })
})
