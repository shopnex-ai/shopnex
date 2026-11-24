// A store is whatever server answers at the address someone typed: nothing it sends is trusted.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { boundProduct, httpUrl } from '../src/bounds'

describe('httpUrl', () => {
  test('only absolute http and https addresses pass', () => {
    assert.equal(httpUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg')
    assert.equal(httpUrl('http://cdn.example.com/a.jpg'), 'http://cdn.example.com/a.jpg')
    for (const bad of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      '//cdn.example.com/a.jpg',
      '/a.jpg',
      '',
      null,
      42,
      `https://e.com/${'a'.repeat(3000)}`,
    ]) {
      assert.equal(httpUrl(bad), null, String(bad))
    }
  })
})

describe('boundProduct', () => {
  const hostile = {
    title: 'T'.repeat(5000),
    vendor: 'v'.repeat(1_000_000),
    productType: 'p'.repeat(1_000_000),
    tags: Array.from({ length: 5000 }, () => 't'.repeat(500)),
    descriptionHtml: 'd'.repeat(1_000_000),
    options: [
      { name: 'Size', values: Array.from({ length: 3000 }, (_, i) => `v${i}`) },
      { name: 'Color', values: ['Red'] },
      { name: 'Fit', values: ['Slim'] },
      { name: 'Fourth', values: ['x'] },
    ],
    variants: Array.from({ length: 3000 }, (_, i) => ({
      sku: `sku-${i}-${'s'.repeat(500)}`,
      priceCents: i === 0 ? Number.NaN : i === 1 ? -5 : i === 2 ? 1e15 : 1999,
      compareAtPriceCents: 500,
      inventoryQuantity: 7,
      imageUrl: i % 2 ? 'javascript:alert(1)' : 'https://cdn.example.com/a.jpg',
      options: { Size: `v${i}`, Color: 'Red', Fit: 'Slim', Fourth: 'x' },
    })),
    images: [
      { url: 'javascript:alert(1)', alt: 'x' },
      ...Array.from({ length: 2000 }, (_, i) => ({ url: `https://cdn.example.com/${i}.jpg`, alt: 'a'.repeat(900) })),
    ],
  }
  const bounded = boundProduct(hostile)

  test('lengths are the product API’s', () => {
    assert.equal(bounded.title.length, 250)
    assert.equal(bounded.vendor?.length, 200)
    assert.equal(bounded.productType?.length, 200)
    assert.equal(bounded.tags?.length, 250)
    assert.ok(bounded.tags?.every((t) => t.length <= 100))
    assert.equal(bounded.descriptionHtml?.length, 100_000)
    assert.ok(bounded.variants?.every((v) => (v.sku?.length ?? 0) <= 100))
    assert.ok(bounded.images?.every((i) => (i.alt?.length ?? 0) <= 300))
  })

  test('counts are bounded: three options, a hundred variants, thirty images', () => {
    assert.deepEqual(
      bounded.options?.map((o) => o.name),
      ['Size', 'Color', 'Fit'],
    )
    assert.equal(bounded.variants?.length, 100)
    assert.equal(bounded.images?.length, 30)
  })

  test('option values are the ones the kept variants use, so the product stays consistent', () => {
    const size = bounded.options?.find((o) => o.name === 'Size')
    assert.equal(size?.values.length, 100)
    assert.ok(bounded.variants?.every((v) => size?.values.includes(v.options!.Size!)))
  })

  test('prices are whole, non-negative and fit the 32-bit column; a sale price must be higher than the price', () => {
    const prices = bounded.variants!.slice(0, 4).map((v) => v.priceCents)
    assert.deepEqual(prices, [0, 0, 2_000_000_000, 1999])
    assert.equal(bounded.variants![3]!.compareAtPriceCents, null)
    assert.equal(bounded.variants![0]!.compareAtPriceCents, 500)
  })

  test('only http and https addresses survive, on images and variants', () => {
    assert.ok(bounded.images?.every((i) => /^https?:\/\//.test(i.url)))
    assert.ok(bounded.variants?.every((v) => !v.imageUrl || /^https?:\/\//.test(v.imageUrl)))
  })

  test('stock is only ever in stock or sold out', () => {
    assert.ok(bounded.variants?.every((v) => v.inventoryQuantity === 10))
  })
})
