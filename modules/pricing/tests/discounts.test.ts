import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { unavailableReason } from '../src/discounts'
import { PricingError } from '../src/errors'

const now = new Date('2026-06-15T12:00:00Z')
const discount = (patch: Record<string, unknown> = {}) =>
  ({
    code: 'SAVE10',
    active: true,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    usageCount: 0,
    ...patch,
  }) as Parameters<typeof unavailableReason>[0]

describe('unavailableReason', () => {
  test('an active discount without limits can be used', () => {
    assert.equal(unavailableReason(discount(), now), null)
  })

  test('an inactive discount cannot', () => {
    assert.match(unavailableReason(discount({ active: false }), now)!, /"SAVE10" isn't active/)
  })

  test('it is not usable before it starts', () => {
    assert.match(unavailableReason(discount({ startsAt: new Date('2026-06-16T00:00:00Z') }), now)!, /isn't active/)
  })

  test('it is usable from the moment it starts', () => {
    assert.equal(unavailableReason(discount({ startsAt: now }), now), null)
  })

  test('it stops at its end date, exactly', () => {
    assert.equal(unavailableReason(discount({ endsAt: new Date('2026-06-15T12:00:01Z') }), now), null)
    assert.match(unavailableReason(discount({ endsAt: now }), now)!, /isn't active/)
    assert.match(unavailableReason(discount({ endsAt: new Date('2026-06-01T00:00:00Z') }), now)!, /isn't active/)
  })

  test('the usage limit is reached when the count equals it', () => {
    assert.equal(unavailableReason(discount({ usageLimit: 5, usageCount: 4 }), now), null)
    assert.match(unavailableReason(discount({ usageLimit: 5, usageCount: 5 }), now)!, /usage limit/)
    assert.match(unavailableReason(discount({ usageLimit: 5, usageCount: 9 }), now)!, /usage limit/)
  })

  test('a limit of zero is never usable', () => {
    assert.match(unavailableReason(discount({ usageLimit: 0 }), now)!, /usage limit/)
  })
})

describe('PricingError', () => {
  test('carries its code and name', () => {
    const e = new PricingError('CODE_TAKEN', 'taken')
    assert.ok(e instanceof Error)
    assert.equal(e.code, 'CODE_TAKEN')
    assert.equal(e.name, 'PricingError')
    assert.equal(e.message, 'taken')
  })
})
