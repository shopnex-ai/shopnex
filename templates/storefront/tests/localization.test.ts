import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { localPath, localizationObject } from '../src/core/localization'

const none = { shipTo: [], shopLanguage: 'en', languages: [] }

describe('localization: countries', () => {
  test('one country or none: no choice to offer', () => {
    assert.deepEqual(localizationObject(none, 'USD').available_countries, [])
    const one = localizationObject({ ...none, shipTo: ['DE'] }, 'EUR')
    assert.deepEqual([one.available_countries, one.country?.iso_code], [[], 'DE'])
  })

  test('two or more: sorted by name, the visitor’s choice is the country, an unlisted choice falls back to the first', () => {
    const l = localizationObject({ ...none, shipTo: ['NL', 'DE', 'FR'], country: 'FR' }, 'EUR')
    assert.deepEqual(
      l.available_countries.map((c) => c.name),
      ['France', 'Germany', 'Netherlands'],
    )
    assert.equal(l.country?.iso_code, 'FR')
    assert.equal(localizationObject({ ...none, shipTo: ['NL', 'DE'], country: 'US' }, 'EUR').country?.iso_code, 'DE')
  })
})

describe('localization: languages', () => {
  test('a shop that publishes none has its own language and nothing to choose', () => {
    const l = localizationObject(none, 'USD')
    assert.deepEqual([l.available_languages, l.language], [[], { iso_code: 'en', name: 'English' }])
  })

  test('with others: the shop’s own first, each named in itself; the visitor’s choice, else the shop’s own', () => {
    const base = { ...none, languages: ['fr', 'de'] }
    const l = localizationObject({ ...base, language: 'fr' }, 'EUR')
    assert.deepEqual(
      l.available_languages.map((x) => [x.iso_code, x.name]),
      [
        ['en', 'English'],
        ['fr', 'Français'],
        ['de', 'Deutsch'],
      ],
    )
    assert.equal(l.language.iso_code, 'fr')
    for (const stale of [undefined, 'es', 'en']) {
      assert.equal(localizationObject({ ...base, language: stale }, 'EUR').language.iso_code, 'en', String(stale))
    }
  })
})

describe('localization: forms', () => {
  test('the form only sends visitors back to a path on this site', () => {
    assert.deepEqual(
      ['/products', '/a?b=1', '//evil.test', 'https://evil.test', '/\\evil.test', '', null].map(localPath),
      ['/products', '/a?b=1', '/', '/', '/', '/', '/'],
    )
  })
})
