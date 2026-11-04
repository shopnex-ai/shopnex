import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import type { RatesRequest } from '@shopnex/app'
import { DEFAULT_PARCEL } from '../src/config'
import { ownItems, parcelWeightOz, quoteRates, slug, toCents, verifyKey } from '../src/shippo'

const request = (currency = 'USD'): RatesRequest => ({
  kind: 'rates',
  id: 'r1',
  instance: 'https://shop.example.com',
  shopId: 's1',
  currency,
  destination: {
    countryCode: 'US',
    province: 'CA',
    city: 'Fresno',
    zip: '93650',
    address1: '1 Main St',
    address2: null,
  },
  items: [{ sku: 'a', fulfilledBy: null, title: 'Mug', quantity: 3, priceCents: 1500 }],
  subtotalCents: 4500,
})
const origin = { name: 'Demo', street1: '2 Dock Rd', city: 'Oakland', state: 'CA', zip: '94607', country: 'US' }

const realFetch = globalThis.fetch
afterEach(() => (globalThis.fetch = realFetch))
function mockFetch(answer: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(answer), { status })
  }) as typeof fetch
  return calls
}

describe('helpers', () => {
  test('prices', () => {
    assert.equal(toCents('12.50'), 1250)
    assert.equal(toCents('x'), null)
    assert.equal(toCents('-1'), null)
  })
  test('slug and weight', () => {
    assert.equal(slug('UPS Ground Saver®'), 'ups-ground-saver')
    assert.equal(parcelWeightOz(request(), DEFAULT_PARCEL), 24, '3 items at 8 oz')
  })
})

describe('quoteRates', () => {
  test('sends the parcel and maps rates, cheapest first; other currencies are left out', async () => {
    const calls = mockFetch({
      rates: [
        {
          provider: 'UPS',
          servicelevel: { name: 'Ground', token: 'ups_ground' },
          amount: '11.20',
          currency: 'USD',
          estimated_days: 1,
        },
        {
          provider: 'USPS',
          servicelevel: { name: 'Priority Mail', token: 'usps_priority' },
          amount: '8.45',
          currency: 'USD',
          estimated_days: 2,
        },
        { provider: 'DHL', servicelevel: { name: 'Express', token: 'dhl_express' }, amount: '30.00', currency: 'EUR' },
      ],
    })
    const rates = await quoteRates('tok', origin, DEFAULT_PARCEL, request())
    assert.deepEqual(rates, [
      { code: 'usps:usps-priority', name: 'USPS Priority Mail', priceCents: 845, description: '2 days' },
      { code: 'ups:ups-ground', name: 'UPS Ground', priceCents: 1120, description: '1 day' },
    ])
    const sent = JSON.parse(String(calls[0]!.init.body))
    assert.equal(sent.parcels[0].weight, '24')
    assert.equal(sent.address_to.country, 'US')
    assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, 'ShippoToken tok')
  })

  test('products another app fulfills are left out of the parcel', async () => {
    const calls = mockFetch({ rates: [] })
    const mixed = request()
    mixed.items.push({ sku: 'CJ-1', fulfilledBy: 'app_cj_dropshipping', title: 'Lamp', quantity: 5, priceCents: 900 })
    assert.deepEqual(
      ownItems(mixed).map((i) => i.sku),
      ['a'],
    )
    assert.equal(parcelWeightOz(mixed, DEFAULT_PARCEL), 24, 'only the 3 mugs')
    await quoteRates('tok', origin, DEFAULT_PARCEL, mixed)
    assert.equal(JSON.parse(String(calls[0]!.init.body)).parcels[0].weight, '24')
  })

  test('a cart with nothing the shop ships gets no rates and no call to Shippo', async () => {
    const calls = mockFetch({ rates: [] })
    const cj = request()
    cj.items = [{ sku: 'CJ-1', fulfilledBy: 'app_cj_dropshipping', title: 'Lamp', quantity: 1, priceCents: 900 }]
    assert.deepEqual(await quoteRates('tok', origin, DEFAULT_PARCEL, cj), [])
    assert.equal(calls.length, 0)
  })

  test('an API error throws', async () => {
    mockFetch({ detail: 'Invalid token' }, 401)
    await assert.rejects(quoteRates('bad', origin, DEFAULT_PARCEL, request()), /401/)
    await assert.rejects(verifyKey('bad'), /401/)
  })
})
