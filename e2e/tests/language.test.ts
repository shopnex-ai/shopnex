// The storefront language of a shop: what counts as a language tag, and that every theme layout carries the shop's
// language instead of a fixed "en". Pure: no database, no app. The setting through the API and the storefront is in
// shop-language.test.ts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { canonicalLanguage } from '@shopnex/db/schema'
import { closeDb } from '../lib'

after(closeDb)

describe('canonicalLanguage', () => {
  test('gives the canonical spelling of a tag', () => {
    const cases: [string, string][] = [
      ['en', 'en'],
      ['EN', 'en'],
      [' fr ', 'fr'],
      ['pt-br', 'pt-BR'],
      ['PT-BR', 'pt-BR'],
      ['zh-hant', 'zh-Hant'],
      ['sr-latn-rs', 'sr-Latn-RS'],
      ['fil', 'fil'],
    ]
    for (const [input, expected] of cases) assert.equal(canonicalLanguage(input), expected, input)
  })

  test('refuses what is not a language tag', () => {
    const bad = [
      '',
      ' ',
      'x',
      'english',
      'en_US',
      'en-',
      '-en',
      '12',
      'und',
      'e n',
      '<script>',
      'en-<b>',
      'a'.repeat(80),
    ]
    for (const input of bad) assert.equal(canonicalLanguage(input), null, JSON.stringify(input))
  })
})

describe('theme layouts', () => {
  // The themes the storefront ships, from its own list (the folder also holds shared assets)
  const themes = join(import.meta.dirname, '../../templates/storefront/themes')
  const names: string[] = JSON.parse(readFileSync(join(themes, 'index.json'), 'utf8')).themes
  const layouts = names.map((theme) => ({ theme, path: join(themes, theme, 'layout/theme.liquid') }))

  test('there are layouts to check', () => {
    assert.ok(layouts.length >= 5, `found ${layouts.length} themes`)
  })

  for (const { theme, path } of layouts) {
    test(`${theme} sets the page's language from the shop, not a fixed "en"`, () => {
      const html = readFileSync(path, 'utf8')
      assert.match(html, /<html lang="\{\{ shop\.language \}\}"/)
      assert.doesNotMatch(html, /<html[^>]*lang="[a-z]{2}"/, 'a hard-coded language')
    })
  }
})
