// How much money an order has actually taken, set against what it should have taken. Derived from the transactions each
// time rather than stored, so it can't drift from them. Pure: no database, so every case is cheap to test.
import type { TransactionKind, TransactionStatus } from '@shopnex/db/schema'

export type ChargeTransaction = { kind: TransactionKind; status: TransactionStatus; amountCents: number }

export type ChargeSummary = {
  /** Money taken: successful sales and captures */
  chargedCents: number
  /** Money given back and confirmed */
  refundedCents: number
  /** Refunds asked for but not confirmed yet (a payments app reports them later) */
  refundPendingCents: number
  /**
   * Money held beyond what the order should have taken, as of now: charged − refunds (confirmed or on their way) −
   * what is owed. A cancelled order owes nothing, so a paid one that was cancelled shows as overpaid until its refund
   * is on its way, and again if that refund fails. 0 when the order is exactly paid, part paid or unpaid.
   */
  overpaidCents: number
}

export function chargeSummary(order: {
  totalCents: number
  cancelledAt: Date | string | null
  transactions: readonly ChargeTransaction[]
}): ChargeSummary {
  let chargedCents = 0
  let refundedCents = 0
  let refundPendingCents = 0
  for (const t of order.transactions) {
    if ((t.kind === 'sale' || t.kind === 'capture') && t.status === 'success') chargedCents += t.amountCents
    else if (t.kind === 'refund' && t.status === 'success') refundedCents += t.amountCents
    else if (t.kind === 'refund' && t.status === 'pending') refundPendingCents += t.amountCents
  }
  const owedCents = order.cancelledAt ? 0 : order.totalCents
  const overpaidCents = Math.max(0, chargedCents - refundedCents - refundPendingCents - owedCents)
  return { chargedCents, refundedCents, refundPendingCents, overpaidCents }
}
