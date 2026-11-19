// What installed apps get from the page head: their scripts, and which page and product they are on. Never in the editor's preview.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { appHeaderTags } from '../src/core/app-scripts'
import type { ThemePage } from '../src/core/theme'

const PRODUCT = '11111111-1111-4111-8111-111111111111'
const product = { template: 'product', product: { id: PRODUCT, handle: 'mug' } } as unknown as ThemePage
const home = { template: 'index' } as unknown as ThemePage
const src = 'https://reviews.example.com/widget.js?instance=https%3A%2F%2Fshop.example.com&shop=default'

describe('the page head for apps', () => {
  test('a product page says it is one, which product, and loads the scripts', () => {
    assert.deepEqual(appHeaderTags(product, [src], false), [
      '<meta name="shopnex-page" content="product">',
      `<meta name="shopnex-product" content="${PRODUCT}">`,
      `<script src="${src.replace(/&/g, '&amp;')}" defer></script>`,
    ])
  })

  test('any other page names its template and has no product', () => {
    const tags = appHeaderTags(home, [src], false)
    assert.equal(tags[0], '<meta name="shopnex-page" content="index">')
    assert.equal(
      tags.some((t) => t.includes('shopnex-product')),
      false,
    )
    assert.equal(tags.length, 2)
  })

  test('without scripts there is only the page', () => {
    assert.deepEqual(appHeaderTags(home, [], false), ['<meta name="shopnex-page" content="index">'])
  })

  test('nothing at all in the theme editor’s preview', () => {
    assert.deepEqual(appHeaderTags(product, [src], true), [])
  })

  test('an address cannot break out of its attribute or the tag', () => {
    const tags = appHeaderTags(home, ['https://x.example.com/a.js?q="><script>alert(1)</script>'], false)
    const script = tags.find((t) => t.startsWith('<script'))!
    assert.doesNotMatch(script, /"><script/i)
    assert.equal(script.match(/<script/gi)?.length, 1, 'one script tag')
    assert.match(script, /&quot;&gt;|&quot;>/)
  })

  test('only http(s) addresses become script tags', () => {
    const tags = appHeaderTags(
      home,
      ['javascript:alert(1)', 'data:text/javascript,1', 'not a url', 'http://localhost:5100/w.js'],
      false,
    )
    assert.deepEqual(
      tags.filter((t) => t.startsWith('<script')),
      ['<script src="http://localhost:5100/w.js" defer></script>'],
    )
  })
})
