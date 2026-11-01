// CJ's shipping prices at checkout, as a Shopnex carrier service. When the buyer has entered an address Shopnex
// asks what shipping costs for the cart; the app asks CJ's freight calculator and answers with one method,
// "Standard shipping": the best balance of price and speed among what CJ offers. The CJ method behind it is the
// rate's code, so the order is later sent to CJ with the method the buyer was quoted.
//
// What CJ can and can't price here (the merchant is told the same on the settings page):
//  - only carts made entirely of CJ products the app imported or linked: a mixed cart has no honest CJ price;
//  - only shops in USD: CJ prices in dollars and there is no conversion;
//  - always from China, at what CJ bills (`totalPostageFee`, which for some destinations is well above
//    `logisticPrice`).
import type { FreightOption } from '@shopnex/cj-sdk'
import type { Rate, RatesRequest, ShopContext } from '@shopnex/app'
import { cjFor } from './cj'
import type { Tables } from './db'

/** What CJ bills for one method, in dollars */
export const priceOf = (o: FreightOption) => o.totalPostageFee ?? o.logisticPrice

/** CJ's "5-11" (days) as [fastest, slowest]; unknown is last */
export function daysOf(o: FreightOption): [number, number] {
  const [from, to] = String(o.logisticAging ?? '')
    .split('-')
    .map((n) => Number.parseInt(n, 10))
  return Number.isFinite(from) ? [from!, Number.isFinite(to) ? to! : from!] : [Infinity, Infinity]
}

/**
 * The one method to offer: how much dearer and slower than the best of each, summed, lowest wins. A method CJ gives
 * no delivery time for counts as slow. Null when CJ offers nothing usable.
 */
export function pickStandard(options: FreightOption[]): FreightOption | null {
  const usable = options.filter((o) => o.logisticName && Number.isFinite(priceOf(o)) && priceOf(o) >= 0)
  if (usable.length === 0) return null
  const cheapest = Math.min(...usable.map(priceOf)) || 0.01
  const known = usable.map((o) => daysOf(o)[1]).filter(Number.isFinite)
  const quickest = known.length ? Math.max(Math.min(...known), 1) : 1
  const score = (o: FreightOption) =>
    priceOf(o) / cheapest + (Number.isFinite(daysOf(o)[1]) ? daysOf(o)[1] / quickest : 10)
  return usable.reduce((best, o) => {
    const [a, b] = [score(o), score(best)]
    return a < b || (a === b && priceOf(o) < priceOf(best)) ? o : best
  })
}

/** The Shopnex rate for a CJ method: the buyer never sees CJ's channel name, only the price and delivery time */
export function toRate(option: FreightOption): Rate {
  return {
    code: option.logisticName,
    name: 'Standard shipping',
    priceCents: Math.round(priceOf(option) * 100),
    description: option.logisticAging ? `${option.logisticAging} days` : undefined,
  }
}

// CJ allows one call a second and Shopnex asks again when the order is placed: remember answers for a while
const TTL_MS = 15 * 60_000
const cache = new Map<string, { at: number; rates: Rate[] }>()
const inFlight = new Map<string, Promise<Rate[]>>()

/** The rates for a cart, or none when CJ can't price it (see the top of this file) */
export async function quoteRates(shop: ShopContext, tables: Tables, request: RatesRequest): Promise<Rate[]> {
  if (request.currency !== 'USD') {
    console.warn(`[cj] shipping prices need a USD shop (this one is ${request.currency})`)
    return []
  }
  // Every item must be a CJ variant the app knows; the same variant twice adds up
  const quantities = new Map<string, number>()
  for (const item of request.items) {
    const mapped = item.sku ? tables.findVariant(shop, item.sku) : undefined
    if (!mapped) return []
    quantities.set(mapped.vid, (quantities.get(mapped.vid) ?? 0) + item.quantity)
  }
  if (quantities.size === 0) return []
  const products = [...quantities]
    .map(([vid, quantity]) => ({ vid, quantity }))
    .sort((a, b) => a.vid.localeCompare(b.vid))

  const { countryCode, zip } = request.destination
  const key = [
    shop.instance,
    shop.shopId,
    countryCode,
    zip ?? '',
    products.map((p) => `${p.vid}x${p.quantity}`).join(','),
  ].join('|')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rates
  const pending = inFlight.get(key)
  if (pending) return pending

  const run = (async () => {
    const { cj } = await cjFor(shop)
    const freight = await cj.logistics.calculateFreight({
      startCountryCode: 'CN',
      endCountryCode: countryCode,
      zip: zip ?? undefined,
      products,
    })
    if (freight.error) throw new Error(freight.error)
    const standard = pickStandard(freight.data ?? [])
    const rates = standard ? [toRate(standard)] : []
    cache.set(key, { at: Date.now(), rates })
    return rates
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, run)
  return run
}
