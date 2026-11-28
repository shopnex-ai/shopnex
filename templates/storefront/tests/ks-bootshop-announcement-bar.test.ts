// KS BootShop's announcement bar, rendered from its real section file: one message per block (a Bootstrap carousel
// when there are several), and the old single-message setting while there are no blocks.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const dir = new URL('../themes/ks-bootshop', import.meta.url).pathname

const block = (id: string, text: string, link = ''): SectionObject['blocks'][number] => ({
  id,
  type: 'announcement',
  settings: { text, link },
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
  const liquid = createLiquid('ks-bootshop', dir)
  const data: RenderData = { sections: () => [], section: () => section }
  return liquid.parseAndRender(
    "{% section 'announcement-bar' %}",
    {},
    { globals: { [RENDER]: data, settings: themeSettings } },
  )
}

describe('KS BootShop announcement bar', () => {
  test('one announcement shows as it is, with its link and no carousel', async () => {
    const html = await render(bar([block('a', 'Free <b>delivery</b>', '/collections/all')]))
    assert.match(html, /data-block-id="a"/)
    assert.match(html, /<a href="\/collections\/all">Free &lt;b&gt;delivery&lt;\/b&gt;<\/a>/)
    assert.doesNotMatch(html, /carousel/)
  })

  test('several are a carousel with the first one active; a blank one is skipped', async () => {
    const html = await render(bar([block('a', 'One'), block('b', ''), block('c', 'Two')]))
    assert.match(html, /data-bs-ride="carousel"/)
    assert.match(html, /data-bs-interval="5000"/)
    assert.equal([...html.matchAll(/carousel-item/g)].length, 2)
    assert.equal([...html.matchAll(/carousel-item active/g)].length, 1)
    assert.doesNotMatch(html, /data-block-id="b"/)
  })

  test('nothing shows without announcements, or with only blank ones', async () => {
    for (const html of [await render(bar([])), await render(bar([block('a', '  ')]))]) {
      assert.doesNotMatch(html, /ks-announcement/)
    }
  })

})
