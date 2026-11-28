// Tags and filters from Shopify's Liquid that themes written for it use (src/core/liquid-compat.ts), and the colour maths.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { brightness, parseColor, shiftLightness } from '../src/core/color'
import { ImageDrop, MoneyDrop } from '../src/core/drops'
import { createLiquid } from '../src/core/liquid'

const dir = mkdtempSync(join(tmpdir(), 'liquid-compat-'))
mkdirSync(join(dir, 'assets'))
writeFileSync(join(dir, 'assets', 'icon.svg'), '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')
writeFileSync(join(dir, 'assets', 'big.css'), 'a{}'.repeat(100_000))
writeFileSync(join(dir, 'assets', 'photo.png'), 'not text')
writeFileSync(join(dir, 'secret.txt'), 'outside assets')
symlinkSync(join(dir, 'secret.txt'), join(dir, 'assets', 'link.txt'))
after(() => rmSync(dir, { recursive: true, force: true }))

const render = (template: string, data: Record<string, unknown> = {}) =>
  createLiquid('compat', dir).parseAndRender(template, data)

describe('{% doc %}', () => {
  test('is skipped, with the tags and output inside it', async () => {
    assert.equal(await render('a{% doc %}@param {string} x {% render "nope" %} {{ not.run }} {% enddoc %}b'), 'ab')
  })
  test('an unclosed one is an error', async () => {
    await assert.rejects(render('{% doc %} never closed'), /not closed/)
  })
})

describe('{% style %}', () => {
  test('wraps its contents in <style>, and runs Liquid in them', async () => {
    assert.equal(
      await render('{% style %}.a { color: {{ color }}; }{% endstyle %}', { color: '#fff' }),
      '<style>.a { color: #fff; }</style>',
    )
  })
  test('output stays escaped, so a value cannot close the element', async () => {
    const out = await render('{% style %}.a { content: "{{ v }}" }{% endstyle %}', { v: '</style><script>x</script>' })
    assert.ok(!out.includes('</style><script>'))
  })
})

describe('{% stylesheet %} and {% javascript %}', () => {
  test('are written as they are, with no Liquid run in them', async () => {
    assert.equal(
      await render('{% stylesheet %}.a::after { content: "{{ x }}" }{% endstylesheet %}'),
      '<style>.a::after { content: "{{ x }}" }</style>',
    )
    assert.equal(
      await render('{% javascript %}if (a < b) run("{{ x }}")\n{% endjavascript %}'),
      '<script>if (a < b) run("{{ x }}")\n</script>',
    )
  })
  test('the same one is written once, however many times it renders', async () => {
    const out = await render(
      '{% for i in (1..3) %}{% render "x" %}{% endfor %}'.replace(
        '{% render "x" %}',
        '{% stylesheet %}.a{}{% endstylesheet %}',
      ),
    )
    assert.equal(out, '<style>.a{}</style>')
  })
})

describe('inline_asset_content', () => {
  test('writes a text file from assets/ unescaped', async () => {
    assert.equal(
      await render("{{ 'icon.svg' | inline_asset_content }}"),
      '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>',
    )
  })
  test('gives nothing for a missing file, another kind of file, a big file, a path out of assets/ or a link out of it', async () => {
    for (const name of ['nope.svg', 'photo.png', 'big.css', '../secret.txt', '../../etc/passwd', 'link.txt'])
      assert.equal(await render('{{ name | inline_asset_content }}', { name }), '', name)
  })
})

describe('image_tag', () => {
  test('makes an <img> from a URL, with keyword arguments as attributes, escaped', async () => {
    assert.equal(
      await render(
        "{{ url | image_tag: alt: 'A \"shoe\"', class: 'hero', loading: 'lazy', width: 300, height: 200 }}",
        { url: '/a.png' },
      ),
      '<img src="/a.png" alt="A &#34;shoe&#34;" class="hero" loading="lazy" width="300" height="200">',
    )
  })
  test('from an image: its alt text, and the other side of the size from its proportions', async () => {
    const photo = new ImageDrop({ id: 'i', url: '/p.jpg', altText: 'Sneaker', width: 400, height: 200 })
    assert.equal(
      await render('{{ photo | image_tag }}', { photo }),
      '<img src="/p.jpg" alt="Sneaker" width="400" height="200">',
    )
    assert.equal(
      await render('{{ photo | image_tag: width: 100 }}', { photo }),
      '<img src="/p.jpg" alt="Sneaker" width="100" height="50">',
    )
  })
  test('leaves out widths, event handlers and names that are not attribute names; no URL, nothing', async () => {
    const out = await render("{{ '/a.png' | image_tag: widths: '100, 200', onerror: 'x()', 'bad name': 1 }}")
    assert.equal(out, '<img src="/a.png" alt="">')
    assert.equal(await render("{{ '' | image_tag }}"), '')
  })
})

describe('placeholder_svg_tag, time_tag and link_to', () => {
  test('placeholder_svg_tag is an <svg> with the class', async () => {
    const out = await render("{{ 'product-1' | placeholder_svg_tag: 'ph \"x' }}")
    assert.match(out, /^<svg class="ph &#34;x" /)
  })
  test('time_tag is a <time> with the machine date and the formatted one', async () => {
    assert.equal(
      await render("{{ at | time_tag: '%B %d, %Y' }}", { at: new Date('2024-03-05T10:00:00Z') }),
      '<time datetime="2024-03-05T10:00:00.000Z">March 05, 2024</time>',
    )
    assert.equal(await render("{{ 'x' | time_tag }}"), '')
  })
  test('link_to makes an <a>, escaping the text and the attributes', async () => {
    assert.equal(
      await render("{{ '<b>' | link_to: '/p?a=1&b=2', title: 'T\"' }}"),
      '<a href="/p?a=1&amp;b=2" title="T&#34;">&lt;b&gt;</a>',
    )
  })
})

describe('money_without_trailing_zeros', () => {
  const globals = { shop: { language: 'en' } }
  test('drops .00 and keeps other decimals', async () => {
    const out = (minor: number) =>
      render('{{ p | money_without_trailing_zeros }}', {
        ...globals,
        p: new MoneyDrop({ amountMinor: minor, currencyCode: 'USD' }),
      })
    assert.equal(await out(1000), '$10')
    assert.equal(await out(1050), '$10.50')
    assert.equal(await out(100000), '$1,000')
  })
})

describe('colour filters', () => {
  test('color_lighten and color_darken keep the notation', async () => {
    assert.equal(await render("{{ '#336699' | color_lighten: 20 }}"), '#6699cc')
    assert.equal(await render("{{ '#336699' | color_darken: 20 }}"), '#1a334d')
    assert.equal(await render("{{ 'rgb(51, 102, 153)' | color_lighten: 20 }}"), 'rgb(102, 153, 204)')
    assert.equal(await render("{{ 'rgba(51, 102, 153, 0.5)' | color_darken: 20 }}"), 'rgba(26, 51, 77, 0.5)')
  })
  test('lightness stops at white and black', () => {
    assert.equal(shiftLightness('#336699', 100), '#ffffff')
    assert.equal(shiftLightness('#336699', -100), '#000000')
  })
  test('color_brightness is 0 to 255', async () => {
    assert.equal(await render("{{ '#ffffff' | color_brightness }}"), '255')
    assert.equal(await render("{{ '#000' | color_brightness }}"), '0')
    assert.equal(brightness('#336699'), (51 * 299 + 102 * 587 + 153 * 114) / 1000)
  })
  test('something that is not a colour comes back unchanged (brightness 0)', async () => {
    assert.equal(await render("{{ 'teal' | color_lighten: 10 }}"), 'teal')
    assert.equal(parseColor('rgb(300, 0, 0)'), null)
    assert.equal(brightness('nope'), 0)
  })
})
