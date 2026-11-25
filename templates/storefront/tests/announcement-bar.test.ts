// Storeplate's announcement bar, rendered from its real section file: one message per block, arrows and a pause button
// only when they have something to do, and the old single-message setting while there are no blocks.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const dir = new URL('../themes/storeplate', import.meta.url).pathname

const block = (id: string, text: string, link = ''): SectionObject['blocks'][number] => ({
  id,
  type: 'announcement',
  settings: { text, link },
  shopify_attributes: new SafeHtml(`data-block-id="${id}"`),
})

function bar(blocks: SectionObject['blocks'], settings: Record<string, unknown> = {}): SectionObject {
  return {
    id: 'announcement-bar',
    type: 'announcement-bar',
    settings: { auto_rotate: false, speed: 5, ...settings },
    blocks,
    block_order: blocks.map((b) => b.id),
  }
}

/** The bar as the layout renders it, with the theme's own settings (the old single message lives there) */
function render(section: SectionObject, themeSettings: Record<string, unknown> = {}) {
  const liquid = createLiquid('storeplate', dir)
  const data: RenderData = { sections: () => [], section: () => section }
  return liquid.parseAndRender(
    "{% section 'announcement-bar' %}",
    {},
    { globals: { [RENDER]: data, settings: themeSettings } },
  )
}

describe('with announcements', () => {
  test('one shows as it is: no arrows, no carousel', async () => {
    const html = await render(bar([block('a', 'Free <b>delivery</b>', '/collections/all')]))
    assert.match(html, /data-block-id="a"/)
    assert.match(html, /<a href="\/collections\/all"[^>]*>Free &lt;b&gt;delivery&lt;\/b&gt;<\/a>/)
    assert.doesNotMatch(html, /data-announcement-prev|data-announcement-next|aria-roledescription/)
  })

  test('several are slides with arrows, the first visible and the rest hidden; a blank one is skipped', async () => {
    const html = await render(bar([block('a', 'One'), block('b', ''), block('c', 'Two'), block('d', 'Three')]))
    assert.match(html, /data-announcement-prev/)
    assert.match(html, /data-announcement-next/)
    assert.match(html, /aria-roledescription="carousel"/)
    assert.equal([...html.matchAll(/data-announcement-slide/g)].length, 3)
    assert.equal([...html.matchAll(/data-announcement-slide hidden/g)].length, 2)
    assert.doesNotMatch(html, /data-block-id="b"/)
  })

  test('the pause button is there only when the merchant turned rotation on', async () => {
    const blocks = [block('a', 'One'), block('b', 'Two')]
    assert.doesNotMatch(await render(bar(blocks)), /data-announcement-toggle/)
    const auto = await render(bar(blocks, { auto_rotate: true, speed: 8 }))
    assert.match(auto, /data-announcement-toggle/)
    assert.match(auto, /data-auto="true"/)
    assert.match(auto, /data-speed="8"/)
  })

  test('a single announcement has no pause button, whatever the setting', async () => {
    assert.doesNotMatch(await render(bar([block('a', 'One')], { auto_rotate: true })), /data-announcement-toggle/)
  })
})

describe('without announcements', () => {
  test('nothing shows', async () => {
    assert.equal((await render(bar([]))).replace(/<[^>]*>|\s/g, ''), '')
    assert.equal((await render(bar([block('a', '  ')]))).replace(/<[^>]*>|\s/g, ''), '')
  })

  test('the old single message (theme settings) shows while there are no blocks', async () => {
    const html = await render(bar([]), { announcement_text: 'Welcome back', announcement_link: '/search' })
    assert.match(html, /<a href="\/search"[^>]*>Welcome back<\/a>/)
    assert.doesNotMatch(html, /data-announcement-prev/)
  })

  test('blocks win over the old message', async () => {
    const html = await render(bar([block('a', 'New one')]), { announcement_text: 'Old one' })
    assert.match(html, /New one/)
    assert.doesNotMatch(html, /Old one/)
  })
})
