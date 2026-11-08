// What an order has taken against what it should have: charged, refunded, refund on its way, and "overpaid". Pure
// arithmetic over the order's transactions (no database, no app), so every awkward case is cheap to pin down.
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { chargeSummary, type ChargeTransaction } from '@shopnex/orders'
import { closeDb } from '../lib'

after(closeDb)

const TOTAL = 5000
const sale = (amountCents = TOTAL, status: ChargeTransaction['status'] = 'success'): ChargeTransaction => ({
  kind: 'sale',
  status,
  amountCents,
})
const refund = (amountCents: number, status: ChargeTransaction['status'] = 'success'): ChargeTransaction => ({
  kind: 'refund',
  status,
  amountCents,
})
const order = (transactions: ChargeTransaction[], cancelled = false) =>
  chargeSummary({ totalCents: TOTAL, cancelledAt: cancelled ? new Date() : null, transactions })

describe('an order that is not overpaid', () => {
  test('unpaid, exactly paid and part paid', () => {
    assert.deepEqual(order([]), { chargedCents: 0, refundedCents: 0, refundPendingCents: 0, overpaidCents: 0 })
    assert.equal(order([sale()]).overpaidCents, 0)
    assert.equal(order([sale(2000)]).overpaidCents, 0, 'less than the total is underpaid, never overpaid')
  })

  test('a cancelled order that was never paid owes nothing and has taken nothing', () => {
    assert.equal(order([], true).overpaidCents, 0)
    assert.equal(order([sale(TOTAL, 'pending')], true).overpaidCents, 0)
  })

  test('a partial refund of a paid order leaves it paid, not overpaid', () => {
    const o = order([sale(), refund(1500)])
    assert.equal(o.refundedCents, 1500)
    assert.equal(o.overpaidCents, 0)
  })
})

describe('an order that is overpaid', () => {
  test('paid twice: the whole second payment is the overpayment', () => {
    const o = order([sale(), sale()])
    assert.equal(o.chargedCents, 2 * TOTAL)
    assert.equal(o.overpaidCents, TOTAL)
  })

  test('paid twice, then one payment refunded: exactly paid again', () => {
    assert.equal(order([sale(), sale(), refund(TOTAL)]).overpaidCents, 0)
    assert.equal(order([sale(), sale(), refund(2000)]).overpaidCents, TOTAL - 2000, 'a part refund leaves the rest')
  })

  test('paid more than the total in one go', () => {
    assert.equal(order([sale(TOTAL + 700)]).overpaidCents, 700)
  })

  test('captures count as money taken, authorizations and voids do not', () => {
    assert.equal(order([{ kind: 'authorization', status: 'success', amountCents: TOTAL }]).chargedCents, 0)
    assert.equal(order([{ kind: 'void', status: 'success', amountCents: TOTAL }]).chargedCents, 0)
    assert.equal(order([{ kind: 'capture', status: 'success', amountCents: TOTAL }, sale()]).overpaidCents, TOTAL)
  })

  test('a payment that did not succeed is not money taken', () => {
    assert.equal(order([sale(), sale(TOTAL, 'failure'), sale(TOTAL, 'error'), sale(TOTAL, 'pending')]).overpaidCents, 0)
  })
})

describe('a cancelled order that was paid', () => {
  test('until the refund is asked for, the money is held: overpaid by all of it', () => {
    assert.equal(order([sale()], true).overpaidCents, TOTAL)
  })

  test('a refund on its way (a payments app confirms later) is not shown as overpaid', () => {
    const o = order([sale(), refund(TOTAL, 'pending')], true)
    assert.equal(o.refundPendingCents, TOTAL)
    assert.equal(o.refundedCents, 0, 'not confirmed yet')
    assert.equal(o.overpaidCents, 0)
  })

  test('a confirmed refund settles it', () => {
    const o = order([sale(), refund(TOTAL)], true)
    assert.equal(o.refundedCents, TOTAL)
    assert.equal(o.overpaidCents, 0)
  })

  test('a refund that failed puts the money back on the books', () => {
    const o = order([sale(), refund(TOTAL, 'error')], true)
    assert.equal(o.refundPendingCents + o.refundedCents, 0)
    assert.equal(o.overpaidCents, TOTAL, 'flagged again so somebody notices')
  })

  test('paid twice and cancelled: both payments must come back', () => {
    assert.equal(order([sale(), sale(), refund(TOTAL)], true).overpaidCents, TOTAL, 'one of two refunded')
    assert.equal(order([sale(), sale(), refund(2 * TOTAL)], true).overpaidCents, 0)
  })
})

test('the cancellation date can be a string, as it is over the wire', () => {
  const o = chargeSummary({ totalCents: TOTAL, cancelledAt: '2026-11-08T10:00:00Z', transactions: [sale()] })
  assert.equal(o.overpaidCents, TOTAL)
})
