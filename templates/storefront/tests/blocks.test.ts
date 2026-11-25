// Sections with blocks, and the Shopify tags around them: `section.blocks`, `block.shopify_attributes`, `{% section %}`,
// `{% schema %}`. A section written for Shopify renders as it is.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const dir = new URL('../themes/storeplate', import.meta.url).pathname

const announcement = `
<div {% for block in section.blocks %}{% endfor %}>
  {%- for block in section.blocks -%}
    <p {{ block.shopify_attributes }} data-type="{{ block.type }}">{{ block.settings.text }}</p>
  {%- endfor -%}
  <i>{{ section.blocks.size }} of {{ section.block_order.size }}</i>
</div>
{% schema %}
{ "name": "Announcement bar", "blocks": [{ "type": "announcement", "settings": [{ "id": "text", "type": "text", "label": "{{ not a tag }}" }] }] }
{% endschema %}
`

const section = (over: Partial<SectionObject> = {}): SectionObject => ({
  id: 'bar',
  type: 'announcement-bar',
  settings: {},
  blocks: [
    {
      id: 'b1',
      type: 'announcement',
      settings: { text: 'Free <shipping>' },
      shopify_attributes: new SafeHtml('data-block-id="b1"'),
    },
    {
      id: 'b2',
      type: 'announcement',
      settings: { text: 'Sale' },
      shopify_attributes: new SafeHtml('data-block-id="b2"'),
    },
  ],
  block_order: ['b1', 'b2'],
  ...over,
})

function render(template: string, data: Partial<RenderData>) {
  const liquid = createLiquid('storeplate', dir, { 'sections/announcement-bar.liquid': announcement })
  const renderData: RenderData = { sections: () => [], section: () => null, ...data }
  return liquid.parseAndRender(template, {}, { globals: { [RENDER]: renderData } })
}

describe('blocks in a section', () => {
  test('a section loops over its blocks, with their settings (escaped) and the attributes the editor looks for', async () => {
    const html = await render("{% sections 'home' %}", { sections: () => [section()] })
    assert.match(html, /<div data-section-id="bar">/)
    assert.match(html, /<p data-block-id="b1" data-type="announcement">Free &lt;shipping&gt;<\/p>/)
    assert.match(html, /<p data-block-id="b2" data-type="announcement">Sale<\/p>/)
    assert.match(html, /<i>2 of 2<\/i>/)
  })

  test('the schema tag is skipped, including what looks like Liquid inside it', async () => {
    const html = await render("{% sections 'home' %}", { sections: () => [section()] })
    assert.doesNotMatch(html, /Announcement bar|not a tag/)
  })

  test('a section without blocks has an empty list', async () => {
    const html = await render("{% sections 'home' %}", { sections: () => [section({ blocks: [], block_order: [] })] })
    assert.match(html, /<i>0 of 0<\/i>/)
  })
})

describe('{% section %}', () => {
  test('renders one global section by name', async () => {
    const html = await render("before {% section 'announcement-bar' %} after", { section: () => section() })
    assert.match(html, /^before <div data-section-id="bar">/)
    assert.match(html, /<\/div> after$/)
  })

  test('renders nothing for a section the theme does not have', async () => {
    assert.equal(await render("a{% section 'nope' %}b", {}), 'ab')
  })

  test('needs a name', async () => {
    await assert.rejects(render('{% section %}', {}), /needs a section name/)
  })
})
