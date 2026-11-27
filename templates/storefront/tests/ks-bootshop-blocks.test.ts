// KS BootShop's hero, testimonials, FAQ and featured collections, rendered from their real section files: one block per
// slide, quote, question or collection, and the old numbered settings while a section has no blocks.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const dir = new URL('../themes/ks-bootshop', import.meta.url).pathname

const block = (id: string, type: string, settings: Record<string, unknown>): SectionObject['blocks'][number] => ({
  id,
  type,
  settings,
  shopify_attributes: new SafeHtml(`data-block-id="${id}"`),
})

const section = (
  type: string,
  settings: Record<string, unknown>,
  blocks: SectionObject['blocks'] = [],
): SectionObject => ({ id: 's1', type, settings, blocks, block_order: blocks.map((b) => b.id) })

const collections = [
  { url: '/collections/a', title: 'Alpha', image: null },
  { url: '/collections/b', title: 'Beta', image: null },
  { url: '/collections/c', title: 'Gamma', image: null },
  { url: '/collections/d', title: 'Delta', image: null },
  { url: '/collections/e', title: 'Epsilon', image: null },
]

function render(s: SectionObject) {
  const liquid = createLiquid('ks-bootshop', dir)
  const data: RenderData = { sections: () => [s], section: () => null }
  return liquid.parseAndRender("{% sections 'home' %}", {}, { globals: { [RENDER]: data, collections } })
}

describe('hero carousel', () => {
  const settings = { height: '60vh', autoplay: true }

  test('a slide per block, with its attributes; the first has the h1 and is active', async () => {
    const html = await render(
      section('hero-carousel', settings, [
        block('a', 'slide', { image: '/one.jpg', heading: 'One', button_label: 'Shop', button_link: '/products' }),
        block('b', 'slide', { heading: 'Two', text: 'More' }),
        block('c', 'slide', { image: '', heading: '' }),
      ]),
    )
    assert.match(html, /<div data-block-id="a" class="carousel-item active">/)
    assert.match(html, /<h1 class="display-4">One<\/h1>/)
    assert.match(html, /<a href="\/products" class="btn btn-primary btn-lg">Shop<\/a>/)
    assert.match(html, /<div data-block-id="b" class="carousel-item">/)
    assert.match(html, /<h2 class="display-4">Two<\/h2>/)
    assert.match(html, /data-bs-ride="carousel"/)
    assert.doesNotMatch(html, /data-block-id="c"/) // no image and no heading: skipped
    assert.equal([...html.matchAll(/data-bs-slide-to/g)].length, 2)
  })

  test('one slide has no indicators or arrows', async () => {
    const html = await render(section('hero-carousel', settings, [block('a', 'slide', { heading: 'Only' })]))
    assert.doesNotMatch(html, /carousel-control|carousel-indicators|data-bs-ride/)
  })

  test('without blocks the old numbered settings still show', async () => {
    const html = await render(
      section('hero-carousel', { ...settings, image_1: '/old.jpg', heading_1: 'Old', heading_2: 'Second' }),
    )
    assert.match(html, /<img src="\/old\.jpg"/)
    assert.match(html, /<h1 class="display-4">Old<\/h1>/)
    assert.match(html, /<h2 class="display-4">Second<\/h2>/)
    assert.doesNotMatch(html, /data-block-id/)
  })

  test('blocks win over the old settings', async () => {
    const html = await render(
      section('hero-carousel', { ...settings, heading_1: 'Old' }, [block('a', 'slide', { heading: 'New' })]),
    )
    assert.match(html, /New/)
    assert.doesNotMatch(html, /Old/)
  })
})

describe('testimonials', () => {
  test('a quote per block; one without a quote is skipped', async () => {
    const html = await render(
      section('testimonials', { heading: 'Say', background: 'ks-bg-body', padding: 'ks-py-md' }, [
        block('a', 'quote', { quote: 'Great <b>shop</b>', author: 'Sam' }),
        block('b', 'quote', { quote: '', author: 'Nobody' }),
      ]),
    )
    assert.match(html, /<figure data-block-id="a" class="ks-quote">/)
    assert.match(html, /<blockquote>Great &lt;b&gt;shop&lt;\/b&gt;<\/blockquote>/)
    assert.match(html, /<figcaption>Sam<\/figcaption>/)
    assert.doesNotMatch(html, /Nobody/)
  })

  test('the old numbered quotes show while there are no blocks, and no quotes means no section', async () => {
    const old = await render(section('testimonials', { quote_1: 'Old one', author_1: 'Al' }))
    assert.match(old, /Old one/)
    assert.doesNotMatch(await render(section('testimonials', {})), /ks-section/)
  })
})

describe('FAQ', () => {
  const settings = { heading: 'FAQ', background: 'ks-bg-body', padding: 'ks-py-md' }

  test('a question per block, each panel in the accordion with an id of its own', async () => {
    const html = await render(
      section('faq', settings, [
        block('a', 'question', { question: 'Shipping?', answer: 'Yes' }),
        block('b', 'question', { question: 'Returns?', answer: 'Within 30 days' }),
        block('c', 'question', { question: '', answer: 'x' }),
      ]),
    )
    assert.match(html, /<div data-block-id="a" class="accordion-item">/)
    assert.match(html, /data-bs-target="#ks-faq-s1-a"/)
    assert.match(html, /id="ks-faq-s1-b"[^>]*data-bs-parent="#ks-faq-s1"/)
    assert.match(html, /<div class="accordion" id="ks-faq-s1">/)
    assert.doesNotMatch(html, /data-block-id="c"/)
  })

  test('the old numbered questions show while there are no blocks', async () => {
    const html = await render(section('faq', { ...settings, question_1: 'Old?', answer_1: 'Old answer' }))
    assert.match(html, /data-bs-target="#ks-faq-s1-1"/)
    assert.match(html, /Old answer/)
  })
})

describe('featured collections', () => {
  const settings = { heading: 'Shop', background: 'ks-bg-body', padding: 'ks-py-md' }

  test('a tile per block with a collection, in the merchant’s order', async () => {
    const html = await render(
      section('featured-collections', settings, [
        block('a', 'collection', { collection: collections[2] }),
        block('b', 'collection', { collection: null }),
        block('c', 'collection', { collection: collections[0] }),
      ]),
    )
    assert.match(html, /<a data-block-id="a" href="\/collections\/c" class="ks-tile">/)
    assert.ok(html.indexOf('Gamma') < html.indexOf('Alpha'))
    assert.doesNotMatch(html, /data-block-id="b"|Beta/)
    assert.match(html, /--ks-columns: 2/)
  })

  test('more than four tiles wrap, in four columns', async () => {
    const blocks = collections.map((c, i) => block(`t${i}`, 'collection', { collection: c }))
    assert.match(await render(section('featured-collections', settings, blocks)), /--ks-columns: 4/)
  })

  test('without blocks: the old picks, else the shop’s first four collections', async () => {
    const picked = await render(section('featured-collections', { ...settings, collection_1: collections[1] }))
    assert.match(picked, /Beta/)
    assert.doesNotMatch(picked, /Alpha/)
    const first = await render(section('featured-collections', settings))
    assert.equal([...first.matchAll(/class="ks-tile"/g)].length, 4)
  })
})
