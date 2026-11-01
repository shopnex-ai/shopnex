import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { calculate, describeDiscount, taxRateFor, type PricingDiscount, type PricingInput } from '../src/calculate'

const base = {
  lines: [1000, 2000],
  shippingCents: 500,
  taxesIncluded: false,
  taxShipping: false,
} satisfies PricingInput
const percentage = (value: number, minSubtotalCents: number | null = null): PricingDiscount => ({
  code: 'P',
  type: 'percentage',
  value,
  minSubtotalCents,
})
const fixed = (value: number): PricingDiscount => ({ code: 'F', type: 'fixed_amount', value, minSubtotalCents: null })
const freeShipping: PricingDiscount = { code: 'S', type: 'free_shipping', value: 0, minSubtotalCents: null }
const vat = (ratePercent: number) => ({ name: 'VAT', ratePercent })

describe('calculate', () => {
  describe('without discount or tax', () => {
    test('total is subtotal plus shipping', () => {
      const r = calculate(base)
      assert.equal(r.subtotalCents, 3000)
      assert.equal(r.discountCents, 0)
      assert.equal(r.taxCents, 0)
      assert.deepEqual(r.taxLines, [])
      assert.equal(r.totalCents, 3500)
    })

    test('an empty cart has a zero subtotal', () => {
      const r = calculate({ ...base, lines: [], shippingCents: 0 })
      assert.equal(r.subtotalCents, 0)
      assert.equal(r.totalCents, 0)
    })
  })

  describe('percentage discount', () => {
    test('takes the percentage off every line', () => {
      const r = calculate({ ...base, discount: percentage(10) })
      assert.deepEqual(r.lineDiscountCents, [100, 200])
      assert.equal(r.discountCents, 300)
      assert.equal(r.totalCents, 3200)
    })

    test('rounds per line, not on the whole subtotal', () => {
      // 10% of 333 is 33.3 → 33 on each line (99), while 10% of 999 would round to 100
      const r = calculate({ ...base, lines: [333, 333, 333], shippingCents: 0, discount: percentage(10) })
      assert.deepEqual(r.lineDiscountCents, [33, 33, 33])
      assert.equal(r.discountCents, 99)
    })

    test('is clamped to 0–100%', () => {
      assert.equal(calculate({ ...base, discount: percentage(250) }).discountCents, 3000)
      assert.equal(calculate({ ...base, discount: percentage(-5) }).discountCents, 0)
    })

    test('never discounts shipping', () => {
      assert.equal(calculate({ ...base, discount: percentage(100) }).shippingDiscountCents, 0)
    })
  })

  describe('fixed amount discount', () => {
    test('allocates across lines so the parts add up', () => {
      const r = calculate({ ...base, lines: [1000, 1000, 1000], shippingCents: 0, discount: fixed(100) })
      assert.equal(
        r.lineDiscountCents.reduce((a, b) => a + b, 0),
        100,
      )
      assert.deepEqual(r.lineDiscountCents, [34, 33, 33])
    })

    test('gives the leftover cent to the line with the largest fraction', () => {
      // 100 split 1:2 is 33.33 / 66.67
      assert.deepEqual(calculate({ ...base, lines: [100, 200], discount: fixed(100) }).lineDiscountCents, [33, 67])
    })

    test('is capped at the subtotal', () => {
      const r = calculate({ ...base, lines: [500], discount: fixed(9999) })
      assert.equal(r.discountCents, 500)
      assert.equal(r.totalCents, 500)
    })

    test('a negative value discounts nothing', () => {
      assert.equal(calculate({ ...base, discount: fixed(-100) }).discountCents, 0)
    })
  })

  describe('free shipping discount', () => {
    test('discounts the shipping and nothing else', () => {
      const r = calculate({ ...base, shippingCents: 700, discount: freeShipping })
      assert.equal(r.shippingDiscountCents, 700)
      assert.deepEqual(r.lineDiscountCents, [0, 0])
      assert.equal(r.totalCents, 3000)
    })
  })

  describe('minimum subtotal', () => {
    test('a discount below its minimum is not applied', () => {
      const r = calculate({ ...base, discount: percentage(10, 5000) })
      assert.equal(r.discountApplicable, false)
      assert.equal(r.discountCents, 0)
      assert.equal(r.totalCents, 3500)
    })

    test('a subtotal exactly at the minimum qualifies', () => {
      const r = calculate({ ...base, discount: percentage(10, 3000) })
      assert.equal(r.discountApplicable, true)
      assert.equal(r.discountCents, 300)
    })

    test('no discount is always applicable', () => {
      assert.equal(calculate(base).discountApplicable, true)
    })
  })

  describe('tax', () => {
    test('exclusive tax is added on top', () => {
      const r = calculate({ ...base, lines: [1000], taxRate: vat(10) })
      assert.equal(r.taxCents, 100)
      assert.deepEqual(r.taxLines, [{ title: 'VAT', ratePercent: 10, amountCents: 100 }])
      assert.equal(r.totalCents, 1600)
    })

    test('inclusive tax is the part of the price that is tax and does not change the total', () => {
      const r = calculate({ ...base, lines: [1100], shippingCents: 0, taxRate: vat(10), taxesIncluded: true })
      assert.equal(r.taxCents, 100)
      assert.equal(r.totalCents, 1100)
      assert.equal(r.taxesIncluded, true)
    })

    test('shipping is only taxed when the shop says so', () => {
      const lines = { ...base, lines: [1000], taxRate: vat(10) }
      assert.equal(calculate(lines).taxCents, 100)
      const taxed = calculate({ ...lines, taxShipping: true })
      assert.equal(taxed.taxCents, 150)
      assert.equal(taxed.totalCents, 1650)
    })

    test('is computed after the discount', () => {
      const r = calculate({ ...base, lines: [1000], shippingCents: 0, discount: percentage(50), taxRate: vat(10) })
      assert.equal(r.taxCents, 50)
      assert.equal(r.totalCents, 550)
    })

    test('free shipping leaves no shipping to tax', () => {
      const r = calculate({ ...base, lines: [1000], taxRate: vat(10), taxShipping: true, discount: freeShipping })
      assert.equal(r.taxCents, 100)
    })

    test('rounds per line', () => {
      // 10% of 105 is 10.5 → 11 on each line (22); on the 210 subtotal it would be 21
      const r = calculate({ ...base, lines: [105, 105], shippingCents: 0, taxRate: vat(10) })
      assert.equal(r.taxCents, 22)
    })

    test('no rate, a zero rate or a missing rate means no tax lines', () => {
      for (const taxRate of [null, undefined, vat(0)]) {
        const r = calculate({ ...base, taxRate })
        assert.equal(r.taxCents, 0)
        assert.deepEqual(r.taxLines, [])
      }
    })
  })
})

describe('taxRateFor', () => {
  const rates = [
    { countryCode: 'US', province: null, name: 'US', ratePercent: 5 },
    { countryCode: 'US', province: 'CA', name: 'California', ratePercent: 8 },
    { countryCode: 'DE', province: null, name: 'DE', ratePercent: 19 },
  ]

  test('a province rate beats the country-wide rate', () => {
    assert.equal(taxRateFor(rates, { countryCode: 'US', province: 'CA' })?.name, 'California')
  })

  test('matches the province ignoring case and surrounding spaces', () => {
    assert.equal(taxRateFor(rates, { countryCode: 'US', province: ' ca ' })?.name, 'California')
  })

  test('falls back to the country-wide rate', () => {
    assert.equal(taxRateFor(rates, { countryCode: 'US', province: 'NY' })?.name, 'US')
    assert.equal(taxRateFor(rates, { countryCode: 'US' })?.name, 'US')
  })

  test('matches the country code in any case', () => {
    assert.equal(taxRateFor(rates, { countryCode: 'de' })?.name, 'DE')
  })

  test('is null for a country without a rate or without an address', () => {
    assert.equal(taxRateFor(rates, { countryCode: 'FR' }), null)
    assert.equal(taxRateFor(rates, null), null)
    assert.equal(taxRateFor(rates, undefined), null)
  })

  test('a province-only rate does not apply to other provinces', () => {
    assert.equal(taxRateFor([rates[1]!], { countryCode: 'US', province: 'NY' }), null)
  })
})

describe('describeDiscount', () => {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

  test('describes each type', () => {
    assert.equal(describeDiscount({ type: 'percentage', value: 20 }, money), '20% off')
    assert.equal(describeDiscount({ type: 'fixed_amount', value: 500 }, money), '$5.00 off')
    assert.equal(describeDiscount({ type: 'free_shipping', value: 0 }, money), 'Free shipping')
  })
})
