import type { Conn } from '@shopnex/db'
// Checkout: what the buyer can choose (flat rates with their free-shipping threshold, payment methods, live carrier rates that replace the flat
// ones), the totals with tax, and placing the order from the cart: in one transaction, once, with the price the shop quotes now.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, test } from 'node:test'
import { apps, shops } from '@shopnex/core/schema'
import * as fx from './fixtures'
import { carts, shippingRates } from '../src/cart.schema'
import { orderItems, orders, orderShippingLines } from '@shopnex/orders/schema'
import { products, productVariants } from '@shopnex/catalog/schema'

const { db, eq, cartService, SHOP } = fx
const { checkoutService, carrierService, CartError } = await import('../src')
const { taxService } = await import('@shopnex/pricing')

const refused = (code: string) => (e: unknown) => e instanceof CartError && e.code === code
const RETURN = { returnUrl: 'http://localhost:3000/checkout/return' }
const ADDRESS = checkoutService.toMailingAddress({
  firstName: 'Ada',
  lastName: 'Buyer',
  address1: '1 Main St',
  city: 'Paris',
  countryCode: 'fr',
  zip: '75001',
  province: 'IDF',
})
const variantOf = (p: Awaited<ReturnType<typeof fx.product>>) => p.variants[0]!.id
const view = async (token: string) => cartService.get(SHOP, token, db)

// ── a fake carrier app
let server: Server
let origin = ''
let carrierRates: { code: string; name: string; priceCents: number }[] = []
let carrierDown = false
let asked = 0

before(async () => {
  await fx.prepareDatabase()
  server = createServer((req, res) => {
    asked++
    req.resume()
    if (carrierDown) return res.writeHead(500).end('down')
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ rates: carrierRates }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
beforeEach(async () => {
  await fx.cleanup()
  carrierRates = []
  carrierDown = false
  asked = 0
})
after(async () => {
  await fx.cleanup()
  await new Promise((resolve) => server.close(resolve))
  await db.update(shops).set({ taxesIncluded: false, taxShipping: false }).where(eq(shops.id, SHOP))
})

async function withCarrier(name = 'Carrier') {
  const [app] = await db
    .insert(apps)
    .values({
      name,
      appUrl: `${origin}/app`,
      redirectUrls: [],
      scopes: ['write_shipping'],
      clientId: `app_c_${fx.unique()}`,
    })
    .returning()
  fx.trackApp(app!.id)
  return carrierService.configure(SHOP, app!.id, { name, ratesUrl: `${origin}/rates`, ready: true }, db)
}

describe('what the buyer can choose', () => {
  test('the active flat rates with their price for this subtotal (free above the threshold), and the active payment methods', async () => {
    await fx.shippingRate({ name: 'Standard', priceCents: 599, freeAboveCents: 5000 })
    await fx.shippingRate({ name: 'Off', priceCents: 1, active: false })
    const bank = await fx.manualMethod('Bank transfer')
    const below = await checkoutService.options(SHOP, 4999, db)
    assert.deepEqual(
      below.shippingRates.map((r) => [r.title, r.priceCents, r.freeAboveCents, r.carrier]),
      [['Standard', 599, 5000, null]],
    )
    assert.deepEqual(
      (await checkoutService.options(SHOP, 5000, db)).shippingRates.map((r) => r.priceCents),
      [0],
    )
    assert.deepEqual(below.paymentMethods, [
      { id: bank.id, name: 'Bank transfer', additionalDetails: null, offsite: false },
    ])
    assert.equal(below.liveRates, false)
  })

  test('a shop with nothing set up offers nothing', async () => {
    assert.deepEqual(await checkoutService.options(SHOP, 1000, db), {
      liveRates: false,
      shippingRates: [],
      paymentMethods: [],
    })
  })

  test('with a carrier service and a destination, its rates replace the flat ones; the flat ones return when it prices nothing', async () => {
    await fx.shippingRate({ name: 'Flat', priceCents: 599 })
    const service = await withCarrier('Fast Freight')
    const p = await fx.product()
    const c = await view((await fx.cart([{ variantId: variantOf(p), quantity: 1 }])).token)
    carrierRates = [{ code: 'air', name: 'Air', priceCents: 1200 }]
    const live = await checkoutService.options(SHOP, c.subtotalCents, db, { cart: c, address: { countryCode: 'FR' } })
    assert.equal(live.liveRates, true)
    assert.deepEqual(
      live.shippingRates.map((r) => [r.id, r.title, r.priceCents, r.carrier, r.freeAboveCents]),
      [[`carrier:${service.id}:air`, 'Air', 1200, 'Fast Freight', null]],
    )
    carrierRates = []
    assert.deepEqual(
      (
        await checkoutService.options(SHOP, c.subtotalCents, db, { cart: c, address: { countryCode: 'FR' } })
      ).shippingRates.map((r) => r.title),
      ['Flat'],
    )
  })

  test('before the address is known the carrier is not asked, but live rates are announced', async () => {
    await fx.shippingRate({ name: 'Flat', priceCents: 599 })
    await withCarrier()
    const c = await view((await fx.cart()).token)
    const o = await checkoutService.options(SHOP, 0, db, { cart: c })
    assert.deepEqual([o.liveRates, o.shippingRates.map((r) => r.title), asked], [true, ['Flat'], 0])
  })
})

describe('tax and totals', () => {
  test('the tax context is the shop’s settings and its rates, as the browser needs them to update totals', async () => {
    await taxService.create(SHOP, { countryCode: 'FR', province: null, name: 'VAT', ratePercent: 20 }, db)
    await db.update(shops).set({ taxesIncluded: true, taxShipping: true }).where(eq(shops.id, SHOP))
    assert.deepEqual(await checkoutService.taxContext(SHOP, db), {
      taxesIncluded: true,
      taxShipping: true,
      taxRates: [{ countryCode: 'FR', province: null, name: 'VAT', ratePercent: 20 }],
    })
    await db.update(shops).set({ taxesIncluded: false, taxShipping: false }).where(eq(shops.id, SHOP))
  })

  test('estimate: the first rate by default, the discount, and tax once there is an address; without one tax is unknown', async () => {
    await fx.shippingRate({ name: 'Standard', priceCents: 500 })
    await taxService.create(SHOP, { countryCode: 'FR', province: null, name: 'VAT', ratePercent: 20 }, db)
    const p = await fx.product({ priceCents: 10_000 })
    const d = await fx.discount({ type: 'percentage', value: 10 })
    const c = await cartService.setDiscountCode(
      SHOP,
      (await fx.cart([{ variantId: variantOf(p), quantity: 1 }])).token,
      d.code,
      db,
    )
    const noAddress = await checkoutService.estimate(SHOP, c, db)
    assert.deepEqual(
      [noAddress.subtotalCents, noAddress.shippingCents, noAddress.discountCents, noAddress.taxCents],
      [10_000, 500, 1000, null],
    )
    const withAddress = await checkoutService.estimate(SHOP, c, db, { address: { countryCode: 'FR' } })
    assert.equal(withAddress.taxCents, 1800, '20% of 10000 - 1000')
    assert.equal(withAddress.totalCents, 10_000 + 500 - 1000 + 1800)
    const elsewhere = await checkoutService.estimate(SHOP, c, db, { address: { countryCode: 'US' } })
    assert.equal(elsewhere.taxCents, 0)
  })

  test('estimate with a rate that is not on offer is INVALID_SHIPPING_RATE', async () => {
    await fx.shippingRate()
    const c = await view((await fx.cart()).token)
    await assert.rejects(
      checkoutService.estimate(SHOP, c, db, { shippingRateId: '00000000-0000-4000-8000-000000000000' }),
      refused('INVALID_SHIPPING_RATE'),
    )
  })

  test('toMailingAddress trims, upper-cases the country and turns blanks into null', () => {
    assert.deepEqual(
      checkoutService.toMailingAddress({
        firstName: ' ',
        lastName: ' Buyer ',
        address1: ' 1 Main ',
        city: ' Paris ',
        countryCode: 'fr',
        zip: '',
        company: 'ACME',
        phone: ' 555 ',
      }),
      {
        firstName: null,
        lastName: 'Buyer',
        company: 'ACME',
        address1: '1 Main',
        address2: null,
        city: 'Paris',
        province: null,
        countryCode: 'FR',
        zip: null,
        phone: '555',
      },
    )
  })
})

describe('placing the order', () => {
  async function ready() {
    const rate = await fx.shippingRate({ name: 'Standard', priceCents: 500 })
    const method = await fx.manualMethod()
    const p = await fx.product({ title: 'Tee', priceCents: 2000, variants: undefined })
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 2 }])
    return { rate, method, p, c }
  }
  const order = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!

  test('makes the order from the cart with its prices, the rate and the method, and completes the cart; a manual method is not paid yet', async () => {
    const { rate, method, c } = await ready()
    const placed = await checkoutService.complete(
      SHOP,
      c.token,
      {
        email: 'Buyer@Example.test',
        name: 'Ada Buyer',
        shippingAddress: ADDRESS,
        shippingRateId: rate.id,
        paymentMethodId: method.id,
        note: 'Gift',
      },
      RETURN,
      db,
    )
    assert.deepEqual([placed.alreadyCompleted, placed.paymentUrl, placed.paymentError], [false, null, null])
    const o = await order(placed.orderId)
    assert.deepEqual(
      [o.subtotalCents, o.shippingCents, o.totalCents, o.financialStatus, o.paymentGateway, o.note, o.channelId],
      [4000, 500, 4500, 'pending', 'manual', 'Gift', (await fx.onlineStore()).id],
    )
    assert.equal(o.email, 'buyer@example.test')
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id))
    assert.deepEqual([item?.title, item?.quantity, item?.unitPriceCents], ['Tee', 2, 2000])
    const done = await cartService.findByToken(SHOP, c.token, db)
    assert.deepEqual([done?.status, done?.orderId, done?.email], ['completed', o.id, 'buyer@example.test'])
  })

  test('the order belongs to the channel the cart was made on', async () => {
    const quiet = await fx.quietChannel()
    const { publicationService } = await import('@shopnex/channels')
    const p = await fx.product()
    await publicationService.set(SHOP, 'product', p.id, [{ channelId: quiet.id }], db)
    const c = await cartService.create(SHOP, quiet.id, db, [{ variantId: variantOf(p), quantity: 1 }])
    const placed = await checkoutService.complete(SHOP, c.token, { email: 'buyer@example.test' }, RETURN, db)
    assert.equal((await order(placed.orderId)).channelId, quiet.id)
  })

  test('defaults to the first shipping rate and the first payment method', async () => {
    const { rate, method, c } = await ready()
    const placed = await checkoutService.complete(SHOP, c.token, { email: 'buyer@example.test' }, RETURN, db)
    const o = await order(placed.orderId)
    assert.equal(o.shippingCents, 500)
    const lines = await db.select().from(orderShippingLines).where(eq(orderShippingLines.orderId, o.id))
    assert.deepEqual(
      lines.map((l) => [l.title, l.code]),
      [['Standard', rate.id]],
    )
    assert.equal(o.paymentMethodName, method.name)
  })

  test('a shop without shipping rates charges no shipping, and one without payment methods takes the order as manual', async () => {
    const p = await fx.product()
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 1 }])
    const placed = await checkoutService.complete(SHOP, c.token, { email: 'buyer@example.test' }, RETURN, db)
    assert.equal((await order(placed.orderId)).shippingCents, 0)
  })

  test('completing again answers with the same order and says so, and creates no second one', async () => {
    const { c } = await ready()
    const first = await checkoutService.complete(SHOP, c.token, { email: 'buyer@example.test' }, RETURN, db)
    const again = await checkoutService.complete(SHOP, c.token, { email: 'buyer@example.test' }, RETURN, db)
    assert.deepEqual(
      [again.orderId, again.orderNumber, again.alreadyCompleted],
      [first.orderId, first.orderNumber, true],
    )
    assert.equal((await db.select().from(orders).where(eq(orders.shopId, SHOP))).length, 1)
  })

  test('takes the stock for the order, and an item that sold out meanwhile makes the whole checkout fail with nothing placed', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 5 }] })
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 3 }])
    await db
      .update(productVariants)
      .set({ inventoryQuantity: 1 })
      .where(eq(productVariants.id, variantOf(p)))
    await assert.rejects(
      checkoutService.complete(SHOP, c.token, { email: 'buyer@example.test' }, RETURN, db),
      (e: unknown) => e instanceof Error,
    )
    assert.equal((await db.select().from(orders).where(eq(orders.shopId, SHOP))).length, 0)
    assert.equal((await cartService.findByToken(SHOP, c.token, db))?.status, 'active')
    await db
      .update(productVariants)
      .set({ inventoryQuantity: 5 })
      .where(eq(productVariants.id, variantOf(p)))
    await checkoutService.complete(SHOP, c.token, { email: 'buyer@example.test' }, RETURN, db)
    const [v] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantOf(p)))
    assert.equal(v?.inventoryQuantity, 2)
  })

  test('applies the cart’s discount code to the order', async () => {
    const { c } = await ready()
    const d = await fx.discount({ type: 'percentage', value: 25 })
    await cartService.setDiscountCode(SHOP, c.token, d.code, db)
    const placed = await checkoutService.complete(SHOP, c.token, { email: 'buyer@example.test' }, RETURN, db)
    const o = await order(placed.orderId)
    assert.deepEqual([o.discountCents, o.totalCents, o.discountCodes], [1000, 3500, [d.code]])
  })

  test('refuses: an empty cart, an unknown or expired cart, a cart whose product was archived or unpublished', async () => {
    const empty = await fx.cart()
    await assert.rejects(
      checkoutService.complete(SHOP, empty.token, { email: 'a@example.test' }, RETURN, db),
      refused('EMPTY_CART'),
    )
    await assert.rejects(
      checkoutService.complete(SHOP, 'cart_nope', { email: 'a@example.test' }, RETURN, db),
      refused('CART_NOT_FOUND'),
    )
    const p = await fx.product()
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 1 }])
    await db.update(products).set({ status: 'archived' }).where(eq(products.id, p.id))
    await assert.rejects(
      checkoutService.complete(SHOP, c.token, { email: 'a@example.test' }, RETURN, db),
      (e: unknown) =>
        e instanceof CartError && e.code === 'VARIANT_NOT_FOUND' && e.data.variantIds?.[0] === variantOf(p),
    )
    await db
      .update(carts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(carts.token, c.token))
    await assert.rejects(
      checkoutService.complete(SHOP, c.token, { email: 'a@example.test' }, RETURN, db),
      refused('CART_NOT_FOUND'),
    )
  })

  test('a shipping rate or payment method that is not on offer is refused, and a switched-off one is not on offer', async () => {
    const { rate, method, c } = await ready()
    const missing = '00000000-0000-4000-8000-000000000000'
    await assert.rejects(
      checkoutService.complete(SHOP, c.token, { email: 'a@example.test', shippingRateId: missing }, RETURN, db),
      refused('INVALID_SHIPPING_RATE'),
    )
    await assert.rejects(
      checkoutService.complete(SHOP, c.token, { email: 'a@example.test', paymentMethodId: missing }, RETURN, db),
      refused('INVALID_PAYMENT_METHOD'),
    )
    await db.update(shippingRates).set({ active: false }).where(eq(shippingRates.id, rate.id))
    await assert.rejects(
      checkoutService.complete(SHOP, c.token, { email: 'a@example.test', shippingRateId: rate.id }, RETURN, db),
      refused('INVALID_SHIPPING_RATE'),
    )
    assert.equal(method.active, true)
    assert.equal((await cartService.findByToken(SHOP, c.token, db))?.status, 'active')
  })
})

describe('placing the order with a carrier service', () => {
  async function cartForCarrier() {
    const service = await withCarrier()
    const p = await fx.product({ priceCents: 2000 })
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 1 }])
    return { service, c }
  }
  const to = { ...ADDRESS, countryCode: 'FR' }

  test('the order takes the carrier’s price as it is now, asked again at checkout, whatever the browser showed', async () => {
    const { service, c } = await cartForCarrier()
    carrierRates = [{ code: 'air', name: 'Air', priceCents: 1200 }]
    const shown = await checkoutService.options(SHOP, 2000, db, {
      cart: await view(c.token),
      address: { countryCode: 'FR' },
    })
    carrierRates = [{ code: 'air', name: 'Air', priceCents: 1500 }]
    const placed = await checkoutService.complete(
      SHOP,
      c.token,
      { email: 'a@example.test', shippingAddress: to, shippingRateId: shown.shippingRates[0]!.id },
      RETURN,
      db,
    )
    const [o] = await db.select().from(orders).where(eq(orders.id, placed.orderId))
    assert.deepEqual([o?.shippingCents, o?.totalCents], [1500, 3500])
    const [line] = await db.select().from(orderShippingLines).where(eq(orderShippingLines.orderId, placed.orderId))
    assert.deepEqual([line?.title, line?.code], ['Air', `carrier:${service.id}:air`])
  })

  test('with no rate chosen the cheapest of the carrier’s is taken', async () => {
    const { c } = await cartForCarrier()
    carrierRates = [
      { code: 'slow', name: 'Slow', priceCents: 900 },
      { code: 'fast', name: 'Fast', priceCents: 400 },
    ]
    const placed = await checkoutService.complete(
      SHOP,
      c.token,
      { email: 'a@example.test', shippingAddress: to },
      RETURN,
      db,
    )
    assert.equal((await db.select().from(orders).where(eq(orders.id, placed.orderId)))[0]?.shippingCents, 400)
  })

  test('a rate the carrier no longer offers is INVALID_SHIPPING_RATE', async () => {
    const { service, c } = await cartForCarrier()
    carrierRates = [{ code: 'air', name: 'Air', priceCents: 1200 }]
    await assert.rejects(
      checkoutService.complete(
        SHOP,
        c.token,
        { email: 'a@example.test', shippingAddress: to, shippingRateId: `carrier:${service.id}:gone` },
        RETURN,
        db,
      ),
      refused('INVALID_SHIPPING_RATE'),
    )
  })

  test('a carrier rate without an address to price it says to enter one', async () => {
    const { service, c } = await cartForCarrier()
    await assert.rejects(
      checkoutService.complete(
        SHOP,
        c.token,
        { email: 'a@example.test', shippingRateId: `carrier:${service.id}:air` },
        RETURN,
        db,
      ),
      (e: unknown) =>
        e instanceof CartError && e.code === 'INVALID_SHIPPING_RATE' && /Enter your address/.test(e.message),
    )
  })

  test('when carriers are installed but none can price this address, the order is not placed for free shipping', async () => {
    const { c } = await cartForCarrier()
    carrierRates = []
    await assert.rejects(
      checkoutService.complete(SHOP, c.token, { email: 'a@example.test', shippingAddress: to }, RETURN, db),
      (e: unknown) =>
        e instanceof CartError && e.code === 'INVALID_SHIPPING_RATE' && /can't ship to this address/.test(e.message),
    )
    assert.equal((await db.select().from(orders).where(eq(orders.shopId, SHOP))).length, 0)
  })

  test('a carrier that is down falls back to the shop’s flat rates', async () => {
    const flat = await fx.shippingRate({ name: 'Flat', priceCents: 700 })
    const { c } = await cartForCarrier()
    carrierDown = true
    const placed = await checkoutService.complete(
      SHOP,
      c.token,
      { email: 'a@example.test', shippingAddress: to, shippingRateId: flat.id },
      RETURN,
      db,
    )
    assert.equal((await db.select().from(orders).where(eq(orders.id, placed.orderId)))[0]?.shippingCents, 700)
  })
})
