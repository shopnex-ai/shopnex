// Payments apps (like Shopify's Payments Apps API): the contract between a Shopnex instance and an app that
// takes payments (Stripe, a local bank…).
//
//   1. The app registers its payment method for the shop: POST /api/v1/admin/payments-app/configure
//      (scope write_payment_sessions) with its session URLs.
//   2. At checkout, Shopnex POSTs a signed PaymentSessionRequest to `paymentSessionUrl`. The app answers
//      200 { redirectUrl } and Shopnex sends the buyer there to pay.
//   3. When the provider confirms (or declines), the app calls
//      POST /api/v1/admin/payment-sessions/{id}/resolve  { externalId? }
//      POST /api/v1/admin/payment-sessions/{id}/reject   { reason }
//      Both are idempotent. The amount is Shopnex's, never the app's.
//   4. Refunds: Shopnex POSTs a RefundSessionRequest to `refundSessionUrl` (answer 2xx right away), and the app
//      resolves / rejects the session the same way once the provider has refunded.
//
// Requests are signed with the instance's key (see ./signed-request). WebCrypto only, so it runs in Node 20+,
// edge runtimes and browsers.
import type { KeyResolver, Signer } from './keys'
import { signInstanceRequest, verifyInstanceRequest } from './signed-request'

export type Money = { cents: number; currency: string }

export type PaymentSessionRequest = {
  kind: 'payment'
  /** Resolve / reject this id */
  id: string
  /** The Shopnex instance's public origin: its keys sign this request, its Admin API takes the outcome */
  instance: string
  shopId: string
  orderId: string
  /** Shown to the buyer as "#1001" */
  orderNumber: number
  amount: Money
  customer: { email: string; name: string | null }
  /** Send the buyer back here after paying (or giving up): it shows the order and its payment status */
  returnUrl: string
  /** Shopnex stops waiting then (rejects the session and cancels the unpaid order); end the provider's session by it */
  expiresAt: string
}

export type RefundSessionRequest = {
  kind: 'refund'
  id: string
  instance: string
  shopId: string
  orderId: string
  orderNumber: number
  amount: Money
  /** The payment being refunded: the session that paid it and the externalId it was resolved with */
  payment: { sessionId: string | null; externalId: string | null }
  expiresAt: string
}

export type PaymentsAppRequest = PaymentSessionRequest | RefundSessionRequest

/** What the app answers to a PaymentSessionRequest */
export type PaymentSessionResponse = { redirectUrl: string }

/** Instance side: headers for one request with this exact body */
export const signPaymentsRequest = (signer: Signer, id: string, body: string, now = new Date()) =>
  signInstanceRequest(signer, id, body, 'Shopnex-Payments/1.0', now)

/**
 * App side: checks the signature (with the keys of the instance the body names) and that it's under 5 minutes
 * old, and returns the parsed request, or null. Pass the raw body text, not re-serialized JSON.
 */
export const verifyPaymentsRequest = (
  headers: Headers,
  body: string,
  options: { keys: KeyResolver; toleranceSeconds?: number },
) => verifyInstanceRequest<PaymentsAppRequest>(headers, body, options)
