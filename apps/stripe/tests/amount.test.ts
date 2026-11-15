import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { toStripeAmount } from '../src/amount'

describe('toStripeAmount', () => {
  test('two-decimal and zero-decimal currencies are sent as ShopNex keeps them', () => {
    assert.equal(toStripeAmount(1999, 'usd'), 1999)
    assert.equal(toStripeAmount(1000, 'JPY'), 1000)
    assert.equal(toStripeAmount(5000, 'krw'), 5000)
  })
  test('ISK and UGX are sent as two-decimal values ending in 00', () => {
    assert.equal(toStripeAmount(5, 'ISK'), 500)
    assert.equal(toStripeAmount(5, 'ugx'), 500)
  })
  test('three-decimal currencies must end in 0', () => {
    assert.equal(toStripeAmount(1230, 'BHD'), 1230)
    assert.throws(() => toStripeAmount(1234, 'bhd'), /multiples of 0\.010/)
  })
})
