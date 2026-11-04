// Shippo: live rates from the carriers on the merchant's Shippo account (USPS, UPS, FedEx, DHL…).
// https://docs.goshippo.com/shippoapi/public-api/ (create a shipment, read its rates; nothing is bought)
import type { Rate, RatesRequest } from '@shopnex/app'
import type { Origin, Parcel } from './config'

const API = 'https://api.goshippo.com'
const auth = (key: string) => ({ authorization: `ShippoToken ${key}` })

// ShopNex waits 5 seconds for the whole answer
const TIMEOUT_MS = 4500

/** "12.50" → 1250; null for anything that isn't a price */
export function toCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

/** A rate code part: lowercase letters, digits and dashes */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

/**
 * The items the shop ships itself. A product another app fulfills (fulfilledBy, e.g. CJ Dropshipping) is shipped
 * and priced by that app, so it is left out of the parcel.
 */
export const ownItems = (request: RatesRequest) => request.items.filter((i) => !i.fulfilledBy)

/** The shop's own items as one parcel: every item at the default weight */
export const parcelWeightOz = (request: RatesRequest, parcel: Parcel) =>
  Math.max(1, Math.round(ownItems(request).reduce((sum, i) => sum + i.quantity, 0) * parcel.itemWeightOz))

async function call(url: string, key: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...auth(key), ...(init.body ? { 'content-type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160) || res.statusText}`)
  return JSON.parse(text) as unknown
}

/** Throws unless Shippo accepts the token */
export async function verifyKey(key: string) {
  await call(`${API}/carrier_accounts?results=1`, key)
}

type ShippoRate = {
  provider: string
  servicelevel?: { name?: string; token?: string }
  amount: string
  currency: string
  estimated_days?: number | null
}

const address = (a: Record<string, string | null | undefined>) => ({
  name: a.name || undefined,
  street1: a.street1 || undefined,
  street2: a.street2 || undefined,
  city: a.city || undefined,
  state: a.state || undefined,
  zip: a.zip || undefined,
  country: a.country,
})

/**
 * Shippo's rates for the cart. A rate in another currency than the shop's is left out (no conversion). The code is
 * carrier + service, which stays the same between the quote and the order, so the price is matched again.
 */
export async function quoteRates(key: string, origin: Origin, parcel: Parcel, request: RatesRequest): Promise<Rate[]> {
  // Nothing in the cart ships from the shop: no parcel, no rates from here
  if (ownItems(request).length === 0) return []
  const to = request.destination
  const shipment = (await call(`${API}/shipments/`, key, {
    method: 'POST',
    body: JSON.stringify({
      async: false,
      address_from: address(origin),
      address_to: address({
        street1: to.address1,
        street2: to.address2,
        city: to.city,
        state: to.province,
        zip: to.zip,
        country: to.countryCode,
      }),
      parcels: [
        {
          weight: String(parcelWeightOz(request, parcel)),
          mass_unit: 'oz',
          length: String(parcel.lengthIn),
          width: String(parcel.widthIn),
          height: String(parcel.heightIn),
          distance_unit: 'in',
        },
      ],
    }),
  })) as { rates?: ShippoRate[] } | null

  const seen = new Set<string>()
  const rates: Rate[] = []
  for (const r of shipment?.rates ?? []) {
    const priceCents = toCents(r.amount)
    if (priceCents === null || r.currency?.toUpperCase() !== request.currency.toUpperCase()) continue
    const level = r.servicelevel
    const code = `${slug(r.provider)}:${slug(level?.token ?? level?.name ?? '')}`
    if (seen.has(code)) continue
    seen.add(code)
    rates.push({
      code,
      name: `${r.provider} ${level?.name ?? ''}`.trim(),
      priceCents,
      description: r.estimated_days ? `${r.estimated_days} day${r.estimated_days === 1 ? '' : 's'}` : undefined,
    })
  }
  return rates.sort((a, b) => a.priceCents - b.priceCents)
}
