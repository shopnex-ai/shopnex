// Carrier services end to end, against a fake carrier app served by this test: configure (app token) → checkout
// asks the app for rates with a signed request once there is an address → the buyer picks a live rate → the
// order is placed with the app's price, asked for again at that moment. Uses its own app (deleted at the end).
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import { appService } from '@shopnex/apps'
import { db, schema } from '@shopnex/db'
import { createJwksResolver } from '@shopnex/marketplace-sdk/keys'
import { verifyRatesRequest, type RatesRequest } from '@shopnex/marketplace-sdk/shipping'
import { Fixtures, SHOP, appToken, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()

let server: Server
let appUrl: string
let appId: string
let auth: Record<string, string>
const keys = createJwksResolver({ allowHttp: true })
let variant: { id: string; priceCents: number; sku?: string | null }

// What the fake carrier received, and what it answers
const received: RatesRequest[] = []
let ratesAnswer: () => { status: number; body: unknown } = () => ({ status: 200, body: { rates: [] } })

before(async () => {
  await requireApp()
  await fx.init()
  ;[variant] = (await sellableVariants(1)) as [typeof variant]

  server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = await verifyRatesRequest(new Headers(req.headers as Record<string, string>), body, { keys })
    if (!request) return res.writeHead(401).end('bad signature')
    received.push(request)
    const answer = ratesAnswer()
    res.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const { app, privateKey } = await appService.registerApp(
    { name: `E2E carrier ${Date.now()}`, appUrl: `${appUrl}/app`, redirectUrls: [], scopes: ['write_shipping'] },
    null,
  )
  appId = app.id
  await appService.installManaged({
    appId,
    shopId: SHOP,
    userId: null as unknown as string,
    scopes: ['write_shipping'],
  })
  auth = { authorization: `Bearer ${await appToken(app.clientId, privateKey, { shop_id: SHOP })}` }
})

after(async () => {
  await fx.cleanup()
  // The app owns its carrier service, installation and token
  if (appId) await db.delete(schema.apps).where(eq(schema.apps.id, appId))
  server?.close()
  await closeDb()
})

const configure = (body: object, headers = auth) => call('POST', '/admin/carrier-services/configure', body, headers)
const serviceBody = (ready = true) => ({ name: 'E2E carrier', ratesUrl: `${appUrl}/rates`, ready })
const quote = (usd: number) => ({
  status: 200,
  body: { rates: [{ code: 'fast', name: 'Fast (2-5 days)', priceCents: usd * 100, description: 'Tracked' }] },
})
const address = { countryCode: 'US', city: 'Somewhere', zip: '12345', address1: '1 Main St' }
const query = new URLSearchParams(address).toString()

async function options(cartId: string, withAddress = true) {
  return ok(await call('GET', `/storefront/carts/${cartId}/checkout-options${withAddress ? `?${query}` : ''}`))
}
type Rate = { id: string; title: string; description?: string | null; price: { amountMinor: number } }
const carrierRates = (o: { shippingRates: Rate[] }) => o.shippingRates.filter((r) => r.id.startsWith('carrier:'))

describe('carrier service: configure', () => {
  test('rejects rates URLs off the app origin and tokens without an app', async () => {
    ok(await configure({ ...serviceBody(), ratesUrl: 'https://evil.example.com/rates' }), 400)
    ok(await configure(serviceBody(), await fx.token(['write_shipping'])), 403)
    ok(await configure(serviceBody(), await fx.token(['write_orders'])), 403)
  })

  test('a service that is not ready is not asked', async () => {
    ok(await configure(serviceBody(false)))
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    received.length = 0
    ratesAnswer = () => quote(7)
    assert.equal(carrierRates(await options(cart.id)).length, 0)
    assert.equal(received.length, 0)
  })

  test('configure again updates the same service', async () => {
    const first = ok(await configure(serviceBody(false)))
    const again = ok(await configure(serviceBody(true)))
    assert.equal(again.id, first.id)
    assert.equal(again.ready, true)
  })
})

describe('carrier service: quoting', () => {
  test('no address, no request: only the shop’s own rates', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    received.length = 0
    assert.equal(carrierRates(await options(cart.id, false)).length, 0)
    assert.equal(received.length, 0)
  })

  test('with an address the app gets a signed request and its rates are offered', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 2 }])
    received.length = 0
    ratesAnswer = () => quote(9)
    const rates = carrierRates(await options(cart.id))
    assert.equal(rates.length, 1)
    assert.equal(rates[0]!.title, 'Fast (2-5 days)')
    assert.equal(rates[0]!.description, 'Tracked')
    assert.equal(rates[0]!.price.amountMinor, 900)
    const request = received.at(-1)!
    assert.equal(request.shopId, SHOP)
    assert.equal(request.destination.countryCode, 'US')
    assert.equal(request.destination.zip, '12345')
    assert.equal(request.items[0]?.quantity, 2)
    assert.equal(request.subtotalCents, variant.priceCents * 2)
  })

  test('a failing, slow or invalid app means no rates, not a broken checkout', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    for (const answer of [
      () => ({ status: 500, body: { error: 'down' } }),
      () => ({ status: 200, body: { nope: true } }),
      () => ({
        status: 200,
        body: {
          rates: [
            { code: 'x', name: 'Negative', priceCents: -5 },
            { code: '', name: 'No code', priceCents: 1 },
          ],
        },
      }),
    ]) {
      ratesAnswer = answer
      assert.equal(carrierRates(await options(cart.id)).length, 0)
    }
  })
})

// A carrier app that prices the cart replaces the shop's own flat rates; when it can't (no rates for this cart or
// destination) the flat rates are what is on offer.
describe('carrier service: replaces the shop’s own rates', () => {
  let flatId: string
  before(async () => {
    flatId = (await fx.shippingRate(500)).id
  })

  const complete = (cartId: string, shippingRateId?: string) =>
    call('POST', `/storefront/carts/${cartId}/complete`, {
      email: fx.email,
      shippingRateId,
      shippingAddress: { lastName: 'Tester', ...address },
    })
  const shippingOf = async (orderId: string) => {
    const [line] = await db
      .select()
      .from(schema.orderShippingLines)
      .where(eq(schema.orderShippingLines.orderId, orderId))
    return line!
  }
  const ids = (o: { shippingRates: { id: string }[] }) => o.shippingRates.map((r) => r.id)

  test('the carrier prices the cart: only its rates are offered', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => quote(9)
    const offered = ids(await options(cart.id))
    assert.ok(offered.length > 0)
    assert.ok(
      offered.every((id) => id.startsWith('carrier:')),
      'no flat rate next to the carrier’s',
    )
  })

  test('the carrier can’t price it: the flat rates are offered, as before', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => ({ status: 200, body: { rates: [] } })
    const offered = ids(await options(cart.id))
    assert.ok(offered.includes(flatId))
    assert.ok(!offered.some((id) => id.startsWith('carrier:')))
    // No address yet: nobody was asked, the flat rates are offered
    assert.ok(ids(await options(cart.id, false)).includes(flatId))
  })

  test('placing the order follows the same rule', async () => {
    // The carrier prices the cart: a flat rate is no longer a choice, and no choice means the carrier’s first rate
    const priced = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => quote(9)
    ok(await complete(priced.id, flatId), 400)
    const [rate] = (await options(priced.id)).shippingRates as Rate[]
    const byDefault = ok(await complete(priced.id))
    fx.order(byDefault.orderId)
    const line = await shippingOf(byDefault.orderId)
    assert.equal(line.priceCents, 900)
    assert.equal(line.code, rate!.id)

    // The carrier can’t price it: the flat rate works, a carrier’s rate doesn’t
    const unpriced = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => ({ status: 200, body: { rates: [] } })
    ok(await complete(unpriced.id, rate!.id), 400)
    const flat = ok(await complete(unpriced.id, flatId))
    fx.order(flat.orderId)
    assert.equal((await shippingOf(flat.orderId)).priceCents, 500)
  })
})

// A shop whose shipping comes from carrier apps charges for it: nothing offered means no order, not free shipping.
// The shop's own flat rates are switched off for these tests and switched back on afterwards.
describe('carrier service: nothing to ship with', () => {
  let switchedOff: string[] = []
  before(async () => {
    const rates = await db
      .select({ id: schema.shippingRates.id })
      .from(schema.shippingRates)
      .where(and(eq(schema.shippingRates.shopId, SHOP), eq(schema.shippingRates.active, true)))
    switchedOff = rates.map((r) => r.id)
    if (switchedOff.length) {
      await db.update(schema.shippingRates).set({ active: false }).where(inArray(schema.shippingRates.id, switchedOff))
    }
  })
  after(async () => {
    if (switchedOff.length) {
      await db.update(schema.shippingRates).set({ active: true }).where(inArray(schema.shippingRates.id, switchedOff))
    }
  })

  const complete = (cartId: string, shippingRateId?: string) =>
    call('POST', `/storefront/carts/${cartId}/complete`, {
      email: fx.email,
      shippingRateId,
      shippingAddress: { lastName: 'Tester', ...address },
    })

  test('no rate offered for the address: the order is refused, not shipped free', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => ({ status: 200, body: { rates: [] } })
    assert.equal(carrierRates(await options(cart.id)).length, 0)
    const refused = ok(await complete(cart.id), 400)
    assert.match(refused.message, /can't ship to this address/i)
  })

  test('no rate chosen although the app offers some: the first is used, like a first flat rate', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => quote(9)
    const [rate] = carrierRates(await options(cart.id))
    const placed = ok(await complete(cart.id))
    fx.order(placed.orderId)
    const [line] = await db
      .select()
      .from(schema.orderShippingLines)
      .where(eq(schema.orderShippingLines.orderId, placed.orderId))
    assert.equal(line!.priceCents, 900)
    assert.equal(line!.code, rate!.id)
  })
})

describe('carrier service: placing the order', () => {
  async function place(cartId: string, shippingRateId: string | undefined, withAddress = true) {
    return call('POST', `/storefront/carts/${cartId}/complete`, {
      email: fx.email,
      shippingRateId,
      shippingAddress: withAddress ? { lastName: 'Tester', ...address } : undefined,
    })
  }
  const shippingOf = async (orderId: string) => {
    const [line] = await db
      .select()
      .from(schema.orderShippingLines)
      .where(eq(schema.orderShippingLines.orderId, orderId))
    return line!
  }

  test('the price is the app’s answer at that moment, not the one the buyer saw', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => quote(9)
    const rate = carrierRates(await options(cart.id))[0]!
    ratesAnswer = () => quote(12)
    const placed = ok(await place(cart.id, rate.id))
    fx.order(placed.orderId)
    const line = await shippingOf(placed.orderId)
    assert.equal(line.priceCents, 1200)
    assert.equal(line.title, 'Fast (2-5 days)')
    assert.equal(line.code, rate.id)
  })

  test('a rate the app no longer offers, or without an address, is refused', async () => {
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => quote(9)
    const rate = carrierRates(await options(cart.id))[0]!
    ok(await place(cart.id, rate.id, false), 400)
    ratesAnswer = () => ({ status: 200, body: { rates: [{ code: 'other', name: 'Other', priceCents: 100 }] } })
    ok(await place(cart.id, rate.id), 400)
    ok(await place(cart.id, 'carrier:00000000-0000-0000-0000-000000000000:fast'), 400)
    ok(await place(cart.id, 'carrier:garbage'), 400)
  })

  test('staff can switch the service off; uninstalling the app removes it', async () => {
    const [service] = await db.select().from(schema.carrierServices).where(eq(schema.carrierServices.appId, appId))
    assert.ok(service)
    await db.update(schema.carrierServices).set({ active: false }).where(eq(schema.carrierServices.id, service.id))
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    ratesAnswer = () => quote(9)
    assert.equal(carrierRates(await options(cart.id)).length, 0)
    await db.update(schema.carrierServices).set({ active: true }).where(eq(schema.carrierServices.id, service.id))
    assert.equal(carrierRates(await options(cart.id)).length, 1)

    const [installation] = await db
      .select()
      .from(schema.appInstallations)
      .where(eq(schema.appInstallations.appId, appId))
    await appService.uninstall(SHOP, installation!.id)
    const left = await db.select().from(schema.carrierServices).where(eq(schema.carrierServices.appId, appId))
    assert.equal(left.length, 0)
  })
})
