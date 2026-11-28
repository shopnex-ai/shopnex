// The theme compatibility check's comparison: what counts as a break between two versions of the themes.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { compareThemes, describe as describeChanges, isBreaking, type ThemeFiles } from '../scripts/theme-compat-lib'

const field = (id: string) => ({ id, label: id, type: 'text' })
const theme = (patch: Record<string, unknown> = {}) => ({
  id: 'demo',
  name: 'Demo',
  settings: [field('logo')],
  sections: {
    hero: {
      name: 'Hero',
      settings: [field('height')],
      blocks: { slide: { name: 'Slide', settings: [field('image'), field('heading')] } },
    },
  },
  pages: {},
  ...patch,
})
const files = (json: unknown): ThemeFiles => ({ demo: json })

describe('comparing two versions of the themes', () => {
  test('no change: nothing to report', () => {
    const c = compareThemes(files(theme()), files(theme()))
    assert.equal(isBreaking(c), false)
    assert.deepEqual(c, { themesAdded: [], themesRemoved: [], added: {}, accounted: {}, breaking: {} })
    assert.match(describeChanges(c), /No change/)
  })

  test('additions are free: a setting, a section, a block type, a whole theme', () => {
    const head = theme({
      settings: [field('logo'), field('favicon')],
      sections: {
        hero: {
          name: 'Hero',
          settings: [field('height')],
          blocks: { slide: { name: 'Slide', settings: [field('image'), field('heading'), field('link')] } },
        },
        faq: { name: 'FAQ' },
      },
    })
    const c = compareThemes(files(theme()), { demo: head, extra: theme({ id: 'extra' }) })
    assert.equal(isBreaking(c), false)
    assert.deepEqual(c.themesAdded, ['extra'])
    assert.deepEqual(c.added.demo, ['sections/faq', 'sections/hero/blocks/slide/settings/link', 'settings/favicon'])
  })

  test('a removed setting is a break, and so is a rename (the old id is gone)', () => {
    const removed = theme({ settings: [] })
    assert.deepEqual(compareThemes(files(theme()), files(removed)).breaking.demo, ['settings/logo'])
    const renamed = theme({ settings: [field('brand_logo')] })
    const c = compareThemes(files(theme()), files(renamed))
    assert.equal(isBreaking(c), true)
    assert.deepEqual(c.breaking.demo, ['settings/logo'])
    assert.deepEqual(c.added.demo, ['settings/brand_logo'])
  })

  test('a removed section reports everything under it', () => {
    const c = compareThemes(files(theme()), files(theme({ sections: {} })))
    assert.deepEqual(c.breaking.demo, [
      'sections/hero',
      'sections/hero/blocks/slide',
      'sections/hero/blocks/slide/settings/heading',
      'sections/hero/blocks/slide/settings/image',
      'sections/hero/settings/height',
    ])
  })

  test('a removal the theme lists in `removed` is accounted for, not a break', () => {
    const c = compareThemes(files(theme()), files(theme({ settings: [], removed: ['settings/logo'] })))
    assert.equal(isBreaking(c), false)
    assert.deepEqual(c.accounted.demo, ['settings/logo'])
  })

  test('settings moved into blocks are a break too: only `removed` accounts for them (the data moves in a migration)', () => {
    const before = theme({
      sections: { hero: { name: 'Hero', settings: [field('image_1'), field('image_2')], blocks: {} } },
    })
    const after = theme({
      sections: {
        hero: { name: 'Hero', settings: [], blocks: { slide: { name: 'Slide', settings: [field('image')] } } },
      },
    })
    const c = compareThemes(files(before), files(after))
    assert.equal(isBreaking(c), true)
    assert.deepEqual(c.breaking.demo, ['sections/hero/settings/image_1', 'sections/hero/settings/image_2'])
    const listed = compareThemes(files(before), files({ ...after, removed: ['sections/hero/settings'] }))
    assert.equal(isBreaking(listed), false)
  })

  test('a theme dropped from the list is a break: every saved theme of it is orphaned', () => {
    const c = compareThemes({ demo: theme(), gone: theme({ id: 'gone' }) }, files(theme()))
    assert.equal(isBreaking(c), true)
    assert.deepEqual(c.themesRemoved, ['gone'])
    assert.match(describeChanges(c), /Themes removed:\*\* `gone`/)
  })

  test('says which side is not a valid theme', () => {
    assert.throws(
      () => compareThemes(files({ nope: true }), files(theme())),
      /base theme\.json of demo is not a valid theme/,
    )
    assert.throws(
      () => compareThemes(files(theme()), files({ nope: true })),
      /head theme\.json of demo is not a valid theme/,
    )
  })
})
