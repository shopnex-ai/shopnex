import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { formatMoney, moneyAmount } from '../src/money'

describe('Storefront SDK Money Helpers', () => {
  describe('formatMoney', () => {
    test('formats standard 2-decimal currencies (USD, EUR, GBP)', () => {
      assert.equal(formatMoney({ amountMinor: 1999, currencyCode: 'USD' }), '$19.99')
      assert.equal(formatMoney({ amountMinor: 5000, currencyCode: 'EUR' }), '€50.00')
      assert.equal(formatMoney({ amountMinor: 1550, currencyCode: 'GBP' }), '£15.50')
    })

    test('formats zero amount for 2-decimal currencies', () => {
      assert.equal(formatMoney({ amountMinor: 0, currencyCode: 'USD' }), '$0.00')
      assert.equal(formatMoney({ amountMinor: 0, currencyCode: 'EUR' }), '€0.00')
    })

    test('formats small amounts less than 1 major unit', () => {
      assert.equal(formatMoney({ amountMinor: 99, currencyCode: 'USD' }), '$0.99')
      assert.equal(formatMoney({ amountMinor: 5, currencyCode: 'USD' }), '$0.05')
      assert.equal(formatMoney({ amountMinor: 1, currencyCode: 'USD' }), '$0.01')
    })

    test('formats large values with grouping separators', () => {
      assert.equal(formatMoney({ amountMinor: 100000000, currencyCode: 'USD' }), '$1,000,000.00')
      assert.equal(formatMoney({ amountMinor: 250000050, currencyCode: 'USD' }), '$2,500,000.50')
    })

    test('formats zero-decimal currencies (JPY, KRW) without decimal digits', () => {
      assert.equal(formatMoney({ amountMinor: 1000, currencyCode: 'JPY' }), '¥1,000')
      assert.equal(formatMoney({ amountMinor: 0, currencyCode: 'JPY' }), '¥0')
      assert.equal(formatMoney({ amountMinor: 50000, currencyCode: 'KRW' }), '₩50,000')
    })

    test('formats 3-decimal currencies (BHD, KWD, OMR) with 3 decimal places', () => {
      // Intl in en locale uses non-breaking space between currency symbol/code and amount
      const bhd = formatMoney({ amountMinor: 1250, currencyCode: 'BHD' })
      assert.match(bhd, /BHD[\s\u00A0]1\.250/)

      const kwd = formatMoney({ amountMinor: 500, currencyCode: 'KWD' })
      assert.match(kwd, /KWD[\s\u00A0]0\.500/)

      const omr = formatMoney({ amountMinor: 1, currencyCode: 'OMR' })
      assert.match(omr, /OMR[\s\u00A0]0\.001/)
    })

    test('formats negative amounts correctly', () => {
      assert.equal(formatMoney({ amountMinor: -1999, currencyCode: 'USD' }), '-$19.99')
      assert.equal(formatMoney({ amountMinor: -500, currencyCode: 'JPY' }), '-¥500')
      assert.equal(formatMoney({ amountMinor: -1, currencyCode: 'USD' }), '-$0.01')
    })
  })

  describe('moneyAmount', () => {
    test('returns plain decimal string without symbol or grouping for 2-decimal currencies', () => {
      assert.equal(moneyAmount({ amountMinor: 1999, currencyCode: 'USD' }), '19.99')
      assert.equal(moneyAmount({ amountMinor: 5000, currencyCode: 'EUR' }), '50.00')
      assert.equal(moneyAmount({ amountMinor: 1550, currencyCode: 'GBP' }), '15.50')
    })

    test('returns exact zero string matching currency precision', () => {
      assert.equal(moneyAmount({ amountMinor: 0, currencyCode: 'USD' }), '0.00')
      assert.equal(moneyAmount({ amountMinor: 0, currencyCode: 'JPY' }), '0')
      assert.equal(moneyAmount({ amountMinor: 0, currencyCode: 'BHD' }), '0.000')
    })

    test('preserves leading fractional zeros for small values', () => {
      assert.equal(moneyAmount({ amountMinor: 99, currencyCode: 'USD' }), '0.99')
      assert.equal(moneyAmount({ amountMinor: 5, currencyCode: 'USD' }), '0.05')
      assert.equal(moneyAmount({ amountMinor: 1, currencyCode: 'USD' }), '0.01')
    })

    test('formats large values without thousands commas', () => {
      assert.equal(moneyAmount({ amountMinor: 100000000, currencyCode: 'USD' }), '1000000.00')
      assert.equal(moneyAmount({ amountMinor: 250000050, currencyCode: 'USD' }), '2500000.50')
      assert.equal(moneyAmount({ amountMinor: 10000000, currencyCode: 'JPY' }), '10000000')
    })

    test('formats zero-decimal currencies as integer strings', () => {
      assert.equal(moneyAmount({ amountMinor: 1000, currencyCode: 'JPY' }), '1000')
      assert.equal(moneyAmount({ amountMinor: 250, currencyCode: 'JPY' }), '250')
      assert.equal(moneyAmount({ amountMinor: 50000, currencyCode: 'KRW' }), '50000')
    })

    test('formats 3-decimal currencies with exactly 3 decimal digits', () => {
      assert.equal(moneyAmount({ amountMinor: 1250, currencyCode: 'BHD' }), '1.250')
      assert.equal(moneyAmount({ amountMinor: 500, currencyCode: 'KWD' }), '0.500')
      assert.equal(moneyAmount({ amountMinor: 100, currencyCode: 'BHD' }), '0.100')
      assert.equal(moneyAmount({ amountMinor: 1, currencyCode: 'OMR' }), '0.001')
    })

    test('formats negative amounts with a leading minus sign', () => {
      assert.equal(moneyAmount({ amountMinor: -1999, currencyCode: 'USD' }), '-19.99')
      assert.equal(moneyAmount({ amountMinor: -500, currencyCode: 'JPY' }), '-500')
      assert.equal(moneyAmount({ amountMinor: -1, currencyCode: 'USD' }), '-0.01')
      assert.equal(moneyAmount({ amountMinor: -1250, currencyCode: 'BHD' }), '-1.250')
    })
  })

  describe('formatMoney and moneyAmount agree', () => {
    test('formatMoney contains the same digits as moneyAmount for each currency precision', () => {
      for (const currencyCode of ['USD', 'JPY', 'BHD']) {
        for (const amountMinor of [0, 1, 99, 1999, 123456]) {
          const money = { amountMinor, currencyCode }
          const digitsOnly = (value: string) => value.replace(/[^\d]/g, '')
          assert.equal(digitsOnly(formatMoney(money)), digitsOnly(moneyAmount(money)), `${currencyCode} ${amountMinor}`)
        }
      }
    })
  })

  describe('currency codes', () => {
    test('accepts lowercase currency codes', () => {
      assert.equal(formatMoney({ amountMinor: 1999, currencyCode: 'usd' }), '$19.99')
      assert.equal(moneyAmount({ amountMinor: 1999, currencyCode: 'usd' }), '19.99')
    })

    test('throws a RangeError for a malformed currency code', () => {
      assert.throws(() => formatMoney({ amountMinor: 100, currencyCode: 'NOT-A-CURRENCY' }), RangeError)
      assert.throws(() => moneyAmount({ amountMinor: 100, currencyCode: '' }), RangeError)
    })
  })

  describe('Edge cases and caching', () => {
    test('maintains consistent output across repeated calls with cached formatters', () => {
      const money = { amountMinor: 2499, currencyCode: 'USD' }
      assert.equal(formatMoney(money), '$24.99')
      assert.equal(formatMoney(money), '$24.99')
      assert.equal(moneyAmount(money), '24.99')
      assert.equal(moneyAmount(money), '24.99')
    })

    test('handles single whole-unit amounts with exact trailing zeros', () => {
      assert.equal(moneyAmount({ amountMinor: 100, currencyCode: 'USD' }), '1.00')
      assert.equal(formatMoney({ amountMinor: 100, currencyCode: 'USD' }), '$1.00')
      assert.equal(moneyAmount({ amountMinor: 1000, currencyCode: 'BHD' }), '1.000')
    })
  })
})
