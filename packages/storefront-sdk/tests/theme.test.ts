// Blocks in the theme format: what a section type declares, what a document stores, and what a theme gets to render.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ThemeDefinition,
  ThemeDocument,
  applyPreset,
  blocksFromSettings,
  defaultDocument,
  resolveBlocks,
  resolveDocument,
  resolveGlobalSections,
  withoutCodeSettings,
  type ThemeDefinitionInput,
} from '../src/theme'

const input: ThemeDefinitionInput = {
  id: 'test',
  name: 'Test',
  sections: {
    'announcement-bar': {
      name: 'Announcement bar',
      max_blocks: 3,
      settings: [{ id: 'speed', label: 'Speed', type: 'range', min: 3, max: 10, step: 1, default: 5 }],
      blocks: {
        announcement: {
          name: 'Announcement',
          settings: [
            { id: 'text', label: 'Text', type: 'text', default: 'Hello' },
            { id: 'link', label: 'Link', type: 'url' },
          ],
        },
        promo: {
          name: 'Promo',
          limit: 1,
          settings: [
            { id: 'text', label: 'Text', type: 'text' },
            { id: 'css', label: 'CSS', type: 'code', language: 'css' },
          ],
        },
      },
    },
    plain: { name: 'Plain', settings: [] },
  },
  pages: {
    static: {
      name: 'Global sections',
      sections: [
        {
          id: 'bar',
          type: 'announcement-bar',
          settings: {},
          blocks: [{ id: 'a1', type: 'announcement', settings: { text: 'Free shipping' } }],
        },
      ],
    },
  },
}
const definition = ThemeDefinition.parse(input)
const bar = definition.sections['announcement-bar']!
const block = (id: string, type: string, settings = {}, disabled?: boolean) => ({
  id,
  type,
  settings,
  ...(disabled && { disabled }),
})

describe('the definition', () => {
  test('a section type without blocks has none', () => {
    assert.deepEqual(definition.sections.plain!.blocks, {})
    assert.equal(definition.sections.plain!.max_blocks, undefined)
  })

  test('a section type declares block types with their own settings, a limit and max_blocks', () => {
    assert.deepEqual(Object.keys(bar.blocks), ['announcement', 'promo'])
    assert.equal(bar.max_blocks, 3)
    assert.equal(bar.blocks.promo!.limit, 1)
  })

  test('rejects a block type id that is not a lowercase id', () => {
    const bad = { ...input, sections: { x: { name: 'X', blocks: { 'Not Ok': { name: 'N' } } } } }
    assert.equal(ThemeDefinition.safeParse(bad).success, false)
  })

  test('default sections keep their blocks', () => {
    const doc = defaultDocument(definition)
    assert.deepEqual(doc.pages.static!.sections[0]!.blocks, [
      { id: 'a1', type: 'announcement', settings: { text: 'Free shipping' } },
    ])
  })
})

describe('a stored document', () => {
  test('keeps blocks (validation does not strip them)', () => {
    const doc = ThemeDocument.parse(defaultDocument(definition))
    assert.equal(doc.pages.static!.sections[0]!.blocks?.[0]?.id, 'a1')
  })

  test('refuses more blocks than any section can hold', () => {
    const many = Array.from({ length: 51 }, (_, i) => block(`b${i}`, 'announcement'))
    const doc = {
      settings: {},
      pages: { static: { sections: [{ id: 's', type: 'announcement-bar', settings: {}, blocks: many }] } },
    }
    assert.equal(ThemeDocument.safeParse(doc).success, false)
  })
})

describe('resolveBlocks', () => {
  test('fills every setting from its default and drops keys the block type does not have', () => {
    const [first] = resolveBlocks(bar, [block('a', 'announcement', { text: 'Sale', stale: 'x' })])
    assert.deepEqual(first!.settings, { text: 'Sale', link: '' })
    const [second] = resolveBlocks(bar, [block('b', 'announcement')])
    assert.equal(second!.settings.text, 'Hello')
  })

  test('skips blocks of a type the section no longer has', () => {
    const resolved = resolveBlocks(bar, [block('a', 'announcement'), block('b', 'gone'), block('c', 'announcement')])
    assert.deepEqual(
      resolved.map((b) => b.id),
      ['a', 'c'],
    )
  })

  test('keeps the order and the hidden ones (the editor lists them; the storefront filters them)', () => {
    const resolved = resolveBlocks(bar, [block('a', 'announcement', {}, true), block('b', 'announcement')])
    assert.deepEqual(
      resolved.map((b) => [b.id, b.disabled]),
      [
        ['a', true],
        ['b', undefined],
      ],
    )
  })

  test('stops at max_blocks and at a type`s limit', () => {
    const four = ['a', 'b', 'c', 'd'].map((id) => block(id, 'announcement'))
    assert.deepEqual(
      resolveBlocks(bar, four).map((b) => b.id),
      ['a', 'b', 'c'],
    )
    const promos = [block('p1', 'promo'), block('p2', 'promo'), block('a', 'announcement')]
    assert.deepEqual(
      resolveBlocks(bar, promos).map((b) => b.id),
      ['p1', 'a'],
    )
  })

  test('a section with no blocks, or none stored, gives an empty list', () => {
    assert.deepEqual(resolveBlocks(bar), [])
    assert.deepEqual(resolveBlocks(definition.sections.plain!, [block('a', 'announcement')]), [])
  })
})

describe('a style or document from someone else', () => {
  test('keeps blocks the definition knows, minus code settings, and drops the others', () => {
    const doc = {
      settings: {},
      pages: {
        static: {
          sections: [
            {
              id: 'bar',
              type: 'announcement-bar',
              settings: {},
              blocks: [
                block('a', 'announcement', { text: 'Hi', evil: 'x' }),
                block('p', 'promo', { text: 'Promo', css: 'body{display:none}' }),
                block('g', 'gone', { text: 'x' }),
              ],
            },
          ],
        },
      },
    }
    const safe = withoutCodeSettings(definition, doc)
    const blocks = safe.pages.static!.sections[0]!.blocks!
    assert.deepEqual(
      blocks.map((b) => b.id),
      ['a', 'p'],
    )
    assert.deepEqual(blocks[0]!.settings, { text: 'Hi' })
    assert.deepEqual(blocks[1]!.settings, { text: 'Promo' })
  })

  test('a section without blocks stays without a blocks key', () => {
    const doc = { settings: {}, pages: { static: { sections: [{ id: 'p', type: 'plain', settings: {} }] } } }
    assert.equal('blocks' in withoutCodeSettings(definition, doc).pages.static!.sections[0]!, false)
  })
})

describe('applyPreset: a style changes the settings styles set, and keeps the merchant’s others', () => {
  const definition = ThemeDefinition.parse({
    id: 'test',
    name: 'Test',
    settings: [
      { id: 'logo', label: 'Logo', type: 'image' },
      { id: 'announcement', label: 'Announcement', type: 'text' },
      { id: 'custom_css', label: 'CSS', type: 'code', language: 'css' },
      { id: 'accent', label: 'Accent', type: 'color', default: '#111111' },
      { id: 'font', label: 'Font', type: 'text', default: 'Inter' },
    ],
    sections: {},
    pages: { home: { name: 'Home', sections: [] } },
    presets: {
      warm: { name: 'Warm', settings: { accent: '#aa5500', font: 'Lora' } },
      cool: { name: 'Cool', settings: { accent: '#0055aa' } },
    },
  })
  const document: ThemeDocument = {
    preset: 'warm',
    settings: { logo: '/logo.png', announcement: 'Free delivery', custom_css: 'a{}', accent: '#aa5500', font: 'Lora' },
    pages: { home: { sections: [{ id: 'hero', type: 'hero', settings: {} }] } },
  }

  test('the other settings (logo, announcement, custom code) are kept', () => {
    const next = applyPreset(definition, document, 'cool')
    assert.equal(next.settings.logo, '/logo.png')
    assert.equal(next.settings.announcement, 'Free delivery')
    assert.equal(next.settings.custom_css, 'a{}')
    assert.equal(next.preset, 'cool')
  })

  test('the style’s settings come from it, and one it leaves out goes back to the default (nothing of the last style stays)', () => {
    const next = applyPreset(definition, document, 'cool')
    assert.equal(next.settings.accent, '#0055aa')
    assert.equal(next.settings.font, 'Inter') // "warm" set Lora; "cool" says nothing about it
  })

  test('null is the theme’s own look: the styles’ settings back to the defaults, the others kept, no preset', () => {
    const next = applyPreset(definition, document, null)
    assert.deepEqual(next.settings, {
      logo: '/logo.png',
      announcement: 'Free delivery',
      custom_css: 'a{}',
      accent: '#111111',
      font: 'Inter',
    })
    assert.equal('preset' in next, false)
  })

  test('the merchant’s sections stay; an unknown style is refused', () => {
    assert.deepEqual(applyPreset(definition, document, 'cool').pages, document.pages)
    assert.throws(() => applyPreset(definition, document, 'nope'), /Unknown preset/)
  })
})

describe('resolveGlobalSections', () => {
  const withGlobals = ThemeDefinition.parse({
    id: 'globals',
    name: 'Globals',
    sections: {
      'announcement-bar': { name: 'Announcement bar' },
      menu: { name: 'Menu' },
      footer: { name: 'Footer', group: 'footer' },
    },
    pages: {
      home: { name: 'Home', sections: [] },
      static: {
        name: 'Global sections',
        sections: [
          { id: 'announcement-bar', type: 'announcement-bar', settings: {} },
          { id: 'menu', type: 'menu', settings: {} },
          { id: 'footer', type: 'footer', settings: {}, blocks: [] },
        ],
      },
    },
  })
  const theirs = withGlobals.pages.static!.sections
  const saved = (id: string, type = id, extra = {}) => ({ id, type, settings: { saved: true }, ...extra })
  const ids = (sections: { id: string }[]) => sections.map((s) => s.id)

  test("a merchant who never saved any gets the theme's own", () => {
    assert.deepEqual(resolveGlobalSections(withGlobals), theirs)
  })

  test('a section the theme has and the saved list lacks is added with the theme defaults, after its predecessor', () => {
    const stored = [saved('announcement-bar'), saved('menu')]
    const result = resolveGlobalSections(withGlobals, stored)
    assert.deepEqual(ids(result), ['announcement-bar', 'menu', 'footer'])
    assert.deepEqual(result[2], theirs[2])
  })

  test('one missing at the start or in the middle is put where the theme has it', () => {
    assert.deepEqual(ids(resolveGlobalSections(withGlobals, [saved('menu'), saved('footer')])), [
      'announcement-bar',
      'menu',
      'footer',
    ])
    assert.deepEqual(ids(resolveGlobalSections(withGlobals, [saved('announcement-bar'), saved('footer')])), [
      'announcement-bar',
      'menu',
      'footer',
    ])
  })

  test("the merchant's sections are kept as saved: order, settings, blocks and hidden", () => {
    const stored = [
      saved('footer', 'footer', { disabled: true, blocks: [{ id: 'b1', type: 'text', settings: {} }] }),
      saved('announcement-bar'),
      saved('menu'),
    ]
    const result = resolveGlobalSections(withGlobals, stored)
    assert.deepEqual(result, stored)
    assert.equal(result[0], stored[0]) // untouched, not copied
  })

  test("a section the merchant added of the theme's type covers it: no duplicate", () => {
    const stored = [saved('announcement-bar'), saved('menu'), saved('s9f3a2', 'footer')]
    assert.deepEqual(ids(resolveGlobalSections(withGlobals, stored)), ['announcement-bar', 'menu', 's9f3a2'])
  })

  test('a section of a type the theme does not list is left alone', () => {
    const stored = [saved('old', 'removed-type'), saved('announcement-bar'), saved('menu'), saved('footer')]
    assert.deepEqual(ids(resolveGlobalSections(withGlobals, stored)), ['old', 'announcement-bar', 'menu', 'footer'])
  })

  test('resolving again changes nothing', () => {
    const once = resolveGlobalSections(withGlobals, [saved('announcement-bar')])
    assert.deepEqual(resolveGlobalSections(withGlobals, once), once)
  })

  test('does not change the list it is given', () => {
    const stored = [saved('announcement-bar')]
    resolveGlobalSections(withGlobals, stored)
    assert.deepEqual(ids(stored), ['announcement-bar'])
  })

  describe('resolveDocument', () => {
    const document = {
      settings: { color: '#fff' },
      pages: {
        home: { sections: [saved('hero', 'announcement-bar')] },
        static: { sections: [saved('announcement-bar')] },
      },
    }

    test('completes the global sections and keeps everything else as saved', () => {
      const result = resolveDocument(withGlobals, document)
      assert.deepEqual(ids(result.pages.static!.sections), ['announcement-bar', 'menu', 'footer'])
      assert.deepEqual(result.settings, document.settings)
      assert.equal(result.pages.home, document.pages.home)
    })

    test("a document without a static page gets the theme's", () => {
      const result = resolveDocument(withGlobals, { settings: {}, pages: {} })
      assert.deepEqual(result.pages.static!.sections, theirs)
    })

    test('a theme without global sections returns the document as it is', () => {
      const without = ThemeDefinition.parse({
        id: 'x',
        name: 'X',
        sections: {},
        pages: { home: { name: 'Home', sections: [] } },
      })
      assert.equal(resolveDocument(without, document), document)
    })
  })
})

describe('blocksFromSettings: a section saved before it had blocks', () => {
  const slides = ThemeDefinition.parse({
    id: 'legacy',
    name: 'Legacy',
    sections: {
      hero: {
        name: 'Hero',
        max_blocks: 3,
        settings: [{ id: 'height', label: 'Height', type: 'text' }],
        blocks: {
          slide: {
            name: 'Slide',
            settings: [
              { id: 'image', label: 'Image', type: 'image' },
              { id: 'heading', label: 'Heading', type: 'text' },
            ],
            from_settings: { image: 'image_{n}', heading: 'heading_{n}' },
          },
        },
      },
      stats: {
        name: 'Stats',
        settings: [],
        blocks: {
          stat: {
            name: 'Stat',
            settings: [
              { id: 'value', label: 'Value', type: 'text' },
              { id: 'label', label: 'Label', type: 'text' },
            ],
            from_settings: { value: 'stat_{n}_value', label: 'stat_{n}_label' },
          },
        },
      },
      plain: { name: 'Plain', settings: [] },
    },
    pages: { home: { name: 'Home', sections: [] } },
  })
  const hero = (settings: Record<string, string>, blocks?: ThemeBlockValue[]) => ({
    id: 'h',
    type: 'hero',
    settings,
    ...(blocks && { blocks }),
  })
  type ThemeBlockValue = { id: string; type: string; settings: Record<string, string> }

  test('one block per numbered position that has something; the numbered settings are gone, the others stay', () => {
    const result = blocksFromSettings(
      slides.sections.hero,
      hero({ height: '60vh', image_1: '/a.jpg', heading_1: 'One', image_2: '/b.jpg', heading_2: '' }),
    )
    assert.deepEqual(result.settings, { height: '60vh' })
    assert.deepEqual(result.blocks, [
      { id: 'slide-1', type: 'slide', settings: { image: '/a.jpg', heading: 'One' } },
      { id: 'slide-2', type: 'slide', settings: { image: '/b.jpg' } },
    ])
  })

  test('a gap keeps the position in the id, and the order is the number', () => {
    const result = blocksFromSettings(slides.sections.hero, hero({ heading_3: 'Third', heading_1: 'First' }))
    assert.deepEqual(
      result.blocks!.map((b) => [b.id, b.settings.heading]),
      [
        ['slide-1', 'First'],
        ['slide-3', 'Third'],
      ],
    )
  })

  test('the position can be in the middle of the setting id', () => {
    const result = blocksFromSettings(slides.sections.stats, {
      id: 's',
      type: 'stats',
      settings: { stat_1_value: '200+', stat_1_label: 'Brands', stat_2_value: '30,000+' },
    })
    assert.deepEqual(result.blocks, [
      { id: 'stat-1', type: 'stat', settings: { value: '200+', label: 'Brands' } },
      { id: 'stat-2', type: 'stat', settings: { value: '30,000+' } },
    ])
    assert.deepEqual(result.settings, {})
  })

  test('a section that has blocks already is left as it is, old settings and all', () => {
    const section = hero({ image_1: '/old.jpg' }, [{ id: 'mine', type: 'slide', settings: {} }])
    assert.equal(blocksFromSettings(slides.sections.hero, section), section)
  })

  test('a list the merchant emptied stays empty: what they deleted does not come back', () => {
    const section = hero({ image_1: '/old.jpg' }, [])
    assert.equal(blocksFromSettings(slides.sections.hero, section), section)
  })

  test('a section with nothing in the numbered settings is left as it is', () => {
    const section = hero({ height: '60vh', image_1: '', heading_1: '  ' })
    assert.equal(blocksFromSettings(slides.sections.hero, section), section)
    assert.equal(
      blocksFromSettings(slides.sections.plain, { id: 'p', type: 'plain', settings: { image_1: 'x' } }).blocks,
      undefined,
    )
    assert.equal(blocksFromSettings(undefined, section), section)
  })

  test('stops at the most blocks the section holds', () => {
    const many = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`heading_${n}`, `H${n}`]))
    assert.equal(blocksFromSettings(slides.sections.hero, hero(many)).blocks!.length, 3)
  })

  test('running again changes nothing', () => {
    const once = blocksFromSettings(slides.sections.hero, hero({ image_1: '/a.jpg' }))
    assert.equal(blocksFromSettings(slides.sections.hero, once), once)
  })

  test('what it makes is a valid stored section', () => {
    const result = blocksFromSettings(slides.sections.hero, hero({ image_1: '/a.jpg', heading_2: 'Two' }))
    assert.equal(ThemeDocument.safeParse({ settings: {}, pages: { home: { sections: [result] } } }).success, true)
  })

  test('resolveDocument does it on every page, and returns the same page when there is nothing to do', () => {
    const document = {
      settings: {},
      pages: {
        home: { sections: [hero({ image_1: '/a.jpg' })] },
        other: { sections: [{ id: 'p', type: 'plain', settings: {} }] },
      },
    }
    const result = resolveDocument(slides, document)
    assert.equal(result.pages.home!.sections[0]!.blocks![0]!.id, 'slide-1')
    assert.equal(result.pages.other, document.pages.other)
    assert.deepEqual(resolveDocument(slides, result), result)
  })

  describe('the declaration', () => {
    const block = (from_settings: Record<string, string>) =>
      ThemeDefinition.safeParse({
        id: 'x',
        name: 'X',
        sections: {
          s: {
            name: 'S',
            blocks: { b: { name: 'B', settings: [{ id: 'image', label: 'I', type: 'text' }], from_settings } },
          },
        },
        pages: {},
      })

    test('names a setting of the block type and has {n} in the old id', () => {
      assert.equal(block({ image: 'image_{n}' }).success, true)
      assert.equal(block({ nope: 'image_{n}' }).success, false)
      assert.equal(block({ image: 'image_1' }).success, false)
      assert.equal(block({ image: 'Image {n}' }).success, false)
    })
  })
})
