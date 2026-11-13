// Unpaid orders that nobody is paying (a bank transfer, or a payments app that was down at checkout) have no payment
// session to expire, so they used to hold their stock until the merchant cancelled them by hand. A shop can now set
// a number of hours after which the expiry worker cancels them and puts the stock back on sale.
//
// Everything happens in a second, throwaway shop: the worker cancels every stale unpaid order of a shop whose limit is
// set, so turning it on for the default shop could cancel real orders in the dev database.
import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { checkoutSettings } from '@shopnex/cart'
import { db, schema } from '@shopnex/db'
import { OrderError, orderService } from '@shopnex/orders'
import { paymentService } from '@shopnex/payments'
import { getShopById, updateShop } from '@shopnex/tenancy'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36)
const STOCK = 20

let shopId: string
let admin: Record<string, string>
let storefront: Record<string, string>
let productId: string
let variantId: string
let methodId: string
let rateId: string
let seq = 0

before(async () => {
  await requireApp()
  await fx.init()
  shopId = (await fx.shop()).id
  admin = await fx.token(['read_products', 'write_products', 'read_orders', 'write_orders'], shopId)
  storefront = { 'x-shopnex-key': (await fx.storefrontKey(shopId)).token }
  methodId = (
    await checkoutSettings.createPaymentMethod(shopId, {
      name: 'E2E bank transfer',
      additionalDetails: null,
      instructions: 'Transfer the total to IBAN E2E-0000',
      active: true,
    })
  ).id
  rateId = (
    await checkoutSettings.createShippingRate(shopId, {
      name: 'E2E shipping',
      priceCents: 300,
      freeAboveCents: null,
      active: true,
    })
  ).id
  const product = ok(await call('POST', '/admin/products', { title: `E2E unpaid ${run}`, priceCents: 1500 }, admin))
  productId = product.id
  variantId = product.variants[0].id
  ok(await call('PATCH', `/admin/variants/${variantId}`, { inventoryQuantity: STOCK }, admin))
})

// Each case starts from a full shelf and no limit: whatever it ordered is cancelled (and restocked) afterwards
afterEach(async () => {
  await updateShop(shopId, { unpaidOrderExpiryHours: null })
  const open = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.shopId, shopId))
  for (const { id } of open) {
    await orderService.cancel(shopId, id, { reason: 'other', restock: true }).catch(() => {})
  }
  await db.delete(schema.orders).where(eq(schema.orders.shopId, shopId))
  ok(await call('PATCH', `/admin/variants/${variantId}`, { inventoryQuantity: STOCK }, admin))
})

after(async () => {
  await fx.cleanup() // removes the shop and everything in it
  await closeDb()
})

/** A buyer with no account checks out on the storefront and picks the bank transfer */
async function place(quantity: number) {
  const cart = ok(
    await call('POST', '/storefront/carts', { lines: [{ merchandiseId: variantId, quantity }] }, storefront),
  )
  const done = ok(
    await call(
      'POST',
      `/storefront/carts/${cart.id}/complete`,
      {
        email: `e2e-unpaid-${++seq}-${run}@example.com`,
        paymentMethodId: methodId,
        shippingRateId: rateId,
        shippingAddress: {
          lastName: 'Tester',
          address1: '1 Main St',
          city: 'Somewhere',
          countryCode: 'AQ',
          province: 'Ross',
        },
      },
      storefront,
    ),
  )
  return done.orderId as string
}

const stock = async () =>
  ok(await call('GET', `/admin/products/${productId}`, undefined, admin)).variants[0].inventoryQuantity as number

const orderState = async (id: string) => {
  const [row] = await db
    .select({
      financialStatus: schema.orders.financialStatus,
      cancelledAt: schema.orders.cancelledAt,
      cancelReason: schema.orders.cancelReason,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
  return row!
}

/** Moves the order's creation time back (created_at is written by the database clock, so shift it there too) */
const age = (id: string, hours: number) =>
  db
    .update(schema.orders)
    .set({ createdAt: sql`${schema.orders.createdAt} - make_interval(hours => ${hours})` })
    .where(eq(schema.orders.id, id))

describe('with no limit set (the default)', () => {
  test('an unpaid bank-transfer order keeps its stock however old it gets', async () => {
    const id = await place(2)
    assert.equal(await stock(), STOCK - 2, 'the order took its stock')

    await age(id, 24 * 30)
    await paymentService.expireDue()

    const state = await orderState(id)
    assert.equal(state.financialStatus, 'pending')
    assert.equal(state.cancelledAt, null)
    assert.equal(await stock(), STOCK - 2, 'still held after 30 days: the merchant decides')
  })
})

describe('with a limit set', () => {
  test('an order older than the limit is cancelled and its stock goes back on sale', async () => {
    await updateShop(shopId, { unpaidOrderExpiryHours: 24 })
    const id = await place(3)
    assert.equal(await stock(), STOCK - 3)

    await age(id, 25)
    assert.ok((await paymentService.expireDue()) >= 1, 'the worker handled it')

    const state = await orderState(id)
    assert.ok(state.cancelledAt, 'cancelled')
    assert.equal(state.cancelReason, 'other')
    assert.equal(state.financialStatus, 'voided', 'nothing was paid, so it is voided, not refunded')
    assert.equal(await stock(), STOCK, 'the 3 are back on sale')
  })

  test('an order that is not yet past the limit is left alone', async () => {
    await updateShop(shopId, { unpaidOrderExpiryHours: 24 })
    const id = await place(2)

    await age(id, 23)
    await paymentService.expireDue()

    assert.equal((await orderState(id)).cancelledAt, null)
    assert.equal(await stock(), STOCK - 2)
  })

  test('a paid order is never cancelled, however old', async () => {
    await updateShop(shopId, { unpaidOrderExpiryHours: 24 })
    const id = await place(2)
    await orderService.markAsPaid(shopId, id)

    await age(id, 100)
    await paymentService.expireDue()

    const state = await orderState(id)
    assert.equal(state.financialStatus, 'paid')
    assert.equal(state.cancelledAt, null)
    assert.equal(await stock(), STOCK - 2)
  })

  test('an unpaid order that has been shipped is left alone', async () => {
    await updateShop(shopId, { unpaidOrderExpiryHours: 24 })
    const id = await place(2)
    await orderService.fulfill(shopId, id)

    await age(id, 100)
    await paymentService.expireDue()

    assert.equal((await orderState(id)).cancelledAt, null)
    assert.equal(await stock(), STOCK - 2)
  })

  test('an order paid after the worker picked it is not cancelled or refunded', async () => {
    const id = await place(2)
    await orderService.markAsPaid(shopId, id)

    // What the worker does for an order it picked while it was still unpaid
    await assert.rejects(
      orderService.cancel(shopId, id, { reason: 'other', restock: true, onlyIfUnpaid: true }),
      (error) => error instanceof OrderError && error.code === 'INVALID_STATUS_TRANSITION',
    )

    const state = await orderState(id)
    assert.equal(state.financialStatus, 'paid')
    assert.equal(state.cancelledAt, null)
    const refunds = await db
      .select({ id: schema.orderTransactions.id })
      .from(schema.orderTransactions)
      .where(and(eq(schema.orderTransactions.orderId, id), eq(schema.orderTransactions.kind, 'refund')))
    assert.equal(refunds.length, 0, 'no refund was booked')
    assert.equal(await stock(), STOCK - 2, 'and the stock was not put back')
  })
})

describe('the setting', () => {
  // The admin API resolves to the default shop in this server mode, and the app's own worker is running against this
  // database: while a limit is on for the default shop it would cancel real unpaid orders older than the limit. So a
  // number is only switched on, and straight off again, when no order is old enough to be at risk.
  test('an owner sets and clears it through the Admin API; a member cannot; bad values are refused', async (t) => {
    const owner = (await fx.account('owner')).headers
    const member = (await fx.account('member')).headers
    const patch = (value: unknown, as: Record<string, string>) =>
      call('PATCH', '/admin/shop', { unpaidOrderExpiryHours: value }, as)
    const before = (await getShopById(SHOP))!.unpaidOrderExpiryHours
    try {
      assert.equal(before, null, 'off by default')
      assert.equal(ok(await call('GET', '/admin/shop', undefined, owner)).unpaidOrderExpiryHours, null)
      assert.equal(ok(await patch(null, owner)).unpaidOrderExpiryHours, null, 'null (never) is accepted')

      for (const bad of [0, -5, 1.5, 8761, 'soon']) {
        assert.equal((await patch(bad, owner)).status, 400, `${JSON.stringify(bad)} is refused`)
      }
      assert.equal((await patch(24, member)).status, 403, 'a staff member who is not an owner or admin cannot')
      assert.equal((await getShopById(SHOP))!.unpaidOrderExpiryHours, null, 'nothing changed')

      const [risk] = await db
        .select({ atRisk: sql<number>`count(*)::int` })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.shopId, SHOP),
            eq(schema.orders.financialStatus, 'pending'),
            isNull(schema.orders.cancelledAt),
            sql`${schema.orders.createdAt} <= now() - interval '8760 hours'`,
          ),
        )
      const atRisk = risk?.atRisk ?? 0
      if (atRisk > 0) return t.diagnostic(`not switching a limit on: ${atRisk} real order(s) would be at risk`)
      assert.equal(ok(await patch(8760, owner)).unpaidOrderExpiryHours, 8760, 'a valid number is stored')
      assert.equal((await getShopById(SHOP))!.unpaidOrderExpiryHours, 8760)
    } finally {
      await updateShop(SHOP, { unpaidOrderExpiryHours: before })
    }
  })
})
