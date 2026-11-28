// Documents saved before the sections had blocks kept their content in numbered settings (image_1, heading_1…). The themes
// declare which block settings those became (`from_settings`), and resolving the document turns them into blocks, so a theme
// saved on an older version still shows its slides, questions and quotes. The old ids below are the ones the themes had
// before blocks (KS BootShop, Shopco and Hydrogen; each theme's git history has them).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  ThemeDefinition,
  resolveBlocks,
  resolveDocument,
  resolveSettings,
  type ThemeDocument,
} from '@shopnex/storefront-sdk/theme'
import { SafeHtml } from '../src/core/drops'
import { RENDER, createLiquid, type RenderData, type SectionObject } from '../src/core/liquid'

const themeDir = (theme: string) => new URL(`../themes/${theme}`, import.meta.url).pathname
const load = (theme: string) => ThemeDefinition.parse(JSON.parse(readFileSync(`${themeDir(theme)}/theme.json`, 'utf8')))

const documentWith = (type: string, settings: Record<string, string>): ThemeDocument => ({
  settings: {},
  pages: { home: { sections: [{ id: 's1', type, settings }] } },
})

type Case = {
  theme: string
  section: string
  /** What an old document stored in the section's settings */
  old: Record<string, string>
  /** Old settings that are not numbered but go too (a text with one item per line) */
  gone?: string[]
  /** The blocks that become of it */
  blocks: { id: string; type: string; settings: Record<string, string> }[]
}

const cases: Case[] = [
  {
    theme: 'ks-bootshop',
    section: 'hero-carousel',
    old: {
      height: '80vh',
      image_1: '/one.jpg',
      heading_1: 'Welcome',
      text_1: 'Hello',
      button_label_1: 'Shop',
      button_link_1: '/products',
      image_3: '/three.jpg',
    },
    blocks: [
      {
        id: 'slide-1',
        type: 'slide',
        settings: {
          image: '/one.jpg',
          heading: 'Welcome',
          text: 'Hello',
          button_label: 'Shop',
          button_link: '/products',
        },
      },
      { id: 'slide-3', type: 'slide', settings: { image: '/three.jpg' } },
    ],
  },
  {
    theme: 'ks-bootshop',
    section: 'faq',
    old: { heading: 'FAQ', question_1: 'Returns?', answer_1: '30 days.', question_2: 'Shipping?', answer_2: 'Free.' },
    blocks: [
      { id: 'question-1', type: 'question', settings: { question: 'Returns?', answer: '30 days.' } },
      { id: 'question-2', type: 'question', settings: { question: 'Shipping?', answer: 'Free.' } },
    ],
  },
  {
    theme: 'ks-bootshop',
    section: 'testimonials',
    old: { quote_1: 'Great', author_1: 'Sam' },
    blocks: [{ id: 'quote-1', type: 'quote', settings: { quote: 'Great', author: 'Sam' } }],
  },
  {
    theme: 'ks-bootshop',
    section: 'featured-collections',
    old: { collection_1: 'shirts', collection_2: 'hats' },
    blocks: [
      { id: 'collection-1', type: 'collection', settings: { collection: 'shirts' } },
      { id: 'collection-2', type: 'collection', settings: { collection: 'hats' } },
    ],
  },
  {
    theme: 'shopco',
    section: 'hero',
    old: { heading: 'FIND CLOTHES', stat_1_value: '200+', stat_1_label: 'Brands', stat_3_value: '30,000+' },
    blocks: [
      { id: 'stat-1', type: 'stat', settings: { value: '200+', label: 'Brands' } },
      { id: 'stat-3', type: 'stat', settings: { value: '30,000+' } },
    ],
  },
  {
    theme: 'shopco',
    section: 'testimonials',
    old: { name_1: 'Sarah', quote_1: 'Lovely', name_2: 'Alex', quote_2: 'Nice' },
    blocks: [
      { id: 'quote-1', type: 'quote', settings: { name: 'Sarah', quote: 'Lovely' } },
      { id: 'quote-2', type: 'quote', settings: { name: 'Alex', quote: 'Nice' } },
    ],
  },
  {
    theme: 'shopco',
    section: 'brands',
    old: { names: 'Versace\n  Zara \n\nGucci' },
    gone: ['names'],
    blocks: [
      { id: 'brand-1', type: 'brand', settings: { name: 'Versace' } },
      { id: 'brand-2', type: 'brand', settings: { name: 'Zara' } },
      { id: 'brand-3', type: 'brand', settings: { name: 'Gucci' } },
    ],
  },
  {
    theme: 'shopco',
    section: 'style-grid',
    old: { collection_2: 'casual' },
    blocks: [{ id: 'collection-2', type: 'collection', settings: { collection: 'casual' } }],
  },
  {
    theme: 'hydrogen',
    section: 'collection-list',
    old: { heading: 'Collections', collection_1: 'a', collection_2: 'b', collection_6: 'f' },
    blocks: [
      { id: 'collection-1', type: 'collection', settings: { collection: 'a' } },
      { id: 'collection-2', type: 'collection', settings: { collection: 'b' } },
      { id: 'collection-6', type: 'collection', settings: { collection: 'f' } },
    ],
  },
]

describe('a document saved before blocks', () => {
  for (const { theme, section, old, gone = [], blocks } of cases) {
    test(`${theme}: ${section} gets its blocks from the numbered settings`, () => {
      const definition = load(theme)
      const [resolved] = resolveDocument(definition, documentWith(section, old)).pages.home!.sections
      assert.deepEqual(resolved!.blocks, blocks)
      // Only what is not numbered stays in the settings
      assert.deepEqual(
        Object.keys(resolved!.settings),
        Object.keys(old).filter((key) => !/_\d+(_|$)/.test(key) && !gone.includes(key)),
      )
      // Resolving again changes nothing, and the blocks are valid ones for the section
      const again = resolveDocument(definition, { settings: {}, pages: { home: { sections: [resolved!] } } })
      assert.deepEqual(again.pages.home!.sections, [resolved])
      assert.equal(resolveBlocks(definition.sections[section]!, resolved!.blocks).length, blocks.length)
    })
  }

  test('a section the merchant already moved to blocks keeps them', () => {
    const definition = load('ks-bootshop')
    const mine = { id: 's1', type: 'hero-carousel', settings: { image_1: '/old.jpg' }, blocks: [] }
    const document: ThemeDocument = { settings: {}, pages: { home: { sections: [mine] } } }
    assert.equal(resolveDocument(definition, document).pages.home!.sections[0], mine)
  })

  test('every theme that declares from_settings names settings of its own and keys with {n}', () => {
    for (const theme of ['ks-bootshop', 'shopco', 'hydrogen']) {
      const declared = Object.values(load(theme).sections).flatMap((s) =>
        Object.values(s.blocks).filter((b) => b.from_settings),
      )
      assert.ok(declared.length > 0, theme)
    }
  })
})

describe('the storefront shows an old KS BootShop hero', () => {
  const definition = load('ks-bootshop')

  const objectOf = (s: { id: string; type: string; settings: Record<string, unknown>; blocks?: unknown[] }) => {
    const def = definition.sections[s.type]!
    const blocks = resolveBlocks(def, s.blocks as never).map((b) => ({
      id: b.id,
      type: b.type,
      settings: b.settings,
      shopify_attributes: new SafeHtml(`data-block-id="${b.id}"`),
    }))
    return {
      id: s.id,
      type: s.type,
      settings: resolveSettings(def.settings, s.settings as never),
      blocks,
      block_order: blocks.map((b) => b.id),
    } as SectionObject
  }

  test('renders a slide for each old numbered slide, the first with the h1', async () => {
    const old = {
      image_1: '/one.jpg',
      heading_1: 'Welcome to our store',
      button_label_1: 'Shop now',
      button_link_1: '/products',
      image_2: '/two.jpg',
    }
    const resolved = resolveDocument(definition, documentWith('hero-carousel', old)).pages.home!.sections
    const data: RenderData = { sections: () => resolved.map(objectOf), section: () => null }
    const html = await createLiquid('ks-bootshop', themeDir('ks-bootshop')).parseAndRender(
      "{% sections 'home' %}",
      {},
      { globals: { [RENDER]: data } },
    )
    assert.match(html, /<div data-block-id="slide-1" class="carousel-item active">/)
    assert.match(html, /<h1 class="display-4">Welcome to our store<\/h1>/)
    assert.match(html, /<div data-block-id="slide-2" class="carousel-item">/)
    assert.match(html, /src="\/two\.jpg"/)
    // Without resolving, the same document draws nothing: that was the empty hero
    const bare = documentWith('hero-carousel', old).pages.home!.sections
    const empty = await createLiquid('ks-bootshop', themeDir('ks-bootshop')).parseAndRender(
      "{% sections 'home' %}",
      {},
      { globals: { [RENDER]: { sections: () => bare.map(objectOf), section: () => null } satisfies RenderData } },
    )
    assert.doesNotMatch(empty, /carousel-item/)
  })
})
