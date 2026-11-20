// A gift card at checkout: what it pays, what is left, what happens when the order is cancelled or refunded, and that selling a gift card
// issues one (and can't be paid for with one).
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
const { eq } = await import('drizzle-orm')
const { giftCards } = await import('../src/gift-cards.schema')

const SHOP = 'default'
const RETURN = { returnUrl: 'http://localhost:3000/checkout/return' }

before(prepareDatabase)

async function product(priceCents: number, isGiftCard = false) {
  const p = await productService.create(SHOP, { title: isGiftCard ? 'Gift card' : 'Shirt', priceCents, isGiftCard }, db)
  return p.variants[0]!.id
}
async function cartWith(...lines: { variantId: string; quantity?: number }[]) {
  const channel = await channelService.resolve(SHOP, undefined, db)
  return cartService.create(
    SHOP,
    channel.id,
    db,
    lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity ?? 1 })),
  )
}
const place = (token: string, giftCardCode?: string) =>
  checkoutService.complete(SHOP, token, { email: 'buyer@example.com', giftCardCode }, RETURN, db)
const card = (amountCents: number) => giftCardService.issue(SHOP, { amountCents }, db)
const order = async (id: string) => (await orderService.getById(SHOP, id, db))!
const balance = async (id: string) => (await giftCardService.getById(SHOP, id, db))!.balanceCents
const refused = (code: string) => (e: unknown) => e instanceof CartError && e.code === code

describe('paying with a gift card', () => {
  test('the totals show what it pays and what is left, and spend nothing', async () => {
    const gc = await card(2000)
    const c = await cartWith({ variantId: await product(5000) })
    const view = await cartService.get(SHOP, c.token, db)
    const est = await checkoutService.estimate(SHOP, view, db, { giftCardCode: gc.code })
    assert.equal(est.totalCents, 5000)
    assert.equal(est.credits[0]?.amountCents, 2000)
    assert.equal(est.dueCents, 3000)
    assert.equal(await balance(gc.id), 2000)
  })

  test('a bad code is explained in the totals', async () => {
    const c = await cartWith({ variantId: await product(5000) })
    const est = await checkoutService.estimate(SHOP, await cartService.get(SHOP, c.token, db), db, {
      giftCardCode: 'nope-nope',
    })
    assert.equal(est.creditError, "This gift card code isn't valid")
    assert.equal(est.dueCents, 5000)
  })

  test('a card worth less than the order pays part of it: the order is partly paid and the card is empty', async () => {
    const gc = await card(2000)
    const c = await cartWith({ variantId: await product(5000) })
    const placed = await place(c.token, giftCardService.formatCode(gc.code).toLowerCase())
    const o = await order(placed.orderId)
    assert.equal(o.totalCents, 5000)
    assert.equal(o.financialStatus, 'partially_paid')
    assert.equal(await orderService.amountDue(db, o.id, o.totalCents), 3000)
    assert.deepEqual(
      o.transactions.map((t) => [t.kind, t.gateway, t.amountCents]),
      [['sale', 'gift_card', 2000]],
    )
    assert.equal(await balance(gc.id), 0)
  })

  test('a card worth more pays the whole order, which is paid, and keeps the rest', async () => {
    const gc = await card(8000)
    const c = await cartWith({ variantId: await product(5000) })
    const placed = await place(c.token, gc.code)
    const o = await order(placed.orderId)
    assert.equal(o.financialStatus, 'paid')
    assert.equal(o.paymentGateway, 'gift_card')
    assert.equal(placed.paymentUrl, null)
    assert.equal(await balance(gc.id), 3000)
  })

  test('a code that cannot be used refuses the order, and nothing is kept', async () => {
    const gc = await card(2000)
    await giftCardService.setActive(SHOP, gc.id, false, db)
    const c = await cartWith({ variantId: await product(5000) })
    await assert.rejects(place(c.token, gc.code), refused('GIFT_CARD_NOT_APPLICABLE'))
    assert.equal(await balance(gc.id), 2000)
    assert.equal((await cartService.get(SHOP, c.token, db)).status, 'active')
  })

  test('two orders cannot spend the same card twice', async () => {
    const gc = await card(5000)
    const v = await product(5000)
    const [a, b] = await Promise.all([cartWith({ variantId: v }), cartWith({ variantId: v })])
    const results = await Promise.allSettled([place(a.token, gc.code), place(b.token, gc.code)])
    const paid = await Promise.all(results.flatMap((r) => (r.status === 'fulfilled' ? [order(r.value.orderId)] : [])))
    assert.equal(await balance(gc.id), 0)
    assert.equal(paid.filter((o) => o.financialStatus === 'paid').length, 1)
  })
})

describe('giving the money back', () => {
  test('cancelling a partly paid order puts the card back', async () => {
    const gc = await card(2000)
    const c = await cartWith({ variantId: await product(5000) })
    const placed = await place(c.token, gc.code)
    await orderService.cancel(SHOP, placed.orderId, { reason: 'customer', restock: true }, db)
    const o = await order(placed.orderId)
    assert.equal(o.financialStatus, 'refunded')
    assert.equal(await balance(gc.id), 2000)
  })

  test('a refund goes to the card first', async () => {
    const gc = await card(3000)
    const c = await cartWith({ variantId: await product(5000) })
    const placed = await place(c.token, gc.code)
    await orderService.markAsPaid(SHOP, placed.orderId, db)
    assert.equal(await orderService.amountDue(db, placed.orderId, 5000), 0)
    await orderService.refund(SHOP, placed.orderId, { amountCents: 1000 }, db)
    assert.equal(await balance(gc.id), 1000)
    const o = await order(placed.orderId)
    assert.equal(o.financialStatus, 'partially_refunded')
    // Past what the card paid, the rest goes to the way the order was paid
    await orderService.refund(SHOP, placed.orderId, { amountCents: 3000 }, db)
    assert.equal(await balance(gc.id), 3000)
  })
})

describe('selling gift cards', () => {
  test('a paid gift card order issues a card for the price, once', async () => {
    const c = await cartWith({ variantId: await product(2500, true), quantity: 2 })
    const placed = await place(c.token)
    const before = await db.select().from(giftCards).where(eq(giftCards.purchaseOrderId, placed.orderId))
    assert.equal(before.length, 0)
    await orderService.markAsPaid(SHOP, placed.orderId, db)
    const issued = await db.select().from(giftCards).where(eq(giftCards.purchaseOrderId, placed.orderId))
    assert.deepEqual(
      issued.map((g) => g.balanceCents),
      [2500, 2500],
    )
    assert.notEqual(issued[0]!.code, issued[1]!.code)
  })

  test("a gift card can't pay for a gift card, but pays for the rest of the cart", async () => {
    const gc = await card(10000)
    const onlyGift = await cartWith({ variantId: await product(2500, true) })
    await assert.rejects(place(onlyGift.token, gc.code), refused('GIFT_CARD_NOT_APPLICABLE'))
    const mixed = await cartWith({ variantId: await product(2500, true) }, { variantId: await product(4000) })
    const placed = await place(mixed.token, gc.code)
    assert.equal((await order(placed.orderId)).financialStatus, 'partially_paid')
    assert.equal(await balance(gc.id), 6000)
  })
})
