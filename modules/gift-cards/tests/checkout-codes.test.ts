// The checkout's one code box: a discount code if the shop has one by that name, otherwise a gift card; wrong codes are counted
// against the visitor and a visitor who used them up is refused for both kinds.
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
const { cartService } = await import('@shopnex/cart')
const { discountService } = await import('@shopnex/pricing')
const { checkoutCodes, giftCardService } = await import('../src')

const SHOP = 'default'
before(prepareDatabase)

async function cartWith(priceCents: number) {
  const p = await productService.create(SHOP, { title: 'Shirt', priceCents }, db)
  const channel = await channelService.resolve(SHOP, undefined, db)
  return cartService.create(SHOP, channel.id, db, [{ variantId: p.variants[0]!.id, quantity: 1 }])
}
const discount = (code: string, patch: Partial<Parameters<typeof discountService.create>[1]> = {}) =>
  discountService.create(
    SHOP,
    {
      code,
      type: 'percentage',
      value: 10,
      minSubtotalCents: null,
      usageLimit: null,
      oncePerCustomer: false,
      active: true,
      startsAt: null,
      endsAt: null,
      ...patch,
    },
    db,
  )

describe('applyCode', () => {
  test('a discount code is put on the cart, in any case; a gift card is only checked', async () => {
    await discount('BOXSAVE')
    const card = await giftCardService.issue(SHOP, { amountCents: 5000 }, db)
    const cart = await cartWith(2000)
    assert.deepEqual(await checkoutCodes.applyCode(cart.token, ' boxsave ', '198.51.100.1', db), { kind: 'discount' })
    assert.deepEqual(
      (await cartService.view((await cartService.findByToken(SHOP, cart.token, db))!, db)).discountCode,
      {
        code: 'BOXSAVE',
        applicable: true,
      },
    )
    assert.deepEqual(await checkoutCodes.applyCode(cart.token, card.code, '198.51.100.1', db), {
      kind: 'giftCard',
      code: card.code,
      balanceCents: 5000,
    })
    // Checking a card spends nothing
    assert.equal((await giftCardService.getById(SHOP, card.id, db))!.balanceCents, 5000)
  })

  test('what the buyer reads: blank, expired cart, unknown code, a discount that does not apply (and is not left on the cart)', async () => {
    const cart = await cartWith(500)
    const ip = '198.51.100.2'
    assert.match((await checkoutCodes.applyCode(cart.token, '  ', ip, db)).error!, /Enter a discount or gift card code/)
    assert.equal((await checkoutCodes.applyCode('cart_nope', 'X', ip, db)).error, 'This cart has expired.')
    assert.match((await checkoutCodes.applyCode(cart.token, 'NOSUCH', ip, db)).error!, /isn't valid/)
    await discount('BIGMIN', { minSubtotalCents: 100000 })
    assert.match((await checkoutCodes.applyCode(cart.token, 'BIGMIN', ip, db)).error!, /doesn't qualify/)
    assert.equal(
      (await cartService.view((await cartService.findByToken(SHOP, cart.token, db))!, db)).discountCode,
      null,
    )
  })

  test('ten wrong codes from one address, then both kinds are refused, a real discount code too', async () => {
    await discount('LOCKED')
    const card = await giftCardService.issue(SHOP, { amountCents: 1000 }, db)
    const cart = await cartWith(1000)
    const ip = '203.0.113.200'
    for (let i = 0; i < 10; i++) {
      assert.match((await checkoutCodes.applyCode(cart.token, `WRONG${String(i)}`, ip, db)).error!, /isn't valid/)
    }
    for (const code of ['LOCKED', card.code]) {
      assert.match((await checkoutCodes.applyCode(cart.token, code, ip, db)).error!, /Too many attempts/)
    }
    // Another address is not affected, and real codes were never counted
    assert.equal((await checkoutCodes.applyCode(cart.token, 'LOCKED', '203.0.113.201', db)).kind, 'discount')
  })
})
