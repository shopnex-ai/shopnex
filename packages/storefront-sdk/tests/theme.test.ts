// Blocks in the theme format: what a section type declares, what a document stores, and what a theme gets to render.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ThemeDefinition,
  ThemeDocument,
  defaultDocument,
  resolveBlocks,
  withDefaultBlocks,
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

describe('withDefaultBlocks: a section without stored blocks has its definition’s default ones', () => {
  const block = { id: 'slide-1', type: 'slide', settings: { heading: 'Hi' } }
  const definition = ThemeDefinition.parse({
    id: 'test',
    name: 'Test',
    sections: {
      hero: {
        name: 'Hero',
        blocks: { slide: { name: 'Slide', settings: [{ id: 'heading', label: 'Heading', type: 'text' }] } },
        default_blocks: [block],
      },
      plain: { name: 'Plain' },
    },
    pages: {},
  })

  test('no stored blocks (just added, or saved before blocks): the default ones', () => {
    const stored = [{ id: 'h', type: 'hero', settings: { height: '80vh' } }]
    assert.deepEqual(withDefaultBlocks(definition, stored), [
      { id: 'h', type: 'hero', settings: { height: '80vh' }, blocks: [block] },
    ])
  })

  test('blocks: [] (the merchant removed them all) and stored blocks are kept', () => {
    const emptied = [{ id: 'h', type: 'hero', settings: {}, blocks: [] }]
    assert.deepEqual(withDefaultBlocks(definition, emptied), emptied)
    const own = [{ id: 'h', type: 'hero', settings: {}, blocks: [{ id: 'mine', type: 'slide', settings: {} }] }]
    assert.deepEqual(withDefaultBlocks(definition, own), own)
  })

  test('a section without default blocks, or of an unknown type, is left as it is', () => {
    const stored = [
      { id: 'p', type: 'plain', settings: {} },
      { id: 'x', type: 'gone', settings: {} },
    ]
    assert.deepEqual(withDefaultBlocks(definition, stored), stored)
  })
})
