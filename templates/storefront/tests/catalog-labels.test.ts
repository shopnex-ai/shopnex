// The words core writes for a listing (sort options, filters, what is selected): the theme's text, or English.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { flattenMessages } from '@shopnex/storefront-sdk/i18n'
import { labelText, sayFilters, sortOptions, type CatalogFilters } from '../src/core/catalog'

const themesDir = join(import.meta.dirname, '../themes')
const themes: string[] = JSON.parse(readFileSync(join(themesDir, 'index.json'), 'utf8')).themes
const noText = () => undefined
const spanish: Record<string, string> = {
  'collection.filter_tag': 'Etiqueta',
  'collection.in_stock': 'En stock',
  'collection.price_from': 'desde {{ amount }}',
}
const say = (key: string, vars?: Record<string, string>) =>
  spanish[key]?.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => vars?.[name] ?? '')

const filters: Pick<CatalogFilters, 'groups' | 'active'> = {
  groups: [
    {
      label: { key: 'collection.filter_tag', text: 'Tag' },
      param: 'tag',
      type: 'list',
      values: [{ label: 'sale', value: 'sale', count: 3, active: true, url: '/x' }],
    },
    {
      label: { key: 'collection.filter_availability', text: 'Availability' },
      param: 'available',
      type: 'list',
      values: [
        { label: { key: 'collection.in_stock', text: 'In stock' }, value: '1', count: null, active: false, url: '/y' },
      ],
    },
  ],
  active: [
    { label: { key: 'collection.filter_tag', text: 'Tag' }, value: 'sale', url: '/no-tag' },
    { label: { key: 'collection.in_stock', text: 'In stock' }, url: '/no-stock' },
    {
      label: { key: 'collection.filter_price', text: 'Price' },
      value: { key: 'collection.price_from', text: 'from {{ amount }}', vars: { amount: '10' } },
      url: '/no-price',
    },
  ],
}

describe('labelText', () => {
  test('a plain string is itself', () => assert.equal(labelText('Summer', say), 'Summer'))

  test('uses the theme’s text, with the placeholders filled', () => {
    assert.equal(labelText({ key: 'collection.filter_tag', text: 'Tag' }, say), 'Etiqueta')
    assert.equal(
      labelText({ key: 'collection.price_from', text: 'from {{ amount }}', vars: { amount: '10' } }, say),
      'desde 10',
    )
  })

  test('a theme without the text gets the English, placeholders filled', () => {
    assert.equal(labelText({ key: 'collection.filter_tag', text: 'Tag' }, noText), 'Tag')
    assert.equal(
      labelText({ key: 'collection.price_up_to', text: 'up to {{ amount }}', vars: { amount: '20' } }, noText),
      'up to 20',
    )
  })
})

describe('sayFilters', () => {
  test('groups, their values and what is selected, in the theme’s text where it has some', () => {
    const said = sayFilters(filters, say)
    assert.deepEqual(
      said.groups.map((g) => g.label),
      ['Etiqueta', 'Availability'], // no Spanish text for the second: it stays English
    )
    assert.deepEqual(
      said.groups.map((g) => (g.type === 'list' ? g.values.map((v) => v.label) : [])),
      [['sale'], ['En stock']],
    )
    assert.deepEqual(
      said.active.map((a) => a.label),
      ['Etiqueta: sale', 'En stock', 'Price: desde 10'],
    )
    assert.deepEqual(
      said.active.map((a) => a.url),
      ['/no-tag', '/no-stock', '/no-price'],
    )
  })

  test('without any theme text it is the English it always was', () => {
    const said = sayFilters(filters, noText)
    assert.deepEqual(
      said.active.map((a) => a.label),
      ['Tag: sale', 'In stock', 'Price: from 10'],
    )
  })
})

describe('every theme has the text core uses', () => {
  const core = readFileSync(join(import.meta.dirname, '../src/core/catalog.ts'), 'utf8')
  const keys = [...new Set([...core.matchAll(/\blabel\(\s*'([a-z_.]+)'/g)].map((m) => m[1]!))].sort()

  test('the keys are found (the sort options and the filters)', () => {
    assert.ok(keys.length >= 13, `found ${keys.length} keys: did the labels move?`)
    for (const option of sortOptions) assert.ok(keys.includes(option.title.key), option.title.key)
  })

  for (const theme of themes) {
    test(`${theme} has them in every language`, () => {
      const folder = join(themesDir, theme, 'locales')
      for (const file of readdirSync(folder).filter((f) => f.endsWith('.json'))) {
        const messages = flattenMessages(JSON.parse(readFileSync(join(folder, file), 'utf8')))
        assert.deepEqual(
          keys.filter((key) => !(key in messages)),
          [],
          `${theme}/${file}`,
        )
      }
    })
  }
})
