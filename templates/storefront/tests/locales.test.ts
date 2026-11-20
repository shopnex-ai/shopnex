// A theme's text in the visitor's language: its locales/ folder, the `t` filter, and what its scripts get.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { createLiquid } from '../src/core/liquid'
import { messagesFor, scriptMessages, translateKey } from '../src/core/locales'

let dir = ''
const write = (file: string, content: unknown) =>
  writeFileSync(join(dir, 'locales', file), typeof content === 'string' ? content : JSON.stringify(content))

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'theme-'))
  mkdirSync(join(dir, 'locales'))
  mkdirSync(join(dir, 'snippets'))
  write('en.default.json', {
    general: { search: 'Search', account: 'Account' },
    cart: { items: { one: '{{ count }} item', other: '{{ count }} items' }, hello: 'Hello {{ name }}' },
    js: { cart: { empty: 'Your cart is empty' }, close: 'Close' },
  })
  write('fr.json', {
    general: { search: 'Rechercher' },
    cart: { items: { one: '{{ count }} article', other: '{{ count }} articles' } },
    js: { cart: { empty: 'Votre panier est vide' } },
  })
  write('pt.json', { general: { search: 'Pesquisar', account: 'Conta' } })
  write('pt-BR.json', { general: { search: 'Buscar' } })
  write('broken.json', '{ not json')
  write('notes.txt', 'ignored')
})
after(() => rmSync(dir, { recursive: true, force: true }))

describe('a theme’s locale files', () => {
  test('the default language is the fallback, key by key', () => {
    assert.equal(translateKey(dir, 'en', 'general.search'), 'Search')
    // French has no "account": the theme's own language fills it in
    assert.deepEqual(
      [translateKey(dir, 'fr', 'general.search'), translateKey(dir, 'fr', 'general.account')],
      ['Rechercher', 'Account'],
    )
    // A language with no file at all sees the default
    assert.equal(translateKey(dir, 'ja', 'general.search'), 'Search')
  })

  test('a region uses its own text, then its language’s, then the default’s', () => {
    assert.deepEqual(
      ['pt-BR', 'pt-PT', 'pt'].map((l) => [
        translateKey(dir, l, 'general.search'),
        translateKey(dir, l, 'general.account'),
      ]),
      [
        ['Buscar', 'Conta'],
        ['Pesquisar', 'Conta'],
        ['Pesquisar', 'Conta'],
      ],
    )
    assert.equal(translateKey(dir, 'PT-br', 'general.search'), 'Buscar', 'language tags are not case sensitive')
  })

  test('placeholders and plural forms, in the language’s rules', () => {
    assert.equal(translateKey(dir, 'en', 'cart.hello', { name: 'Ada' }), 'Hello Ada')
    assert.deepEqual(
      [1, 2].map((count) => translateKey(dir, 'en', 'cart.items', { count })),
      ['1 item', '2 items'],
    )
    assert.deepEqual(
      [0, 1, 2].map((count) => translateKey(dir, 'fr', 'cart.items', { count })),
      ['0 article', '1 article', '2 articles'],
    )
  })

  test('a key the theme has no text for says so; a broken or foreign file is ignored', () => {
    assert.equal(translateKey(dir, 'fr', 'nope.key'), 'translation missing: nope.key')
    assert.equal(Object.keys(messagesFor(dir, 'en')).includes('broken'), false)
  })

  test('a theme with no locales folder says only that its keys are missing', () => {
    const bare = mkdtempSync(join(tmpdir(), 'theme-bare-'))
    try {
      assert.equal(translateKey(bare, 'fr', 'general.search'), 'translation missing: general.search')
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  test('scripts get the js.* text only, in the visitor’s language with the default filling the gaps', () => {
    assert.deepEqual(scriptMessages(dir, 'fr'), { 'js.cart.empty': 'Votre panier est vide', 'js.close': 'Close' })
    assert.deepEqual(Object.keys(scriptMessages(dir, 'en')).sort(), ['js.cart.empty', 'js.close'])
  })
})

describe('the t filter', () => {
  const render = (template: string, language: string, scope: Record<string, unknown> = {}) =>
    createLiquid('test', dir).parseAndRender(template, { ...scope, localization: { language: { iso_code: language } } })

  test('writes the theme’s text in the visitor’s language', async () => {
    assert.equal(await render(`{{ 'general.search' | t }}`, 'fr'), 'Rechercher')
    assert.equal(await render(`{{ 'general.search' | t }}`, 'en'), 'Search')
  })

  test('takes keyword arguments for placeholders and plurals; a value from the page is just a value', async () => {
    assert.equal(
      await render(`{{ 'cart.hello' | t: name: customer.name }}`, 'en', { customer: { name: 'Ada' } }),
      'Hello Ada',
    )
    assert.equal(await render(`{{ 'cart.items' | t: count: n }}`, 'fr', { n: 3 }), '3 articles')
  })

  test('is escaped like any output, so what a placeholder carries cannot add markup', async () => {
    assert.equal(
      await render(`{{ 'cart.hello' | t: name: who }}`, 'en', { who: '<b>x</b>' }),
      'Hello &lt;b&gt;x&lt;/b&gt;',
    )
  })
})
