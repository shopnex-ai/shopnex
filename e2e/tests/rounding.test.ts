// Rounding in the money path: tax, shipping tax and discounts each round per line (calculate.ts), and the cart
// estimate, the placed order and its tax line agree to the cent. Every line costs 105¢ and the shipping 105¢, so
// each rate below lands on exactly half a cent, where rounding per line and rounding once per order differ.
// Uses its own tax rates in HM and TF, which no real shop ships to.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { db } from '@shopnex/db'
import { orderService } from '@shopnex/orders'
import { taxService } from '@shopnex/pricing'
import { updateShop } from '@shopnex/tenancy'
import { Fixtures, SHOP, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36).toUpperCase()
const code = (name: string) => `E2E${run}R${name}`
const PRICE = 105
const SHIPPING = 105

let variants: { id: string }[]
let shippingRateId: string

before(async () => {
  await requireApp()
  await fx.init()
  variants = await sellableVariants(3)
  for (const v of variants) await fx.price(v.id, PRICE)
  shippingRateId = (await fx.shippingRate(SHIPPING)).id
  fx.taxRate(
    (await taxService.create(SHOP, { countryCode: 'HM', province: null, name: 'HM tax', ratePercent: 10 }, db)).id,
  )
  fx.taxRate(
    (await taxService.create(SHOP, { countryCode: 'TF', province: null, name: 'TF VAT', ratePercent: 20 }, db)).id,
  )
  const auth = await fx.token(['write_discounts'])
  for (const body of [
    { code: code('10'), type: 'percentage', value: 10 },
    { code: code('100'), type: 'fixed_amount', value: 100 },
  ]) {
    fx.discount(ok(await call('POST', '/admin/discounts', body, auth)).id)
  }
})

after(async () => {
  await fx.cleanup()
  await closeDb()
})

const lines = (n: number) => variants.slice(0, n).map((v) => ({ merchandiseId: v.id, quantity: 1 }))
const options = (cartId: string, countryCode: string) =>
  call(
    'GET',
    `/storefront/carts/${cartId}/checkout-options?shippingRateId=${shippingRateId}&countryCode=${countryCode}`,
  ).then((r) => ok(r).cost)

/** Places the cart and checks that the order matches the checkout estimate */
async function place(cartId: string, countryCode: string, estimate: { totalAmount: { amountMinor: number } }) {
  const placed = ok(await fx.complete(cartId, { countryCode }, shippingRateId))
  const order = (await orderService.getById(SHOP, placed.orderId, db))!
  assert.equal(order.totalCents, estimate.totalAmount.amountMinor, 'the order charges what checkout showed')
  return order
}

describe('rounding', () => {
  test('tax on top rounds per line, half a cent up: 11 + 11 on the lines and 11 on shipping', async () => {
    await updateShop(SHOP, { taxesIncluded: false, taxShipping: true })
    const cart = await fx.cart(lines(2))
    const cost = await options(cart.id, 'HM')
    // 10% of 105¢ is 10.5¢ → 11¢, three times; one rounding over 315¢ would give 32¢, not 33¢
    assert.equal(cost.totalTaxAmount.amountMinor, 33)
    assert.equal(cost.totalAmount.amountMinor, 210 + 105 + 33)

    const order = await place(cart.id, 'HM', cost)
    assert.equal(order.totalCents, 348)
    assert.equal(order.taxCents, 33)
    assert.deepEqual(order.taxLines, [{ title: 'HM tax', ratePercent: 10, amountCents: 33 }])
  })

  test('tax included rounds per line too: 18 + 18 inside the price, and the total is the price', async () => {
    await updateShop(SHOP, { taxesIncluded: true, taxShipping: false })
    const cart = await fx.cart(lines(2))
    const cost = await options(cart.id, 'TF')
    // The tax inside 105¢ at 20% is 105 × 20 / 120 = 17.5¢ → 18¢; over 210¢ at once it would be 35¢
    assert.equal(cost.totalTaxAmount.amountMinor, 36)
    assert.equal(cost.totalAmount.amountMinor, 210 + 105, 'included tax is not added on top')

    const order = await place(cart.id, 'TF', cost)
    assert.equal(order.taxCents, 36)
    assert.equal(order.totalCents, 315)
  })

  test('a percentage code rounds per line before tax: 11 + 11 off, then 9 + 9 tax', async () => {
    await updateShop(SHOP, { taxesIncluded: false, taxShipping: false })
    const cart = await fx.cart(lines(2), code('10'))
    // 10% of 105¢ is 10.5¢ → 11¢ off each line (21¢ if rounded once); the tax is on 94¢: 9.4¢ → 9¢
    assert.equal(cart.discountAllocations[0].discountedAmount.amountMinor, 22)
    const cost = await options(cart.id, 'HM')
    assert.equal(cost.totalTaxAmount.amountMinor, 18)
    assert.equal(cost.totalAmount.amountMinor, 210 - 22 + 105 + 18)

    const order = await place(cart.id, 'HM', cost)
    assert.equal(order.discountCents, 22)
    assert.deepEqual(
      order.items.map((i) => i.discountCents),
      [11, 11],
    )
    assert.equal(order.taxCents, 18)
  })

  test('a fixed code is split to the cent: 100¢ over three equal lines is 34 + 33 + 33', async () => {
    await updateShop(SHOP, { taxesIncluded: false, taxShipping: false })
    const cart = await fx.cart(lines(3), code('100'))
    assert.equal(cart.discountAllocations[0].discountedAmount.amountMinor, 100)
    const cost = await options(cart.id, 'HM')
    // Tax on 71¢ and 72¢ twice: 7.1, 7.2, 7.2 → 7 each
    assert.equal(cost.totalTaxAmount.amountMinor, 21)
    assert.equal(cost.totalAmount.amountMinor, 315 - 100 + 105 + 21)

    const order = await place(cart.id, 'HM', cost)
    assert.equal(order.discountCents, 100)
    assert.deepEqual(
      order.items.map((i) => i.discountCents).sort((a, b) => b - a),
      [34, 33, 33],
      'no cent lost or added when the code is split',
    )
  })
})
