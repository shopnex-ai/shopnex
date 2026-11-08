// Stock end to end: an order takes stock, a cancel with restock gives it back, nobody can buy what is not there,
// two buyers racing for the last unit get one order between them, and one shop's variant id does nothing in
// another shop. Uses its own tracked product and removes it at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { variantService } from '@shopnex/catalog'
import { db, schema } from '@shopnex/db'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36)

let admin: Record<string, string>
let shippingRateId: string
const productIds: string[] = []

/** A product with one tracked variant holding `stock` units */
async function tracked(stock: number) {
  const created = ok(
    await call(
      'POST',
      '/admin/products',
      { title: `E2E stock ${run}-${productIds.length}`, variants: [{ priceCents: 1000, inventoryQuantity: stock }] },
      admin,
    ),
  )
  productIds.push(created.id)
  return created.variants[0].id as string
}

const stockOf = async (variantId: string) => {
  const [row] = await db
    .select({ stock: schema.productVariants.inventoryQuantity })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.id, variantId))
  return row!.stock
}

const place = async (variantId: string, quantity = 1) => {
  const cart = await fx.cart([{ merchandiseId: variantId, quantity }])
  return fx.complete(cart.id, { countryCode: 'US' }, shippingRateId)
}

before(async () => {
  await requireApp()
  await fx.init()
  admin = await fx.token(['write_products', 'write_orders'])
  shippingRateId = (await fx.shippingRate(0)).id
})

after(async () => {
  await fx.cleanup()
  if (productIds.length) await db.delete(schema.products).where(inArray(schema.products.id, productIds))
  await closeDb()
})

describe('stock', () => {
  test('an order takes stock; cancelling with restock gives it back', async () => {
    const variantId = await tracked(5)
    const placed = await place(variantId, 2)
    assert.equal(placed.status, 200, JSON.stringify(placed.body))
    assert.equal(await stockOf(variantId), 3)

    ok(await call('POST', `/admin/orders/${placed.body.orderId}/cancel`, { reason: 'customer', restock: true }, admin))
    assert.equal(await stockOf(variantId), 5)
  })

  test('cancelling without restock leaves the stock taken', async () => {
    const variantId = await tracked(4)
    const placed = await place(variantId, 1)
    assert.equal(placed.status, 200, JSON.stringify(placed.body))

    ok(await call('POST', `/admin/orders/${placed.body.orderId}/cancel`, { reason: 'customer', restock: false }, admin))
    assert.equal(await stockOf(variantId), 3)
  })

  test('more than is in stock is refused and nothing is taken', async () => {
    const variantId = await tracked(2)
    // The cart already refuses more than is left
    const refused = await call('POST', '/storefront/carts', { lines: [{ merchandiseId: variantId, quantity: 3 }] })
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.equal(refused.body.code, 'OUT_OF_STOCK')
    assert.equal(await stockOf(variantId), 2)
  })

  test('stock that drops after the cart was made is refused at checkout and nothing is taken', async () => {
    const variantId = await tracked(2)
    const cart = await fx.cart([{ merchandiseId: variantId, quantity: 2 }])
    await db
      .update(schema.productVariants)
      .set({ inventoryQuantity: 1 })
      .where(eq(schema.productVariants.id, variantId))

    const refused = await fx.complete(cart.id, { countryCode: 'US' }, shippingRateId)
    assert.equal(refused.status, 400, JSON.stringify(refused.body))
    assert.equal(await stockOf(variantId), 1)
  })

  test('two buyers racing for the last unit: one order, stock is 0, never negative', async () => {
    const variantId = await tracked(1)
    const [a, b] = await Promise.all([
      fx.cart([{ merchandiseId: variantId, quantity: 1 }]),
      fx.cart([{ merchandiseId: variantId, quantity: 1 }]),
    ])
    const results = await Promise.all([
      fx.complete(a.id, { countryCode: 'US' }, shippingRateId),
      fx.complete(b.id, { countryCode: 'US' }, shippingRateId),
    ])
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)))
    assert.equal(await stockOf(variantId), 0)
  })

  test('another shop’s variant id takes and gives back nothing', async () => {
    const variantId = await tracked(3)
    const other = await fx.shop()
    assert.equal(await variantService.reserveStock(other.id, variantId, 1), false)
    await variantService.restock(other.id, variantId, 5)
    assert.equal(await stockOf(variantId), 3)
    // and the owner's own shop still can
    assert.equal(await variantService.reserveStock(SHOP, variantId, 1), true)
    assert.equal(await stockOf(variantId), 2)
  })
})
