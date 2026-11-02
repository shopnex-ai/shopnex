import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatCentsInput, toCents } from '../src/lib/money'

describe('toCents', () => {
  test('parses decimal amounts', () => {
    assert.equal(toCents('19.99'), 1999)
    assert.equal(toCents('5'), 500)
    assert.equal(toCents('1,250.5'), 125050)
    assert.equal(toCents(' 0.10 '), 10)
    assert.equal(toCents('0'), 0)
  })
  test('empty means null', () => {
    assert.equal(toCents(''), null)
    assert.equal(toCents('   '), null)
  })
  test('junk is NaN', () => {
    for (const junk of ['abc', 'NaN', '1.234', '1e5', '1.2.3', '.', '-', '--5', '$5'])
      assert.ok(Number.isNaN(toCents(junk)), junk)
  })
})

describe('formatCentsInput', () => {
  test('formats finite numbers', () => {
    assert.equal(formatCentsInput(1999), '19.99')
    assert.equal(formatCentsInput(0), '0.00')
  })
  test('never renders NaN', () => {
    for (const v of [null, undefined, Number.NaN, Infinity, 'abc' as unknown as number])
      assert.equal(formatCentsInput(v), '')
  })
})
