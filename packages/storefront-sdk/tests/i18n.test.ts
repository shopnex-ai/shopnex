import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { flattenMessages, formatMessage, languageChain } from '../src/i18n'

describe('flattenMessages', () => {
  test('nested JSON becomes dotted keys', () => {
    assert.deepEqual(
      flattenMessages({ cart: { empty: 'Your cart is empty', drawer: { close: 'Close' } }, home: 'Home' }),
      {
        'cart.empty': 'Your cart is empty',
        'cart.drawer.close': 'Close',
        home: 'Home',
      },
    )
  })

  test('an object of plural forms is one message, not more keys', () => {
    const tree = { cart: { items: { one: '{{ count }} item', other: '{{ count }} items' } } }
    assert.deepEqual(flattenMessages(tree), { 'cart.items': { one: '{{ count }} item', other: '{{ count }} items' } })
  })

  test('anything that is not text or a group of text is left out', () => {
    assert.deepEqual(flattenMessages({ a: 1, b: null, c: ['x'], d: 'ok' }), { d: 'ok' })
    assert.deepEqual(flattenMessages('text'), {})
  })
})

describe('languageChain', () => {
  test('a region falls back to its language', () => {
    assert.deepEqual(languageChain('pt-BR'), ['pt-BR', 'pt'])
    assert.deepEqual(languageChain('zh-Hant-TW'), ['zh-Hant-TW', 'zh'])
    assert.deepEqual(languageChain('fr'), ['fr'])
  })
})

describe('formatMessage', () => {
  test('fills placeholders, with or without spaces; a name with no value stays as written', () => {
    assert.equal(formatMessage('Hello {{ name }}, {{city}}', { name: 'Ada', city: 'Paris' }, 'en'), 'Hello Ada, Paris')
    assert.equal(formatMessage('Hello {{ name }}', {}, 'en'), 'Hello {{ name }}')
    assert.equal(formatMessage('Hello {{ name }}', undefined, 'en'), 'Hello {{ name }}')
  })

  test('picks the plural form for the count in the language’s own rules', () => {
    const items = { one: '{{ count }} item', other: '{{ count }} items' }
    assert.equal(formatMessage(items, { count: 1 }, 'en'), '1 item')
    assert.equal(formatMessage(items, { count: 3 }, 'en'), '3 items')
    // French counts 0 and 1 as singular; Polish has few and many
    assert.equal(
      formatMessage({ one: '{{ count }} article', other: '{{ count }} articles' }, { count: 0 }, 'fr'),
      '0 article',
    )
    const pl = {
      one: '{{ count }} sztuka',
      few: '{{ count }} sztuki',
      many: '{{ count }} sztuk',
      other: '{{ count }} sztuki',
    }
    assert.deepEqual(
      [1, 3, 5].map((count) => formatMessage(pl, { count }, 'pl')),
      ['1 sztuka', '3 sztuki', '5 sztuk'],
    )
  })

  test('a plural without a count, or without the form needed, uses "other"', () => {
    const items = { one: 'one item', other: 'many items' }
    assert.equal(formatMessage(items, undefined, 'en'), 'many items')
    assert.equal(formatMessage({ other: 'x' }, { count: 1 }, 'en'), 'x')
  })

  test('an unknown language still counts (English rules)', () => {
    assert.equal(formatMessage({ one: 'a', other: 'b' }, { count: 1 }, 'not a language'), 'a')
  })
})
