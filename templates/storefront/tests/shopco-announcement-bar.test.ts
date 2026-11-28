// Shopco's announcement bar, rendered from its real section file: one message per block (a Bootstrap carousel
// when there are several), and the old single-message setting while there are no blocks.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const dir = new URL('../themes/shopco', import.meta.url).pathname

const block = (id: string, text: string, link = '', link_label = ''): SectionObject['blocks'][number] => ({
  id,
  type: 'announcement',
  settings: { text, link, link_label },
  shopify_attributes: new SafeHtml(`data-block-id="${id}"`),
})

const bar = (blocks: SectionObject['blocks']): SectionObject => ({
  id: 'announcement-bar',
  type: 'announcement-bar',
  settings: { speed: 5 },
  blocks,
  block_order: blocks.map((b) => b.id),
})

function render(section: SectionObject, themeSettings: Record<string, unknown> = {}) {
  const liquid = createLiquid('shopco', dir)
  const data: RenderData = { sections: () => [], section: () => section }
  return liquid.parseAndRender(
    "{% section 'announcement-bar' %}",
    {},
    { globals: { [RENDER]: data, settings: themeSettings } },
  )
}

describe('Shopco announcement bar', () => {
  test('one announcement shows with its link label and link, closable, no carousel', async () => {
    const html = await render(bar([block('a', 'Free delivery', '/collections/all', 'Shop now')]))
    assert.match(html, /data-block-id="a"/)
    assert.match(html, /data-announcement="free-delivery"/)
    assert.match(html, /<a href="\/collections\/all"[^>]*>Shop now<\/a>/)
    assert.match(html, /data-announcement-close/)
    assert.doesNotMatch(html, /aria-roledescription/)
  })

  test('several are slides, the first visible and the rest hidden; a blank one is skipped', async () => {
    const html = await render(bar([block('a', 'One'), block('b', ''), block('c', 'Two')]))
    assert.match(html, /aria-roledescription="carousel"/)
    assert.match(html, /data-speed="5"/)
    assert.equal([...html.matchAll(/data-announcement-slide/g)].length, 2)
    assert.equal([...html.matchAll(/data-announcement-slide hidden/g)].length, 1)
    assert.doesNotMatch(html, /data-block-id="b"/)
  })

  test('nothing shows without announcements', async () => {
    for (const html of [await render(bar([])), await render(bar([block('a', '  ')]))]) {
      assert.doesNotMatch(html, /data-announcement/)
    }
  })
})
