// Carrier services (like Shopify's CarrierService API): an app that quotes shipping rates at checkout, from a
// carrier's live prices instead of the shop's flat rates.
//
//   1. The app registers itself for the shop: POST /api/v1/admin/carrier-services/configure
//      (scope write_shipping) with its rates URL.
//   2. Once the buyer's address is known, ShopNex POSTs a signed RatesRequest to `ratesUrl`. The app answers
//      200 { rates: [...] } within a few seconds; a slow, failing or invalid answer just means no rates from it.
//   3. The buyer picks one. When the order is placed ShopNex asks again and uses the app's price for that
//      `code`, so a price from the browser is never trusted.
//
// Requests are signed exactly like payments requests (Standard Webhooks, the instance's Ed25519 key), so an app
// verifies them the same way: see ./payments. WebCrypto only.
import type { KeyResolver, Signer } from './keys'
import { signInstanceRequest, verifyInstanceRequest } from './signed-request'

export type RatesRequest = {
  kind: 'rates'
  /** Unique per request */
  id: string
  /** The ShopNex instance's public origin: its keys sign this request */
  instance: string
  shopId: string
  /** The shop's currency: prices in the request and the answer are in it, in cents */
  currency: string
  /** Where the order ships to. Fields the buyer hasn't filled in yet are null. */
  destination: {
    countryCode: string
    province: string | null
    city: string | null
    zip: string | null
    address1: string | null
    address2: string | null
  }
  items: {
    sku: string | null
    /**
     * Client id of the app that fulfills this product (a dropshipping app such as app_cj_dropshipping), or null when
     * the shop ships it itself. A carrier app quotes the items it ships and leaves the rest to others.
     */
    fulfilledBy: string | null
    title: string
    quantity: number
    /** Price of one unit, after nothing but the shop's own price */
    priceCents: number
  }[]
  subtotalCents: number
}

export type Rate = {
  /** Stable within the app, e.g. "usps-plus": the buyer's choice is matched on it when the order is placed */
  code: string
  /** Shown at checkout, e.g. "USPS+ (2-5 days)" */
  name: string
  priceCents: number
  /** Shown under the name */
  description?: string
}

/** What the app answers to a RatesRequest */
export type RatesResponse = { rates: Rate[] }

/** Instance side: headers for one request with this exact body */
export const signRatesRequest = (signer: Signer, id: string, body: string, now = new Date()) =>
  signInstanceRequest(signer, id, body, 'Shopnex-Shipping/1.0', now)

/**
 * App side: checks the signature (with the keys of the instance the body names) and that it's under 5 minutes
 * old, and returns the parsed request, or null. Pass the raw body text, not re-serialized JSON.
 */
export async function verifyRatesRequest(
  headers: Headers,
  body: string,
  options: { keys: KeyResolver; toleranceSeconds?: number },
): Promise<RatesRequest | null> {
  const request = await verifyInstanceRequest<RatesRequest>(headers, body, options)
  return request?.kind === 'rates' ? request : null
}
