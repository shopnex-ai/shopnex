// Discounts + taxes end to end: Admin API (token) → cart discount codes → checkout cost → placed orders.
// Uses its own codes, shipping rate and tax rates (in AQ / BV, so they never clash with a shop's real rates).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { orderService } from '@shopnex/orders'
import { PricingError, taxService } from '@shopnex/pricing'
import { updateShop } from '@shopnex/tenancy'
import { Fixtures, SHOP, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36).toUpperCase()
const code = (name: string) => `E2E${run}${name}`
const SHIPPING = 700
const tax = (cents: number, percent: number) => Math.round((cents * percent) / 100)
const includedTax = (cents: number, percent: number) => Math.round((cents * percent) / (100 + percent))

let cheap: { id: string; priceCents: number }
let pricey: { id: string; priceCents: number }
let shippingRateId: string
let auth: Record<string, string>

before(async () => {
  await requireApp()
  await fx.init()
  ;[cheap, pricey] = (await sellableVariants(2)) as [typeof cheap, typeof pricey]
  shippingRateId = (await fx.shippingRate(SHIPPING)).id
  auth = await fx.token(['write_discounts'])
  await updateShop(SHOP, { taxesIncluded: false, taxShipping: false })
})

after(async () => {
  await fx.cleanup()
  await closeDb()
})

const options = (cartId: string, query = '') =>
  call('GET', `/storefront/carts/${cartId}/checkout-options?shippingRateId=${shippingRateId}${query}`).then((r) =>
    ok(r),
  )

describe('admin discounts API', () => {
  const create = async (body: object, status = 200) => {
    const d = ok(await call('POST', '/admin/discounts', body, auth), status)
    if (status === 200) fx.discount(d.id)
    return d
  }

  test('creates codes of every type', async () => {
    await create({ code: code('10'), type: 'percentage', value: 10 })
    const min = await create({
      code: code('MIN'),
      type: 'fixed_amount',
      value: 500,
      minSubtotalCents: 1_000_000,
      endsAt: new Date(Date.now() + 86400e3).toISOString(),
    })
    assert.equal(typeof min.endsAt, 'string')
    const ship = await create({ code: code('SHIP'), type: 'free_shipping', value: 999 })
    assert.equal(ship.value, 0, 'free shipping carries no value')
    await create({ code: code('ONCE'), type: 'percentage', value: 20, oncePerCustomer: true })
    await create({
      code: code('OLD'),
      type: 'percentage',
      value: 10,
      startsAt: new Date(Date.now() - 2 * 86400e3).toISOString(),
      endsAt: new Date(Date.now() - 86400e3).toISOString(),
    })
  })

  test('rejects invalid input', async () => {
    await create({ code: code('10').toLowerCase(), type: 'percentage', value: 5 }, 409) // case-insensitive duplicate
    await create({ code: code('BAD'), type: 'percentage', value: 150 }, 400)
    await create({ code: `${code('X')} Y`, type: 'fixed_amount', value: 500 }, 400)
    const [d] = ok(await call('GET', '/admin/discounts', undefined, auth)).filter((d: any) => d.code === code('MIN'))
    // Partial update still checks the rules (500 isn't a valid percentage)
    ok(await call('PATCH', `/admin/discounts/${d.id}`, { type: 'percentage' }, auth), 400)
  })

  test('settings stay session-only', async () => {
    assert.ok((await call('GET', '/admin/tax-rates', undefined, auth)).status >= 400)
  })
})

describe('tax rates', () => {
  test('one rate per country / province', async () => {
    fx.taxRate((await taxService.create(SHOP, { countryCode: 'aq', province: '', name: 'AQ tax', ratePercent: 5 })).id)
    fx.taxRate(
      (await taxService.create(SHOP, { countryCode: 'AQ', province: 'Ross', name: 'Ross tax', ratePercent: 7.25 })).id,
    )
    fx.taxRate((await taxService.create(SHOP, { countryCode: 'BV', province: null, name: 'VAT', ratePercent: 19 })).id)
    await assert.rejects(
      taxService.create(SHOP, { countryCode: 'AQ', province: ' ross ', name: 'x', ratePercent: 1 }),
      (e) => e instanceof PricingError && e.code === 'TAX_RATE_EXISTS',
    )
  })
})

describe('cart and checkout', () => {
  test('percentage code: cart allocations, cost estimate, order totals', async () => {
    const lines = [pricey.priceCents * 2, cheap.priceCents]
    const subtotal = lines[0]! + lines[1]!
    const lineDiscounts = lines.map((l) => Math.round(l * 0.1))
    const discount = lineDiscounts[0]! + lineDiscounts[1]!

    let cart = await fx.cart(
      [
        { merchandiseId: pricey.id, quantity: 2 },
        { merchandiseId: cheap.id, quantity: 1 },
      ],
      'nope-not-a-code',
    )
    assert.deepEqual(cart.discountCodes, [{ code: 'nope-not-a-code', applicable: false }])
    assert.equal(cart.cost.totalAmount.amountMinor, subtotal)

    cart = ok(
      await call('PUT', `/storefront/carts/${cart.id}/discount-codes`, { discountCodes: [code('10').toLowerCase()] }),
    )
    assert.deepEqual(cart.discountCodes, [{ code: code('10'), applicable: true }])
    assert.equal(cart.discountAllocations[0].discountedAmount.amountMinor, discount)
    assert.equal(cart.cost.totalAmount.amountMinor, subtotal - discount)

    const noAddress = (await options(cart.id)).cost
    assert.equal(noAddress.totalTaxAmount, null, 'tax unknown without an address')
    assert.equal(noAddress.shippingAmount.amountMinor, SHIPPING)

    // Province rate wins (case-insensitive); per-line rounding; shipping untaxed
    const ross = (await options(cart.id, '&countryCode=AQ&province=ross')).cost
    const rossTax = tax(lines[0]! - lineDiscounts[0]!, 7.25) + tax(lines[1]! - lineDiscounts[1]!, 7.25)
    assert.equal(ross.totalTaxAmount.amountMinor, rossTax)
    assert.equal(ross.totalAmount.amountMinor, subtotal + SHIPPING - discount + rossTax)

    // Other provinces fall back to the country rate
    const other = (await options(cart.id, '&countryCode=AQ&province=Elsewhere')).cost
    assert.equal(
      other.totalTaxAmount.amountMinor,
      tax(lines[0]! - lineDiscounts[0]!, 5) + tax(lines[1]! - lineDiscounts[1]!, 5),
    )

    const placed = ok(await fx.complete(cart.id, { countryCode: 'AQ', province: 'Ross' }, shippingRateId))
    const order = (await orderService.getById(SHOP, placed.orderId))!
    assert.equal(order.totalCents, ross.totalAmount.amountMinor, 'order matches the estimate')
    assert.equal(order.discountCents, discount)
    assert.equal(order.taxCents, rossTax)
    assert.deepEqual(order.discountCodes, [code('10')])
    assert.deepEqual(order.taxLines, [{ title: 'Ross tax', ratePercent: 7.25, amountCents: rossTax }])
    assert.deepEqual(
      order.items.map((i) => i.discountCents).sort((a, b) => a - b),
      [...lineDiscounts].sort((a, b) => a - b),
    )
  })

  test('minimum subtotal and expiry make a code inapplicable; checkout refuses it', async () => {
    const min = await fx.cart([{ merchandiseId: cheap.id, quantity: 1 }], code('MIN'))
    assert.equal(min.discountCodes[0].applicable, false)
    const r = await fx.complete(min.id, { countryCode: 'AQ' }, shippingRateId)
    assert.equal(r.status, 400)
    assert.equal(r.body.data?.code, 'DISCOUNT_NOT_APPLICABLE')

    const old = await fx.cart([{ merchandiseId: cheap.id, quantity: 1 }], code('OLD'))
    assert.equal(old.discountCodes[0].applicable, false)
  })

  test('once per customer', async () => {
    const first = await fx.cart([{ merchandiseId: cheap.id, quantity: 1 }], code('ONCE'))
    ok(await fx.complete(first.id, { countryCode: 'AQ' }, shippingRateId))
    const second = await fx.cart([{ merchandiseId: cheap.id, quantity: 1 }], code('ONCE'))
    const r = await fx.complete(second.id, { countryCode: 'AQ' }, shippingRateId)
    assert.equal(r.status, 400, JSON.stringify(r.body))
    assert.match(r.body.message, /already used/)
  })

  test('prices include tax, taxed shipping, free shipping', async () => {
    await updateShop(SHOP, { taxesIncluded: true, taxShipping: true })
    const price = pricey.priceCents

    const free = await fx.cart([{ merchandiseId: pricey.id, quantity: 1 }], code('SHIP'))
    const freeCost = (await options(free.id, '&countryCode=BV')).cost
    assert.equal(freeCost.discountAmount.amountMinor, SHIPPING, 'shipping discounted away')
    assert.equal(freeCost.totalTaxAmount.amountMinor, includedTax(price, 19), 'tax extracted, none on free shipping')
    assert.equal(freeCost.totalAmount.amountMinor, price, 'tax not added on top')
    const order = (await orderService.getById(
      SHOP,
      ok(await fx.complete(free.id, { countryCode: 'BV' }, shippingRateId)).orderId,
    ))!
    assert.equal(order.totalCents, price)
    assert.equal(order.taxesIncluded, true)
    assert.equal(order.shippingLines[0]?.discountCents, SHIPPING)

    const taxedShipping = await fx.cart([{ merchandiseId: pricey.id, quantity: 1 }], code('10'))
    const cost = (await options(taxedShipping.id, '&countryCode=BV')).cost
    const lineDiscount = Math.round(price * 0.1)
    assert.equal(cost.totalTaxAmount.amountMinor, includedTax(price - lineDiscount, 19) + includedTax(SHIPPING, 19))
    assert.equal(cost.totalAmount.amountMinor, price - lineDiscount + SHIPPING)
  })
})
