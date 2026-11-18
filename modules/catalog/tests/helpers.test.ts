// The small pure helpers: slugs (how a title becomes a URL handle and how a free one is found) and merchant HTML.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { productService, collectionService, SHOP, OTHER_SHOP } = fx
const { slugify, SLUG_PATTERN, sanitizeHtml, htmlToText, escapeHtml } = await import('../src')
const { isSlugTaken, nextFreeSlug } = await import('../src/slug')

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('slugify', () => {
  test('lower case, accents dropped, anything else becomes one dash, none at the ends', () => {
    assert.equal(slugify('Été 2026!'), 'ete-2026')
    assert.equal(slugify('  Linen   Shirt – Blue  '), 'linen-shirt-blue')
    assert.equal(slugify('---a---'), 'a')
  })

  test('a title with nothing usable falls back (to "item", or the given word)', () => {
    assert.equal(slugify('日本語'), 'item')
    assert.equal(slugify('!!!', 'product'), 'product')
  })

  test('what it makes matches SLUG_PATTERN', () => {
    for (const title of ['Été 2026!', 'a', 'Hello World', '100% Cotton']) assert.match(slugify(title), SLUG_PATTERN)
    assert.equal(SLUG_PATTERN.test('Not-Valid'), false)
    assert.equal(SLUG_PATTERN.test('double--dash'), false)
    assert.equal(SLUG_PATTERN.test('-lead'), false)
  })
})

describe('finding a free slug', () => {
  test('the base if free, else base-2, base-3 within the shop; another shop’s slugs do not count', async () => {
    const { db, schema } = fx
    assert.equal(await nextFreeSlug(db, schema.products, SHOP, 'shirt'), 'shirt')
    await productService.create(SHOP, { title: 'Shirt', priceCents: 100 })
    await productService.create(SHOP, { title: 'Shirt', priceCents: 100 })
    assert.equal(await nextFreeSlug(db, schema.products, SHOP, 'shirt'), 'shirt-3')
    assert.equal(await nextFreeSlug(db, schema.products, OTHER_SHOP, 'shirt'), 'shirt')
  })

  test('isSlugTaken is per shop and per table, and can leave one row out', async () => {
    const { db, schema } = fx
    const p = await productService.create(SHOP, { title: 'Shirt', priceCents: 100 })
    assert.equal(await isSlugTaken(db, schema.products, SHOP, 'shirt'), true)
    assert.equal(await isSlugTaken(db, schema.products, SHOP, 'shirt', p.id), false)
    assert.equal(await isSlugTaken(db, schema.products, OTHER_SHOP, 'shirt'), false)
    assert.equal(await isSlugTaken(db, schema.collections, SHOP, 'shirt'), false)
    await collectionService.create(SHOP, { title: 'Shirt' })
    assert.equal(await isSlugTaken(db, schema.collections, SHOP, 'shirt'), true)
  })
})

describe('merchant HTML', () => {
  test('sanitizeHtml keeps formatting and images and drops scripts, handlers and javascript: links', () => {
    assert.equal(
      sanitizeHtml('<p onclick="x()">Hi <b>there</b></p><script>alert(1)</script>'),
      '<p>Hi <b>there</b></p>',
    )
    assert.equal(
      sanitizeHtml('<img src="https://e.test/a.png" alt="A" onerror="x()">'),
      '<img src="https://e.test/a.png" alt="A" />',
    )
    assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), '<a>x</a>')
    assert.equal(sanitizeHtml('<a href="mailto:a@e.test">x</a>'), '<a href="mailto:a@e.test">x</a>')
    assert.equal(sanitizeHtml('  <p>x</p>  '), '<p>x</p>', 'trimmed')
  })

  test('htmlToText reads block tags as spaces, decodes entities and collapses white space', () => {
    assert.equal(htmlToText('<p>a</p><p>b</p>'), 'a b')
    assert.equal(htmlToText('<p>Fish &amp; chips&nbsp;&#8364;&#x41;</p>'), 'Fish & chips €A')
    assert.equal(htmlToText('a<br>b   c\n\nd'), 'a b c d')
    assert.equal(htmlToText('<script>x()</script>text'), 'text')
  })

  test('escapeHtml escapes the five characters', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
