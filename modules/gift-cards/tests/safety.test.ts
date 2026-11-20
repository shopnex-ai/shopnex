// What stops a gift card from being a way to lose money: cards bought with an order that is refunded stop working, a card is
// spent only in its own currency, and guessing codes is throttled.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.APP_URL = 'http://localhost:3000'
delete process.env.TENANCY_MODE

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { productService } = await import('@shopnex/catalog')
const { channelService } = await import('@shopnex/channels')
const { cartService, checkoutService, CartError } = await import('@shopnex/cart')
const { orderService } = await import('@shopnex/orders')
const { giftCardService } = await import('../src')
const { GiftCardError } = await import('../src/gift-cards.errors')
const { giftCards } = await import('../src/gift-cards.schema')
const { shops } = await import('@shopnex/core/schema')
const { eq } = await import('drizzle-orm')

const SHOP = 'default'
const RETURN = { returnUrl: 'http://localhost:3000/checkout/return' }
before(prepareDatabase)

async function cartWith(priceCents: number, isGiftCard = false) {
  const p = await productService.create(SHOP, { title: isGiftCard ? 'Gift card' : 'Shirt', priceCents, isGiftCard }, db)
  const channel = await channelService.resolve(SHOP, undefined, db)
  return cartService.create(SHOP, channel.id, db, [{ variantId: p.variants[0]!.id, quantity: 1 }])
}
const place = (token: string, giftCardCode?: string, visitorIp?: string) =>
  checkoutService.complete(SHOP, token, { email: 'buyer@example.com', giftCardCode }, { ...RETURN, visitorIp }, db)
const card = (amountCents: number) => giftCardService.issue(SHOP, { amountCents }, db)
const cardRow = async (id: string) => (await giftCardService.getById(SHOP, id, db))!
const refused = (code: string) => (e: unknown) => e instanceof CartError && e.code === code

/** Buys a gift card for this price, and pays for it */
async function bought(priceCents: number) {
  const placed = await place((await cartWith(priceCents, true)).token)
  await orderService.markAsPaid(SHOP, placed.orderId, db)
  const [issued] = await db.select().from(giftCards).where(eq(giftCards.purchaseOrderId, placed.orderId))
  return { orderId: placed.orderId, card: issued! }
}

describe('cards bought with an order that is refunded', () => {
  test('cancelling the paid order disables the card and takes back its balance', async () => {
    const { orderId, card: bought_ } = await bought(5000)
    assert.equal(bought_.balanceCents, 5000)
    await orderService.cancel(SHOP, orderId, { reason: 'fraud', restock: true }, db)
    const after = await cardRow(bought_.id)
    assert.equal(after.active, false)
    assert.equal(after.balanceCents, 0)
    assert.deepEqual(
      after.transactions.map((t) => [t.kind, t.amountCents]),
      [
        ['issue', 5000],
        ['revoke', -5000],
      ],
    )
  })

  test('what was already spent stays spent: only the rest is taken back', async () => {
    const { orderId, card: bought_ } = await bought(5000)
    const spent = await place((await cartWith(2000)).token, bought_.code)
    assert.equal((await orderService.getById(SHOP, spent.orderId, db))!.financialStatus, 'paid')
    await orderService.cancel(SHOP, orderId, { reason: 'fraud', restock: true }, db)
    const after = await cardRow(bought_.id)
    assert.equal(after.balanceCents, 0)
    assert.equal(after.active, false)
    assert.deepEqual(
      after.transactions.map((t) => [t.kind, t.amountCents]),
      [
        ['issue', 5000],
        ['redeem', -2000],
        ['revoke', -3000],
      ],
    )
    await assert.rejects(place((await cartWith(1000)).token, bought_.code), refused('GIFT_CARD_NOT_APPLICABLE'))
  })

  test('a full refund revokes, a partial one does not', async () => {
    const { orderId, card: bought_ } = await bought(5000)
    await orderService.refund(SHOP, orderId, { amountCents: 1000 }, db)
    assert.equal((await cardRow(bought_.id)).active, true)
    await orderService.refund(SHOP, orderId, { amountCents: 4000 }, db)
    const after = await cardRow(bought_.id)
    assert.equal(after.active, false)
    assert.equal(after.balanceCents, 0)
  })

  test('other cards are left alone, and cancelling an ordinary order touches no card', async () => {
    const { card: other } = await bought(3000)
    const placed = await place((await cartWith(4000)).token)
    await orderService.markAsPaid(SHOP, placed.orderId, db)
    await orderService.cancel(SHOP, placed.orderId, { reason: 'customer', restock: true }, db)
    assert.equal((await cardRow(other.id)).active, true)
    assert.equal((await cardRow(other.id)).balanceCents, 3000)
  })
})

describe('a card is spent in its own currency', () => {
  test('a card in another currency than the order is refused: in the totals, at checkout and by the service', async () => {
    const gc = await card(5000)
    await db.update(shops).set({ currency: 'JPY' }).where(eq(shops.id, SHOP))
    try {
      const c = await cartWith(3000)
      const est = await checkoutService.estimate(SHOP, await cartService.get(SHOP, c.token, db), db, {
        giftCardCode: gc.code,
      })
      assert.match(est.creditError!, /in USD and can't be used for an order in JPY/)
      assert.equal(est.dueCents, 3000)
      await assert.rejects(place(c.token, gc.code), refused('GIFT_CARD_NOT_APPLICABLE'))
      await assert.rejects(
        db.transaction((tx) => giftCardService.redeem(tx, SHOP, gc.id, 100, crypto.randomUUID(), 'JPY')),
        (e: unknown) => e instanceof GiftCardError && e.code === 'GIFT_CARD_UNAVAILABLE',
      )
      assert.equal((await cardRow(gc.id)).balanceCents, 5000)
    } finally {
      await db.update(shops).set({ currency: 'USD' }).where(eq(shops.id, SHOP))
    }
  })

  test('in its own currency it is spent as usual', async () => {
    const gc = await card(5000)
    const placed = await place((await cartWith(3000)).token, gc.code)
    assert.equal((await orderService.getById(SHOP, placed.orderId, db))!.financialStatus, 'paid')
    assert.equal((await cardRow(gc.id)).balanceCents, 2000)
  })
})

describe('guessing codes', () => {
  const opts = (ip: string | null, throttle = true) => ({ currency: 'USD', ip, throttle })

  test('ten wrong codes from one address, and then even the right one is refused', async () => {
    const gc = await card(1000)
    const ip = '203.0.113.7'
    for (let i = 0; i < 10; i++) {
      const miss = await giftCardService.lookup(SHOP, `WRONG${String(i)}`, opts(ip), db)
      assert.equal(miss.error, "This gift card code isn't valid")
    }
    const blocked = await giftCardService.lookup(SHOP, gc.code, opts(ip), db)
    assert.match(blocked.error!, /Too many attempts/)
    // Another address is not affected
    assert.equal((await giftCardService.lookup(SHOP, gc.code, opts('203.0.113.8'), db)).card?.id, gc.id)
  })

  test('right codes are never counted, however often they are asked for', async () => {
    const gc = await card(1000)
    for (let i = 0; i < 25; i++) {
      assert.equal((await giftCardService.lookup(SHOP, gc.code, opts('198.51.100.1'), db)).card?.id, gc.id)
    }
  })

  test('without a trusted address the limit is the shop’s, and a lot higher', async () => {
    const gc = await card(1000)
    for (let i = 0; i < 20; i++) await giftCardService.lookup(SHOP, `NOIP${String(i)}`, opts(null), db)
    assert.equal((await giftCardService.lookup(SHOP, gc.code, opts(null), db)).card?.id, gc.id)
  })

  test('placing the order does not count: only the check before it does', async () => {
    const gc = await card(1000)
    const ip = '192.0.2.50'
    const c = await cartWith(500)
    const placed = await place(c.token, gc.code, ip)
    assert.equal((await orderService.getById(SHOP, placed.orderId, db))!.financialStatus, 'paid')
  })

  test('checkout counts wrong codes against the visitor and then refuses the right one', async () => {
    const gc = await card(1000)
    const ip = '192.0.2.99'
    for (let i = 0; i < 10; i++) {
      await assert.rejects(
        place((await cartWith(500)).token, `NOPE${String(i)}`, ip),
        refused('GIFT_CARD_NOT_APPLICABLE'),
      )
    }
    await assert.rejects(
      place((await cartWith(500)).token, gc.code, ip),
      (e: unknown) => e instanceof CartError && /Too many attempts/.test(e.message),
    )
    assert.equal((await cardRow(gc.id)).balanceCents, 1000)
  })
})
