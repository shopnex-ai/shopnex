// KS BootShop's hero, testimonials, FAQ, featured collections and footer, rendered from their real section files: one block per
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

describe('footer', () => {
  const linklists = {
    footer: { links: [{ url: '/pages/about', title: 'About' }] },
    help: { links: [{ url: '/pages/faq', title: 'FAQ' }] },
  }
  const renderFooter = (s: SectionObject, themeSettings: Record<string, unknown> = {}) => {
    const liquid = createLiquid('ks-bootshop', dir)
    const data: RenderData = { sections: () => [], section: () => s }
    return liquid.parseAndRender(
      "{% section 'footer' %}",
      {},
      { globals: { [RENDER]: data, settings: themeSettings, shop: { name: 'Demo' }, linklists } },
    )
  }

  test('without blocks it is the single bar: text, social links and the footer menu', async () => {
    const html = await renderFooter(section('footer', {}), {
      footer_text: 'All rights',
      facebook_url: 'https://fb.test/x',
    })
    assert.match(html, /<span>All rights<\/span>/)
    assert.match(html, /ks-footer-social-link/)
    assert.match(html, /<a href="\/pages\/about">About<\/a>/)
    assert.doesNotMatch(html, /ks-footer-columns/)
  })

  test('with blocks: a column per block (text, menu, social), then the copyright', async () => {
    const html = await renderFooter(
      section('footer', {}, [
        block('t', 'text', { heading: 'About us', text: 'We <b>sell</b> things' }),
        block('m', 'menu', { heading: 'Help', menu: 'help' }),
        block('s', 'social', { heading: 'Follow us' }),
      ]),
      { footer_text: 'All rights', instagram_url: 'https://ig.test/x' },
    )
    assert.match(html, /--ks-footer-columns: 3/)
    assert.match(html, /<div data-block-id="t" class="ks-footer-column">/)
    assert.match(html, /<h2 class="ks-footer-heading">About us<\/h2>/)
    assert.match(html, /We &lt;b&gt;sell&lt;\/b&gt; things/)
    assert.match(html, /<a href="\/pages\/faq">FAQ<\/a>/)
    assert.doesNotMatch(html, /About<\/a>/) // the "footer" menu is not picked by a block
    assert.match(html, /ks-footer-social-link/)
    assert.match(html, /ks-footer-bottom[\s\S]*All rights/)
  })

  test('a menu block with no such menu shows only its heading; the copyright defaults to the shop name', async () => {
    const html = await renderFooter(section('footer', {}, [block('m', 'menu', { heading: 'Gone', menu: 'nope' })]))
    assert.match(html, /Gone/)
    assert.doesNotMatch(html, /ks-footer-menu/)
    assert.match(html, /© \d{4} Demo/)
  })

  test('more than four blocks stay in four columns', async () => {
    const blocks = [1, 2, 3, 4, 5].map((i) => block(`t${i}`, 'text', { heading: `H${i}` }))
    assert.match(await renderFooter(section('footer', {}, blocks)), /--ks-footer-columns: 4/)
  })
})
