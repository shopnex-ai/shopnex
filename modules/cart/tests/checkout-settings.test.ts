// Settings → Shipping: the flat rates offered at checkout, in a shop's own list.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { SHOP, OTHER_SHOP, db } = fx
const { checkoutSettings } = await import('../src')

const MISSING = '00000000-0000-4000-8000-000000000000'

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('shipping rates', () => {
  test('a new rate is the shop’s, with its price and free-shipping threshold, and on', async () => {
    const r = await checkoutSettings.createShippingRate(
      SHOP,
      {
        name: 'Standard',
        priceCents: 599,
        freeAboveCents: 5000,
      },
      db,
    )
    assert.deepEqual([r.shopId, r.name, r.priceCents, r.freeAboveCents, r.active], [SHOP, 'Standard', 599, 5000, true])
    const never = await checkoutSettings.createShippingRate(SHOP, { name: 'Express', priceCents: 1500 }, db)
    assert.deepEqual([never.freeAboveCents, never.active], [null, true])
    assert.equal(
      (await checkoutSettings.createShippingRate(SHOP, { name: 'Off', priceCents: 1, active: false }, db)).active,
      false,
    )
  })

  test('the list is the shop’s own, oldest first within the same position; activeOnly leaves the switched-off out', async () => {
    const a = await checkoutSettings.createShippingRate(SHOP, { name: 'A', priceCents: 1 }, db)
    const b = await checkoutSettings.createShippingRate(SHOP, { name: 'B', priceCents: 2, active: false }, db)
    const c = await checkoutSettings.createShippingRate(SHOP, { name: 'C', priceCents: 3 }, db)
    await checkoutSettings.createShippingRate(OTHER_SHOP, { name: 'Theirs', priceCents: 9 }, db)
    assert.deepEqual(
      (await checkoutSettings.listShippingRates(SHOP, {}, db)).map((r) => r.id),
      [a.id, b.id, c.id],
    )
    assert.deepEqual(
      (await checkoutSettings.listShippingRates(SHOP, { activeOnly: true }, db)).map((r) => r.id),
      [a.id, c.id],
    )
    assert.deepEqual(
      (await checkoutSettings.listShippingRates(OTHER_SHOP, {}, db)).map((r) => r.name),
      ['Theirs'],
    )
  })

  test('a lower position comes first whatever the age', async () => {
    const older = await fx.shippingRate({ name: 'Older', position: 5 })
    const newer = await fx.shippingRate({ name: 'Newer', position: 0 })
    assert.deepEqual(
      (await checkoutSettings.listShippingRates(SHOP, {}, db)).map((r) => r.id),
      [newer.id, older.id],
    )
  })

  test('update changes only what is given and moves updatedAt; null for an unknown rate or another shop’s', async () => {
    const r = await checkoutSettings.createShippingRate(
      SHOP,
      {
        name: 'Standard',
        priceCents: 599,
        freeAboveCents: 5000,
      },
      db,
    )
    const u = await checkoutSettings.updateShippingRate(SHOP, r.id, { priceCents: 700 }, db)
    assert.deepEqual([u?.name, u?.priceCents, u?.freeAboveCents], ['Standard', 700, 5000])
    assert.ok(u!.updatedAt.getTime() >= r.updatedAt.getTime())
    assert.equal(
      (await checkoutSettings.updateShippingRate(SHOP, r.id, { freeAboveCents: null }, db))?.freeAboveCents,
      null,
    )
    assert.equal(await checkoutSettings.updateShippingRate(SHOP, MISSING, { name: 'x' }, db), null)
    const theirs = await checkoutSettings.createShippingRate(OTHER_SHOP, { name: 'Theirs', priceCents: 9 }, db)
    assert.equal(await checkoutSettings.updateShippingRate(SHOP, theirs.id, { name: 'Hijacked' }, db), null)
    assert.equal((await checkoutSettings.listShippingRates(OTHER_SHOP, {}, db))[0]?.name, 'Theirs')
  })

  test('delete removes it and gives it back; null for an unknown rate or another shop’s', async () => {
    const r = await checkoutSettings.createShippingRate(SHOP, { name: 'Standard', priceCents: 599 }, db)
    const theirs = await checkoutSettings.createShippingRate(OTHER_SHOP, { name: 'Theirs', priceCents: 9 }, db)
    assert.equal(await checkoutSettings.deleteShippingRate(SHOP, theirs.id, db), null)
    assert.equal((await checkoutSettings.deleteShippingRate(SHOP, r.id, db))?.id, r.id)
    assert.equal(await checkoutSettings.deleteShippingRate(SHOP, r.id, db), null)
    assert.equal((await checkoutSettings.listShippingRates(SHOP, {}, db)).length, 0)
    assert.equal((await checkoutSettings.listShippingRates(OTHER_SHOP, {}, db)).length, 1)
  })
})
