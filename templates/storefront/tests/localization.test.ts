import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { localPath, localizationObject } from '../src/core/localization'

describe('localization', () => {
  test('one country or none: no choice to offer', () => {
    assert.deepEqual(localizationObject([], undefined, 'USD').available_countries, [])
    const one = localizationObject(['DE'], undefined, 'EUR')
    assert.deepEqual([one.available_countries, one.country?.iso_code], [[], 'DE'])
  })

  test('two or more: sorted by name, the visitor’s choice is the country, an unlisted choice falls back to the first', () => {
    const l = localizationObject(['NL', 'DE', 'FR'], 'FR', 'EUR')
    assert.deepEqual(
      l.available_countries.map((c) => c.name),
      ['France', 'Germany', 'Netherlands'],
    )
    assert.equal(l.country?.iso_code, 'FR')
    assert.equal(localizationObject(['NL', 'DE'], 'US', 'EUR').country?.iso_code, 'DE')
  })

  test('the form only sends visitors back to a path on this site', () => {
    assert.deepEqual(
      ['/products', '/a?b=1', '//evil.test', 'https://evil.test', '/\\evil.test', '', null].map(localPath),
      ['/products', '/a?b=1', '/', '/', '/', '/', '/'],
    )
  })
})
