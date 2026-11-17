// The editor's check of a Liquid file before it is saved: syntax only, with a line when the parser gives one.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { checkLiquid } from '../src/code'

describe('checkLiquid', () => {
  test('a template that parses has no problem', () => {
    assert.equal(checkLiquid('<h1>{{ shop.name | upcase }}</h1>\n{% if a %}x{% else %}y{% endif %}'), null)
    assert.equal(checkLiquid(''), null)
  })

  test('the storefront’s own {% sections %} tag is known, and needs a page id', () => {
    assert.equal(checkLiquid("{% sections 'home' %}"), null)
    assert.match(checkLiquid('{% sections %}')!.message, /needs a page id/)
  })

  test('only the syntax is checked: an unknown filter is fine, an unknown tag is not', () => {
    assert.equal(checkLiquid('{{ product.title | not_a_real_filter }}'), null)
    assert.match(checkLiquid('{% nonsense %}')!.message, /nonsense/)
  })

  test('an unclosed block is a problem with its message and the line it was opened on', () => {
    const problem = checkLiquid('<p>one</p>\n<p>two</p>\n{% if a %}\n<p>three</p>')
    assert.ok(problem)
    assert.match(problem.message, /not closed/)
    assert.equal(problem.line, 3)
  })

  test('the message is the first line only, and the line is null when the parser gives none', () => {
    const problem = checkLiquid('{% if a %}')
    assert.ok(problem)
    assert.ok(!problem.message.includes('\n'))
    assert.ok(problem.line === null || typeof problem.line === 'number')
  })
})
