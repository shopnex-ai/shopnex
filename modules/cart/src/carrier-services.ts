// Carrier services (Shopify CarrierService): apps that quote shipping rates at checkout. An app registers
// itself for a shop (configure); once the buyer's address is known, `quote` asks every active, ready service for
// rates with a signed request (see @shopnex/marketplace-sdk/shipping). A slow, failing or invalid answer only
// means no rates from that app: the shop's flat rates and the other apps still show.
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { instanceSigner, instanceUrl, serverUrl } from '@shopnex/apps'
import { db, schema, type Conn } from '@shopnex/db'
import { signRatesRequest, type RatesRequest } from '@shopnex/marketplace-sdk/shipping'
import { CartError } from './errors'

// Checkout waits for these, so keep it short
const TIMEOUT_MS = 5000
const MAX_RATES_PER_SERVICE = 20
// 1,000,000.00 in any currency: a guard against a broken app, not a business rule
const MAX_PRICE_CENTS = 100_000_000
const MAX_RESPONSE_BYTES = 256 * 1024

/** What the rate id of a carrier rate looks like: carrier:{service id}:{the app's code} */
const PREFIX = 'carrier:'
export const isCarrierRateId = (id: string) => id.startsWith(PREFIX)
const rateId = (serviceId: string, code: string) => `${PREFIX}${serviceId}:${code}`

export type ConfigureInput = {
  /** Shown at checkout next to the rates, e.g. "CJ Dropshipping" (staff can rename it) */
  name: string
  ratesUrl: string
  /** false: hidden at checkout (e.g. the merchant hasn't finished connecting the carrier) */
  ready: boolean
}

const origin = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * Creates or updates the app's carrier service in this shop. The rates URL must be on the app's own origin (its
 * registered app URL), so an app can't point Shopnex at someone else's server. Staff's name and switch stay.
 */
export async function configure(shopId: string, appId: string, input: ConfigureInput) {
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId))
  if (!app) throw new CartError('NOT_A_CARRIER_APP', 'Only an installed app can configure a carrier service')
  const appOrigin = origin(app.appUrl)
  if (!appOrigin || origin(input.ratesUrl) !== appOrigin) {
    throw new CartError('INVALID_RATES_URL', `The rates URL must be on the app's origin (${appOrigin})`)
  }
  const [existing] = await db
    .select()
    .from(schema.carrierServices)
    .where(and(eq(schema.carrierServices.shopId, shopId), eq(schema.carrierServices.appId, appId)))
  if (existing) {
    const [service] = await db
      .update(schema.carrierServices)
      .set({ ratesUrl: input.ratesUrl, ready: input.ready, updatedAt: new Date() })
      .where(eq(schema.carrierServices.id, existing.id))
      .returning()
    return service!
  }
  const [service] = await db
    .insert(schema.carrierServices)
    .values({ shopId, appId, name: input.name, ratesUrl: input.ratesUrl, ready: input.ready })
    .returning()
  return service!
}

export async function list(shopId: string, opts: { usableOnly?: boolean } = {}, conn: Conn = db) {
  return conn
    .select()
    .from(schema.carrierServices)
    .where(
      and(
        eq(schema.carrierServices.shopId, shopId),
        opts.usableOnly ? eq(schema.carrierServices.active, true) : undefined,
        opts.usableOnly ? eq(schema.carrierServices.ready, true) : undefined,
      ),
    )
    .orderBy(asc(schema.carrierServices.createdAt))
}

/** Staff: rename or switch off. Null when the service isn't in this shop. */
export async function update(shopId: string, id: string, patch: { name?: string; active?: boolean }) {
  const [service] = await db
    .update(schema.carrierServices)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.carrierServices.shopId, shopId), eq(schema.carrierServices.id, id)))
    .returning()
  return service ?? null
}

export type QuoteInput = Pick<RatesRequest, 'currency' | 'destination' | 'items' | 'subtotalCents'>

export type CarrierRate = {
  /** carrier:{service id}:{code}: what the buyer picks and checkout sends back */
  id: string
  title: string
  priceCents: number
  description: string | null
  /** The carrier service's name */
  carrier: string
}

// Signed with this instance's key; the app checks it against our published keys (`instance` in the body)
async function post(url: string, request: RatesRequest) {
  const body = JSON.stringify(request)
  const res = await fetch(serverUrl(url), {
    method: 'POST',
    headers: await signRatesRequest(await instanceSigner(), request.id, body),
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200) || res.statusText}`)
  if (text.length > MAX_RESPONSE_BYTES) throw new Error('The answer is too large')
  return JSON.parse(text) as unknown
}

/** Rates from one service; anything wrong with the app or its answer gives none */
async function quoteService(
  service: { id: string; name: string; ratesUrl: string },
  shopId: string,
  input: QuoteInput,
): Promise<CarrierRate[]> {
  try {
    const answer = (await post(service.ratesUrl, {
      kind: 'rates',
      id: randomUUID(),
      instance: await instanceUrl(),
      shopId,
      ...input,
    })) as { rates?: unknown } | null
    if (!Array.isArray(answer?.rates)) throw new Error('The app answered without rates')
    const seen = new Set<string>()
    const rates: CarrierRate[] = []
    for (const r of answer.rates.slice(0, MAX_RATES_PER_SERVICE)) {
      const { code, name, priceCents, description } = (r ?? {}) as Record<string, unknown>
      if (typeof code !== 'string' || !code || code.length > 100 || seen.has(code)) continue
      if (typeof name !== 'string' || !name.trim() || name.length > 200) continue
      if (!Number.isInteger(priceCents) || (priceCents as number) < 0 || (priceCents as number) > MAX_PRICE_CENTS)
        continue
      seen.add(code)
      rates.push({
        id: rateId(service.id, code),
        title: name.trim(),
        priceCents: priceCents as number,
        description: typeof description === 'string' && description.trim() ? description.trim().slice(0, 300) : null,
        carrier: service.name,
      })
    }
    return rates
  } catch (error) {
    console.error(`[shipping] ${service.name} (${shopId}):`, error instanceof Error ? error.message : error)
    return []
  }
}

/** Rates from every active, ready carrier service, cheapest first. Needs a destination country at least. */
export async function quote(shopId: string, input: QuoteInput): Promise<CarrierRate[]> {
  if (!input.destination.countryCode) return []
  const services = await list(shopId, { usableOnly: true })
  const rates = (await Promise.all(services.map((s) => quoteService(s, shopId, input)))).flat()
  return rates.sort((a, b) => a.priceCents - b.priceCents)
}
