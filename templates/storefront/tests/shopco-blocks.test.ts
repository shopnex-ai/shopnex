// Shopco's hero figures, brand strip, collection grid, testimonials and footer columns, rendered from their real section
// files: one block per figure, brand, tile, quote or column.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const dir = new URL('../themes/shopco', import.meta.url).pathname

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
const linklists = {
  footer: { links: [{ url: '/pages/about', title: 'About', links: [] }] },
  help: { links: [{ url: '/pages/faq', title: 'FAQ' }] },
}

function render(s: SectionObject, themeSettings: Record<string, unknown> = {}, template = "{% sections 'home' %}") {
  const liquid = createLiquid('shopco', dir)
  const data: RenderData = { sections: () => [s], section: () => s }
  return liquid.parseAndRender(
    template,
    {},
    {
      globals: {
        [RENDER]: data,
        collections: Object.assign([...collections], {
          all: { products: [{ vendor: 'Acme' }, { vendor: 'Acme' }, { vendor: 'Zed' }] },
        }),
        settings: themeSettings,
        shop: { name: 'Demo' },
        linklists,
        request: { design_mode: false },
      },
    },
  )
}

describe('hero', () => {
  const settings = { heading: 'Big', text: '', button_label: '', button_link: '', image: '' }

  test('a figure per block, with its attributes; one without a value is skipped', async () => {
    const html = await render(
      section('hero', settings, [
        block('a', 'stat', { value: '200+', label: 'Brands' }),
        block('b', 'stat', { value: '', label: 'Nothing' }),
        block('c', 'stat', { value: '30,000+', label: 'Customers' }),
      ]),
    )
    assert.match(html, /<div data-block-id="a" class="flex flex-col"><span[^>]*>200\+<\/span><span[^>]*>Brands<\/span>/)
    assert.match(html, /30,000\+/)
    assert.doesNotMatch(html, /data-block-id="b"|Nothing/)
  })

  test('no blocks, no figures', async () => {
    assert.doesNotMatch(await render(section('hero', settings)), /text-\[40px\]|font-bold md:text-\[40px\]/)
  })
})

describe('brand strip', () => {
  test('a name per block; blank ones are skipped', async () => {
    const html = await render(
      section('brands', {}, [block('a', 'brand', { name: 'Gucci' }), block('b', 'brand', { name: '  ' })]),
    )
    assert.match(html, /<span data-block-id="a" class="font-display[^"]*">Gucci<\/span>/)
    assert.doesNotMatch(html, /data-block-id="b"|Acme/)
  })

  test('with no blocks the vendors of the newest products', async () => {
    const html = await render(section('brands', {}))
    assert.match(html, />Acme<\/span>/)
    assert.match(html, />Zed<\/span>/)
    assert.equal([...html.matchAll(/Acme/g)].length, 1)
  })
})

describe('collection grid', () => {
  const settings = { heading: 'Browse by style' }

  test('a tile per block with a collection, the middle two wide', async () => {
    const html = await render(
      section('style-grid', settings, [
        block('a', 'collection', { collection: collections[2] }),
        block('b', 'collection', { collection: null }),
        block('c', 'collection', { collection: collections[0] }),
        block('d', 'collection', { collection: collections[1] }),
        block('e', 'collection', { collection: collections[3] }),
        block('f', 'collection', { collection: collections[4] }),
      ]),
    )
    assert.match(html, /<a\s+data-block-id="a"\s+href="\/collections\/c"/)
    assert.ok(html.indexOf('Gamma') < html.indexOf('Alpha'))
    assert.doesNotMatch(html, /data-block-id="b"/)
    assert.equal([...html.matchAll(/md:col-span-2/g)].length, 2)
    assert.match(html, /Delta/) // the fourth with a collection
    assert.doesNotMatch(html, /Epsilon|data-block-id="f"/) // no fifth tile
  })

  test('until a block has a collection, the shop’s first four', async () => {
    const html = await render(section('style-grid', settings))
    assert.equal([...html.matchAll(/href="\/collections\//g)].length, 4)
    assert.doesNotMatch(html, /data-block-id/)
  })
})

describe('testimonials', () => {
  test('a card per block; stars follow the setting; a block without a quote is skipped', async () => {
    const blocks = [
      block('a', 'quote', { name: 'Sam', quote: 'Great <b>shop</b>' }),
      block('b', 'quote', { name: 'Nobody', quote: '' }),
    ]
    const html = await render(section('testimonials', { heading: 'Say', show_stars: true }, blocks))
    assert.match(html, /<figure data-block-id="a"/)
    assert.match(html, /Great &lt;b&gt;shop&lt;\/b&gt;/)
    assert.match(html, /text-star/)
    assert.doesNotMatch(html, /Nobody|data-block-id="b"/)
    assert.doesNotMatch(
      await render(section('testimonials', { heading: 'Say', show_stars: false }, blocks)),
      /text-star/,
    )
  })

  test('no quotes, no section', async () => {
    assert.doesNotMatch(await render(section('testimonials', { heading: 'Say' })), /data-carousel/)
  })
})

describe('footer', () => {
  const footer = (blocks: SectionObject['blocks'] = []) =>
    render(section('footer', {}, blocks), { footer_text: 'About the shop' }, "{% section 'footer' %}")

  test('without blocks the columns come from the "footer" menu', async () => {
    const html = await footer()
    assert.match(html, /About<\/a>/)
    assert.match(html, /About the shop/)
    assert.doesNotMatch(html, /data-block-id/)
  })

  test('with blocks: a column per block (text or menu) instead of the menu’s', async () => {
    const html = await footer([
      block('t', 'text', { heading: 'Visit', text: 'Open daily' }),
      block('m', 'menu', { heading: 'Help', menu: 'help' }),
    ])
    assert.match(html, /<div data-block-id="t"/)
    assert.match(html, /Visit/)
    assert.match(html, /Open daily/)
    assert.match(html, /<a href="\/pages\/faq"[^>]*>FAQ<\/a>/)
    assert.doesNotMatch(html, /About<\/a>/) // the "footer" menu is not shown
    assert.match(html, /About the shop/) // the brand column stays
  })
})
