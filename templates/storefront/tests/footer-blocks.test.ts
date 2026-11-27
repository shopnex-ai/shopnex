// Maison's and Storeplate's footers, rendered from their real files: the single bar while there are no blocks, and a
// column per block (a text, a menu, the social links; Storeplate also the logo) with the copyright under them.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const block = (id: string, type: string, settings: Record<string, unknown> = {}): SectionObject['blocks'][number] => ({
  id,
  type,
  settings,
  shopify_attributes: new SafeHtml(`data-block-id="${id}"`),
})

const section = (blocks: SectionObject['blocks'] = []): SectionObject => ({
  id: 'footer',
  type: 'footer',
  settings: {},
  blocks,
  block_order: blocks.map((b) => b.id),
})

const linklists = {
  footer: { links: [{ url: '/pages/about', title: 'About', links: [] }] },
  help: { links: [{ url: '/pages/faq', title: 'FAQ' }] },
}

function render(theme: string, s: SectionObject, themeSettings: Record<string, unknown> = {}) {
  const liquid = createLiquid(theme, new URL(`../themes/${theme}`, import.meta.url).pathname)
  const data: RenderData = { sections: () => [], section: () => s }
  return liquid.parseAndRender(
    "{% section 'footer' %}",
    {},
    {
      globals: {
        [RENDER]: data,
        settings: { instagram_url: 'https://ig.test/x', footer_text: 'All rights', ...themeSettings },
        shop: { name: 'Demo' },
        linklists,
      },
    },
  )
}

for (const theme of ['maison', 'storeplate']) {
  describe(`${theme} footer`, () => {
    test('without blocks it is the single bar: the "footer" menu, the social links and the copyright', async () => {
      const html = await render(theme, section())
      assert.match(html, /<a href="\/pages\/about"[^>]*>About<\/a>/)
      assert.match(html, /aria-label="Instagram"/)
      assert.match(html, /All rights/)
      assert.doesNotMatch(html, /data-block-id|--footer-columns/)
    })

    test('with blocks: a column per block, then the copyright', async () => {
      const html = await render(
        theme,
        section([
          block('t', 'text', { heading: 'Visit', text: 'Open <b>daily</b>' }),
          block('m', 'menu', { heading: 'Help', menu: 'help' }),
          block('s', 'social', { heading: 'Follow us' }),
        ]),
      )
      assert.match(html, /--footer-columns: 3/)
      assert.match(html, /<div data-block-id="t"/)
      assert.match(html, />Visit</)
      assert.match(html, /Open &lt;b&gt;daily&lt;\/b&gt;/)
      assert.match(html, /<a href="\/pages\/faq"[^>]*>FAQ<\/a>/)
      assert.match(html, /<div data-block-id="s"[\s\S]*aria-label="Instagram"/)
      assert.doesNotMatch(html, />About<\/a>/) // the "footer" menu is not picked by a block
      assert.ok(html.lastIndexOf('All rights') > html.indexOf('Follow us'))
    })

    test('more than four blocks stay in four columns; a menu that does not exist shows only its heading', async () => {
      const blocks = [1, 2, 3, 4, 5].map((i) => block(`t${i}`, 'text', { heading: `H${i}` }))
      assert.match(await render(theme, section(blocks)), /--footer-columns: 4/)
      const gone = await render(theme, section([block('m', 'menu', { heading: 'Gone', menu: 'nope' })]))
      assert.match(gone, />Gone</)
      assert.doesNotMatch(gone, /<a href/)
    })
  })
}

describe('storeplate footer logo block', () => {
  test('shows the shop’s name or logo', async () => {
    const html = await render('storeplate', section([block('l', 'logo')]))
    assert.match(html, /<div data-block-id="l"/)
    assert.match(html, /Demo/)
  })
})
