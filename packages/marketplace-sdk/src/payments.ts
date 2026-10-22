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
// Requests are signed like Standard Webhooks with an asymmetric key (webhook-id / webhook-timestamp /
// webhook-signature: v1a,…): the instance signs with its own Ed25519 key; the app checks it against the keys
// the instance named in the body's `instance` publishes (createJwksResolver). Nothing per install is shared.
// WebCrypto only, so it runs in Node 20+, edge runtimes and browsers.
import { sign, verify, type KeyResolver, type Signer } from './keys'

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

const KEY_ID_HEADER = 'shopnex-key-id'

/** Instance side: headers for one request with this exact body */
export async function signPaymentsRequest(signer: Signer, id: string, body: string, now = new Date()) {
  const timestamp = String(Math.floor(now.getTime() / 1000))
  return {
    'content-type': 'application/json',
    'user-agent': 'Shopnex-Payments/1.0',
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': 'v1a,' + (await sign(signer.key, `${id}.${timestamp}.${body}`)),
    [KEY_ID_HEADER]: signer.kid,
  }
}

/**
 * App side: checks the signature (with the keys of the instance the body names) and that it's under 5 minutes
 * old, and returns the parsed request, or null. Pass the raw body text, not re-serialized JSON.
 */
export async function verifyPaymentsRequest(
  headers: Headers,
  body: string,
  { keys, toleranceSeconds = 300 }: { keys: KeyResolver; toleranceSeconds?: number },
): Promise<PaymentsAppRequest | null> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatures = headers.get('webhook-signature')
  if (!id || !timestamp || !signatures) return null
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return null
  let request: PaymentsAppRequest
  try {
    request = JSON.parse(body) as PaymentsAppRequest
  } catch {
    return null
  }
  // The body is only trusted once the instance it names has signed it
  if (typeof request?.instance !== 'string') return null
  const key = await keys(request.instance, headers.get(KEY_ID_HEADER) ?? undefined)
  if (!key) return null
  const message = `${id}.${timestamp}.${body}`
  for (const s of signatures.split(' ')) {
    if (s.startsWith('v1a,') && (await verify(key, message, s.slice(4)))) return request
  }
  return null
}
