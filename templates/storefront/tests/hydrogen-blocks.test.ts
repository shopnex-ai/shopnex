// Hydrogen's collection list and footer, rendered from their real files: a card or a column per block.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const dir = new URL('../themes/hydrogen', import.meta.url).pathname

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

const collections = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'].map((title, i) => ({
  url: `/collections/c${i}`,
  title,
  image: null,
}))
const linklists = {
  footer: { links: [{ url: '/pages/about', title: 'About', links: [] }] },
  help: { links: [{ url: '/pages/faq', title: 'FAQ' }] },
}

function render(s: SectionObject, themeSettings: Record<string, unknown> = {}, template = "{% sections 'home' %}") {
  const liquid = createLiquid('hydrogen', dir)
  const data: RenderData = { sections: () => [s], section: () => s }
  return liquid.parseAndRender(
    template,
    {},
    { globals: { [RENDER]: data, collections, settings: themeSettings, shop: { name: 'Demo' }, linklists } },
  )
}

describe('collection list', () => {
  const settings = { heading: 'Collections', columns: 3 }

  test('a card per block with a collection, in the merchant’s order, with the block’s attributes', async () => {
    const html = await render(
      section('collection-list', settings, [
        block('a', 'collection', { collection: collections[2] }),
        block('b', 'collection', { collection: null }),
        block('c', 'collection', { collection: collections[0] }),
      ]),
    )
    assert.match(html, /<div data-block-id="a" class="relative">/)
    assert.ok(html.indexOf('Gamma') < html.indexOf('Alpha'))
    assert.doesNotMatch(html, /data-block-id="b"|Beta/)
  })

  test('until a block has a collection, the shop’s first six', async () => {
    const html = await render(section('collection-list', settings))
    assert.equal([...html.matchAll(/class="relative"/g)].length, 6)
    assert.doesNotMatch(html, /Eta|data-block-id/)
  })
})

describe('footer', () => {
  const footer = (blocks: SectionObject['blocks'] = [], themeSettings: Record<string, unknown> = {}) =>
    render(
      section('footer', {}, blocks),
      { instagram_url: 'https://ig.test/x', ...themeSettings },
      "{% section 'footer' %}",
    )

  test('without blocks the columns come from the "footer" menu, with the social links', async () => {
    const html = await footer()
    assert.match(html, /<a href="\/pages\/about">About<\/a>/)
    assert.match(html, /aria-label="Instagram"/)
    assert.doesNotMatch(html, /data-block-id/)
  })

  test('with blocks: a column per text or menu block, and the social links where their block is', async () => {
    const html = await footer([
      block('t', 'text', { heading: 'Visit', text: 'Open <b>daily</b>' }),
      block('m', 'menu', { heading: 'Help', menu: 'help' }),
      block('s', 'social', {}),
    ])
    assert.match(html, /<section data-block-id="t"/)
    assert.match(html, /Open &lt;b&gt;daily&lt;\/b&gt;/)
    assert.match(html, /<section data-block-id="m"/)
    assert.match(html, /<a href="\/pages\/faq">FAQ<\/a>/)
    assert.match(html, /<div data-block-id="s"[^>]*>[\s\S]*aria-label="Instagram"/)
    assert.doesNotMatch(html, /About<\/a>/) // the "footer" menu is not picked by a block
  })

  test('with blocks but no social block there are no social links; the copyright stays', async () => {
    const html = await footer([block('t', 'text', { heading: 'Visit', text: 'Hi' })], { copyright: 'All rights' })
    assert.doesNotMatch(html, /aria-label="Instagram"/)
    assert.match(html, /All rights/)
  })
})
