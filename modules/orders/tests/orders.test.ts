import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { OrderError } from '../src/errors'
import { shippingPrice } from '../src/orders'

describe('shippingPrice', () => {
  const rate = { priceCents: 599, freeAboveCents: 5000 }

  test('charges the rate below the free-shipping threshold', () => {
    assert.equal(shippingPrice(rate, 4999), 599)
  })

  test('is free at exactly the threshold and above it', () => {
    assert.equal(shippingPrice(rate, 5000), 0)
    assert.equal(shippingPrice(rate, 12000), 0)
  })

  test('always charges when the rate has no threshold', () => {
    assert.equal(shippingPrice({ priceCents: 599, freeAboveCents: null }, 1_000_000), 599)
  })

  test('a zero threshold makes every order free, even an empty one', () => {
    assert.equal(shippingPrice({ priceCents: 599, freeAboveCents: 0 }, 0), 0)
  })

  test('a free rate stays free', () => {
    assert.equal(shippingPrice({ priceCents: 0, freeAboveCents: null }, 100), 0)
  })
})

describe('OrderError', () => {
  test('carries its code, message and data', () => {
    const e = new OrderError('OUT_OF_STOCK', 'Only 2 left', { variantId: 'v1', available: 2 })
    assert.ok(e instanceof Error)
    assert.equal(e.name, 'OrderError')
    assert.equal(e.code, 'OUT_OF_STOCK')
    assert.equal(e.message, 'Only 2 left')
    assert.deepEqual(e.data, { variantId: 'v1', available: 2 })
  })

  test('data defaults to empty', () => {
    assert.deepEqual(new OrderError('EMPTY_ORDER', 'No lines').data, {})
  })
})
