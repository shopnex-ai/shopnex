// The one shipping method the app offers, chosen from CJ's freight options. The options are real ones CJ returned
// for a watch to the US and to Germany.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { FreightOption } from '@shopnex/cj-sdk'
import { daysOf, pickStandard, priceOf, toRate } from '../src/shipping'

const option = (logisticName: string, logisticPrice: number, logisticAging: string, totalPostageFee?: number) =>
  ({ logisticName, logisticPrice, logisticAging, totalPostageFee }) as FreightOption

const us = [
  option('CJPacket Sensitive Pro', 5.35, '5-11', 5.35),
  option('CJPacket Super Pure Electricity', 5.01, '5-11', 5.01),
  option('CJPacket Pure Electricity', 5.19, '7-14', 5.19),
  option('YunExpress Sensitive', 6.12, '4-7', 6.12),
  option('CJPacket Sensitive', 5.66, '4-9', 5.66),
  option('CJPacket FJTY Eub Special Line', 12.31, '15-25', 12.31),
]

// What CJ bills (totalPostageFee) is well above logisticPrice for some methods to Germany
const de = [
  option('CJPacket Eub Special Line', 5.56, '8-12', 5.56),
  option('CJPacket Sensitive', 4.82, '4-9', 10.62),
  option('CJPacket Fast Line', 4.96, '6-10', 10.76),
]

describe('prices and times', () => {
  test('what CJ bills is the price, not the base price', () => {
    assert.equal(priceOf(de[1]!), 10.62)
    assert.equal(priceOf(option('x', 3, '1-2')), 3, 'without a total, the base price')
  })

  test('delivery times, with unknown ones last', () => {
    assert.deepEqual(daysOf(option('x', 1, '5-11')), [5, 11])
    assert.deepEqual(daysOf(option('x', 1, '7')), [7, 7])
    assert.deepEqual(daysOf(option('x', 1, '')), [Infinity, Infinity])
  })
})

describe('pickStandard', () => {
  test('a balance of price and speed: neither the dearest nor the slowest', () => {
    const picked = pickStandard(us)!
    assert.notEqual(picked.logisticName, 'CJPacket FJTY Eub Special Line', 'dearest and slowest')
    // 4-7 days for 6.12 beats 5-11 days for 5.01 (the cheapest) and 4-9 days for 5.66: about 22% dearer than the
    // cheapest but far quicker, which is the best sum of "how much dearer" and "how much slower"
    assert.equal(picked.logisticName, 'YunExpress Sensitive')
  })

  test('judges by what CJ bills, so a cheap-looking method with fees is not picked', () => {
    // By base price "CJPacket Sensitive" is the cheapest to Germany (4.82); billed it is the dearest (10.62)
    assert.equal(pickStandard(de)!.logisticName, 'CJPacket Eub Special Line')
  })

  test('one option is the one; none is none', () => {
    assert.equal(pickStandard([us[0]!])!.logisticName, 'CJPacket Sensitive Pro')
    assert.equal(pickStandard([]), null)
  })

  test('methods without a name or a price are ignored', () => {
    assert.equal(pickStandard([option('', 5, '1-2'), { logisticName: 'x' } as FreightOption]), null)
    assert.equal(pickStandard([option('', 1, '1-2'), us[0]!])!.logisticName, 'CJPacket Sensitive Pro')
  })

  test('a method with no delivery time is not preferred over one that has it', () => {
    const picked = pickStandard([option('Unknown time', 5, ''), option('Known time', 5, '8-12')])!
    assert.equal(picked.logisticName, 'Known time')
  })
})

describe('toRate', () => {
  test('the buyer sees "Standard shipping" and the delivery time; CJ’s method is the code', () => {
    assert.deepEqual(toRate(us[4]!), {
      code: 'CJPacket Sensitive',
      name: 'Standard shipping',
      priceCents: 566,
      description: '4-9 days',
    })
  })

  test('the price is what CJ bills', () => {
    assert.equal(toRate(de[1]!).priceCents, 1062)
  })

  test('no delivery time, no description', () => {
    assert.equal(toRate(option('x', 2, '')).description, undefined)
  })
})
