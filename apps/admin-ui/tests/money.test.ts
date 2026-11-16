import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatMinorInput, formatMoney, minorPerUnit, toMinor } from '../src/lib/money'

describe('toMinor', () => {
  test('two-decimal currencies: hundredths', () => {
    assert.equal(toMinor('19.99', 'USD'), 1999)
    assert.equal(toMinor('5', 'USD'), 500)
    assert.equal(toMinor('1,250.5', 'EUR'), 125050)
    assert.equal(toMinor(' 0.10 ', 'USD'), 10)
    assert.equal(toMinor('0', 'USD'), 0)
  })
  test('zero-decimal currencies: whole units, no decimals', () => {
    assert.equal(toMinor('1000', 'JPY'), 1000)
    assert.equal(toMinor('1,000', 'JPY'), 1000)
    assert.ok(Number.isNaN(toMinor('10.5', 'JPY')))
    assert.ok(Number.isNaN(toMinor('10.', 'JPY')))
    assert.equal(toMinor('5000', 'KRW'), 5000)
  })
  test('three-decimal currencies: thousandths', () => {
    assert.equal(toMinor('1.234', 'BHD'), 1234)
    assert.equal(toMinor('1.23', 'BHD'), 1230)
    assert.equal(toMinor('2', 'KWD'), 2000)
    assert.ok(Number.isNaN(toMinor('1.2345', 'BHD')))
  })
  test('too many decimals for a two-decimal currency is NaN', () => {
    assert.ok(Number.isNaN(toMinor('1.234', 'USD')))
  })
  test('empty means null', () => {
    assert.equal(toMinor('', 'USD'), null)
    assert.equal(toMinor('   ', 'JPY'), null)
  })
  test('junk is NaN', () => {
    for (const junk of ['abc', 'NaN', '1e5', '1.2.3', '.', '-', '--5', '$5']) {
      assert.ok(Number.isNaN(toMinor(junk, 'USD')), junk)
      assert.ok(Number.isNaN(toMinor(junk, 'JPY')), junk)
    }
  })
})

describe('formatMinorInput', () => {
  test('formats finite numbers with the currency’s own digits', () => {
    assert.equal(formatMinorInput(1999, 'USD'), '19.99')
    assert.equal(formatMinorInput(0, 'USD'), '0.00')
    assert.equal(formatMinorInput(1000, 'JPY'), '1000')
    assert.equal(formatMinorInput(1230, 'BHD'), '1.230')
  })
  test('round-trips through toMinor', () => {
    for (const [minor, currency] of [
      [1999, 'USD'],
      [1000, 'JPY'],
      [1234, 'BHD'],
    ] as const)
      assert.equal(toMinor(formatMinorInput(minor, currency), currency), minor)
  })
  test('never renders NaN', () => {
    for (const v of [null, undefined, Number.NaN, Infinity, 'abc' as unknown as number])
      assert.equal(formatMinorInput(v, 'USD'), '')
  })
})

describe('formatMoney and minorPerUnit', () => {
  test('show the same amount the field accepts', () => {
    assert.equal(formatMoney(1000, 'JPY'), '¥1,000')
    assert.equal(formatMoney(1230, 'BHD').replace(/\s/g, ' '), 'BHD 1.230')
    assert.equal(formatMoney(1999, 'USD'), '$19.99')
    assert.deepEqual([minorPerUnit('USD'), minorPerUnit('JPY'), minorPerUnit('BHD')], [100, 1, 1000])
  })
})
