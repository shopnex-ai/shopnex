import type { Conn } from '@shopnex/db'
// Carts: made on a channel, lines added, set and removed, what can be put in one (published on the channel, active, in stock), the
// discount code, how a cart is shown (live prices, availability, images), and the small things checkout uses.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shops } from '@shopnex/core/schema'
import * as fx from './fixtures'
import { carts } from '../src/cart.schema'
import { orders } from '@shopnex/orders/schema'
import { products, productVariants } from '@shopnex/catalog/schema'

const { db, eq, cartService, SHOP, OTHER_SHOP } = fx
const { CartError } = await import('../src')

const refused = (code: string) => (e: unknown) => e instanceof CartError && e.code === code
const MISSING = '00000000-0000-4000-8000-000000000000'
const variantOf = (p: Awaited<ReturnType<typeof fx.product>>) => p.variants[0]!.id

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('making a cart', () => {
  test('is empty, active, on the channel it was made for, with a token of its own and a month to live', async () => {
    const c = await fx.cart()
    assert.match(c.token, /^cart_[A-Za-z0-9_-]{32}$/)
    assert.deepEqual(
      [c.status, c.lines, c.subtotalCents, c.totalQuantity, c.currency, c.orderId],
      ['active', [], 0, 0, 'USD', null],
    )
    const row = await cartService.findByToken(SHOP, c.token, db)
    assert.equal(row?.channelId, (await fx.onlineStore()).id)
    const days = (row!.expiresAt.getTime() - Date.now()) / 86_400_000
    assert.ok(days > 29.9 && days <= 30, String(days))
    assert.notEqual((await fx.cart()).token, c.token)
  })

  test('can start with lines: the same variant twice is one line with the quantities added', async () => {
    const p = await fx.product()
    const c = await fx.cart([
      { variantId: variantOf(p), quantity: 1 },
      { variantId: variantOf(p), quantity: 2 },
    ])
    assert.deepEqual(
      c.lines.map((l) => [l.variantId, l.quantity]),
      [[variantOf(p), 3]],
    )
  })

  test('nothing is made when a line cannot be: a failed start leaves no cart behind', async () => {
    await assert.rejects(fx.cart([{ variantId: MISSING, quantity: 1 }]), refused('VARIANT_NOT_FOUND'))
    assert.equal((await db.select().from(carts).where(eq(carts.shopId, SHOP))).length, 0)
  })
})

describe('finding a cart', () => {
  test('by its token in its shop; another shop, an unknown token and an expired cart are not found', async () => {
    const c = await fx.cart()
    assert.equal((await cartService.get(SHOP, c.token, db)).token, c.token)
    await assert.rejects(cartService.get(OTHER_SHOP, c.token, db), refused('CART_NOT_FOUND'))
    await assert.rejects(cartService.get(SHOP, 'cart_nope', db), refused('CART_NOT_FOUND'))
    await db
      .update(carts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(carts.token, c.token))
    await assert.rejects(cartService.get(SHOP, c.token, db), refused('CART_NOT_FOUND'))
    assert.equal(await cartService.findByToken(null, c.token, db), null)
  })

  test('without a shop (the hosted checkout learns the shop from the cart) the token alone finds it', async () => {
    const c = await fx.cart()
    assert.equal((await cartService.findByToken(null, c.token, db))?.shopId, SHOP)
  })
})

describe('adding lines', () => {
  test('adds to what is there: new variants become lines, known ones grow', async () => {
    const [a, b] = [await fx.product({ title: 'A' }), await fx.product({ title: 'B' })]
    const c = await fx.cart([{ variantId: variantOf(a), quantity: 1 }])
    const added = await cartService.addLines(
      SHOP,
      c.token,
      [
        { variantId: variantOf(a), quantity: 2 },
        { variantId: variantOf(b), quantity: 1 },
      ],
      db,
    )
    assert.deepEqual(
      added.lines.map((l) => [l.title, l.quantity]),
      [
        ['A', 3],
        ['B', 1],
      ],
    )
    assert.deepEqual([added.totalQuantity, added.subtotalCents], [4, 10_000])
  })

  test('a line is at most 999', async () => {
    const p = await fx.product()
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 5000 }])
    assert.equal(c.lines[0]?.quantity, 999)
    assert.equal(
      (await cartService.addLines(SHOP, c.token, [{ variantId: variantOf(p), quantity: 10 }], db)).lines[0]?.quantity,
      999,
    )
  })

  test('more than is in stock is OUT_OF_STOCK, saying how many are left, and the cart is unchanged', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 3 }] })
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 2 }])
    await assert.rejects(
      cartService.addLines(SHOP, c.token, [{ variantId: variantOf(p), quantity: 2 }], db),
      (e: unknown) => {
        assert.ok(e instanceof CartError)
        assert.equal(e.code, 'OUT_OF_STOCK')
        assert.deepEqual(e.data, { variantId: variantOf(p), available: 3 })
        assert.match(e.message, /Only 3 left/)
        return true
      },
    )
    assert.equal((await cartService.get(SHOP, c.token, db)).lines[0]?.quantity, 2)
  })

  test('a variant that is unknown, another shop’s, in an archived product or not published on the cart’s channel is VARIANT_NOT_FOUND, naming it', async () => {
    const c = await fx.cart()
    const theirs = await fx.product({}, OTHER_SHOP)
    const archived = await fx.product({ status: 'archived' })
    const quiet = await fx.quietChannel()
    const hidden = await fx.product()
    const { publicationService } = await import('@shopnex/channels')
    await publicationService.set(SHOP, 'product', hidden.id, [{ channelId: quiet.id }], db)
    for (const variantId of [MISSING, variantOf(theirs), variantOf(archived), variantOf(hidden)]) {
      await assert.rejects(cartService.addLines(SHOP, c.token, [{ variantId, quantity: 1 }], db), (e: unknown) => {
        assert.ok(e instanceof CartError)
        assert.equal(e.code, 'VARIANT_NOT_FOUND')
        assert.deepEqual(e.data.variantIds, [variantId])
        return true
      })
    }
  })

  test('an unknown cart is CART_NOT_FOUND', async () => {
    await assert.rejects(cartService.addLines(SHOP, 'cart_nope', [], db), refused('CART_NOT_FOUND'))
  })
})

describe('changing lines', () => {
  test('updateLines sets quantities by line id, and 0 removes the line', async () => {
    const [a, b] = [await fx.product({ title: 'A' }), await fx.product({ title: 'B' })]
    const c = await fx.cart([
      { variantId: variantOf(a), quantity: 1 },
      { variantId: variantOf(b), quantity: 1 },
    ])
    const lineOf = (title: string) => c.lines.find((l) => l.title === title)!.lineId
    const changed = await cartService.updateLines(
      SHOP,
      c.token,
      [
        { lineId: lineOf('A'), quantity: 5 },
        { lineId: lineOf('B'), quantity: 0 },
      ],
      db,
    )
    assert.deepEqual(
      changed.lines.map((l) => [l.title, l.quantity]),
      [['A', 5]],
    )
  })

  test('a line that is not in the cart is LINE_NOT_FOUND, naming it, and nothing changes', async () => {
    const p = await fx.product()
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 1 }])
    await assert.rejects(
      cartService.updateLines(
        SHOP,
        c.token,
        [
          { lineId: c.lines[0]!.lineId, quantity: 4 },
          { lineId: MISSING, quantity: 1 },
        ],
        db,
      ),
      (e: unknown) => e instanceof CartError && e.code === 'LINE_NOT_FOUND' && e.data.lineIds?.[0] === MISSING,
    )
    assert.equal((await cartService.get(SHOP, c.token, db)).lines[0]?.quantity, 1)
  })

  test('removeLines removes the lines named, all or nothing', async () => {
    const [a, b] = [await fx.product({ title: 'A' }), await fx.product({ title: 'B' })]
    const c = await fx.cart([
      { variantId: variantOf(a), quantity: 1 },
      { variantId: variantOf(b), quantity: 1 },
    ])
    const lineOf = (title: string) => c.lines.find((l) => l.title === title)!.lineId
    await assert.rejects(cartService.removeLines(SHOP, c.token, [lineOf('A'), MISSING], db), refused('LINE_NOT_FOUND'))
    assert.equal((await cartService.get(SHOP, c.token, db)).lines.length, 2)
    const left = await cartService.removeLines(SHOP, c.token, [lineOf('A')], db)
    assert.deepEqual(
      left.lines.map((l) => l.title),
      ['B'],
    )
  })

  test('every change keeps the cart alive for another month and bumps when it was last touched', async () => {
    const p = await fx.product()
    const c = await fx.cart()
    await db
      .update(carts)
      .set({ expiresAt: new Date(Date.now() + 1000), updatedAt: new Date(Date.now() - 3_600_000) })
      .where(eq(carts.token, c.token))
    const before = Date.now()
    await cartService.addLines(SHOP, c.token, [{ variantId: variantOf(p), quantity: 1 }], db)
    const row = await cartService.findByToken(SHOP, c.token, db)
    assert.ok(row!.updatedAt.getTime() >= before - 1000)
    assert.ok(row!.expiresAt.getTime() > Date.now() + 29 * 86_400_000)
  })

  test('a cart that was checked out cannot be changed: CART_COMPLETED', async () => {
    const p = await fx.product()
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 1 }])
    await db.update(carts).set({ status: 'completed' }).where(eq(carts.token, c.token))
    await assert.rejects(
      cartService.addLines(SHOP, c.token, [{ variantId: variantOf(p), quantity: 1 }], db),
      refused('CART_COMPLETED'),
    )
    await assert.rejects(cartService.updateLines(SHOP, c.token, [], db), refused('CART_COMPLETED'))
    await assert.rejects(cartService.removeLines(SHOP, c.token, [], db), refused('CART_COMPLETED'))
    await assert.rejects(cartService.setDiscountCode(SHOP, c.token, 'X', db), refused('CART_COMPLETED'))
  })
})

describe('how a cart is shown', () => {
  test('lines with the product, the live price, the compare-at price, SKU, options, and the line total', async () => {
    const p = await fx.product({
      title: 'Tee',
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1000, sku: 'TEE-S', compareAtPriceCents: 1500 },
        { options: { Size: 'M' }, priceCents: 1200 },
      ],
    })
    const c = await fx.cart([{ variantId: p.variants[0]!.id, quantity: 3 }])
    const [line] = c.lines
    assert.deepEqual(
      [
        line?.title,
        line?.variantTitle,
        line?.isDefaultVariant,
        line?.sku,
        line?.unitPriceCents,
        line?.compareAtPriceCents,
        line?.lineTotalCents,
        line?.productSlug,
      ],
      ['Tee', 'S', false, 'TEE-S', 1000, 1500, 3000, 'tee'],
    )
    assert.deepEqual(line?.selectedOptions, [{ name: 'Size', value: 'S' }])
    assert.equal(c.subtotalCents, 3000)
  })

  test('a simple product’s default variant says so', async () => {
    const p = await fx.product()
    assert.equal((await fx.cart([{ variantId: variantOf(p), quantity: 1 }])).lines[0]?.isDefaultVariant, true)
  })

  test('the price is the variant’s now, not what it was when the line was added', async () => {
    const p = await fx.product({ priceCents: 1000 })
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 2 }])
    await db
      .update(productVariants)
      .set({ priceCents: 1300 })
      .where(eq(productVariants.id, variantOf(p)))
    const again = await cartService.get(SHOP, c.token, db)
    assert.deepEqual([again.lines[0]?.unitPriceCents, again.subtotalCents], [1300, 2600])
  })

  test('the image is the variant’s own, else the product’s first', async () => {
    const p = await fx.product({
      images: [{ url: 'https://example.com/first.png' }, { url: 'https://example.com/second.png' }],
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1, imageUrl: 'https://example.com/s.png' },
        { options: { Size: 'M' }, priceCents: 1 },
      ],
    })
    const c = await fx.cart(p.variants.map((v) => ({ variantId: v.id, quantity: 1 })))
    assert.deepEqual(c.lines.map((l) => [l.variantTitle, l.imageUrl]).sort(), [
      ['M', 'https://example.com/first.png'],
      ['S', 'https://example.com/s.png'],
    ])
  })

  test('a line is not available when its stock fell below the quantity, or its product is no longer active', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 5 }] })
    const q = await fx.product({ title: 'Other' })
    const c = await fx.cart([
      { variantId: variantOf(p), quantity: 4 },
      { variantId: variantOf(q), quantity: 1 },
    ])
    assert.deepEqual(
      c.lines.map((l) => l.available),
      [true, true],
    )
    await db
      .update(productVariants)
      .set({ inventoryQuantity: 3 })
      .where(eq(productVariants.id, variantOf(p)))
    await db.update(products).set({ status: 'archived' }).where(eq(products.id, q.id))
    assert.deepEqual(
      (await cartService.get(SHOP, c.token, db)).lines.map((l) => l.available),
      [false, false],
    )
  })

  test('lines added one after another come in that order', async () => {
    const [a, b, c3] = [
      await fx.product({ title: 'A' }),
      await fx.product({ title: 'B' }),
      await fx.product({ title: 'C' }),
    ]
    const c = await fx.cart([{ variantId: variantOf(b), quantity: 1 }])
    await cartService.addLines(SHOP, c.token, [{ variantId: variantOf(c3), quantity: 1 }], db)
    await cartService.addLines(SHOP, c.token, [{ variantId: variantOf(a), quantity: 1 }], db)
    const view = await cartService.get(SHOP, c.token, db)
    assert.deepEqual(
      view.lines.map((l) => l.title),
      ['B', 'C', 'A'],
    )
  })

  test('lines added in one call share a moment, so their order is not the order they were sent in (it is stable between reads)', async () => {
    const [a, b] = [await fx.product({ title: 'A' }), await fx.product({ title: 'B' })]
    const c = await fx.cart([
      { variantId: variantOf(a), quantity: 1 },
      { variantId: variantOf(b), quantity: 1 },
    ])
    const twice = [await cartService.get(SHOP, c.token, db), await cartService.get(SHOP, c.token, db)]
    assert.deepEqual(
      twice[0]!.lines.map((l) => l.lineId),
      twice[1]!.lines.map((l) => l.lineId),
    )
  })

  test('the currency is the shop’s', async () => {
    await db.update(shops).set({ currency: 'EUR' }).where(eq(shops.id, SHOP))
    try {
      assert.equal((await fx.cart()).currency, 'EUR')
    } finally {
      await db.update(shops).set({ currency: 'USD' }).where(eq(shops.id, SHOP))
    }
  })
})

describe('the discount code', () => {
  test('a buyer typing codes can guess ten that the shop does not have, then is refused, even for a real one; real codes never count', async () => {
    const d = await fx.discount()
    const c = await fx.cart()
    const visitor = { ip: '203.0.113.71' }
    for (let i = 0; i < 12; i++) {
      assert.equal(
        (await cartService.setDiscountCode(SHOP, c.token, d.code, db, visitor)).discountCode?.applicable,
        true,
      )
    }
    for (let i = 0; i < 10; i++) {
      const miss = await cartService.setDiscountCode(SHOP, c.token, `NOPE${String(i)}`, db, visitor)
      assert.equal(miss.discountCode?.applicable, false)
    }
    await assert.rejects(cartService.setDiscountCode(SHOP, c.token, d.code, db, visitor), refused('TOO_MANY_GUESSES'))
    // Removing the code is not a guess, another address is not affected, and without a visitor (staff, checkout) nothing is counted
    assert.equal((await cartService.setDiscountCode(SHOP, c.token, null, db, visitor)).discountCode, null)
    assert.equal(
      (await cartService.setDiscountCode(SHOP, c.token, d.code, db, { ip: '203.0.113.72' })).discountCode?.applicable,
      true,
    )
    assert.equal((await cartService.setDiscountCode(SHOP, c.token, d.code, db)).discountCode?.applicable, true)
  })

  test('a code that applies shows what it takes off each line; the total is the subtotal less the line discounts', async () => {
    const [a, b] = [
      await fx.product({ title: 'A', priceCents: 1000 }),
      await fx.product({ title: 'B', priceCents: 3000 }),
    ]
    const d = await fx.discount({ type: 'percentage', value: 10 })
    const c = await fx.cart([
      { variantId: variantOf(a), quantity: 1 },
      { variantId: variantOf(b), quantity: 1 },
    ])
    const set = await cartService.setDiscountCode(SHOP, c.token, d.code.toLowerCase(), db)
    assert.deepEqual(set.discountCode, { code: d.code, applicable: true })
    assert.deepEqual(set.lines.map((l) => [l.title, l.discountCents]).sort(), [
      ['A', 100],
      ['B', 300],
    ])
    assert.deepEqual([set.discountCents, set.totalCents, set.discount?.type], [400, 3600, 'percentage'])
  })

  test('a fixed amount is shared between the lines', async () => {
    const [a, b] = [
      await fx.product({ title: 'A', priceCents: 1000 }),
      await fx.product({ title: 'B', priceCents: 3000 }),
    ]
    const d = await fx.discount({ type: 'fixed_amount', value: 400 })
    const c = await fx.cart([
      { variantId: variantOf(a), quantity: 1 },
      { variantId: variantOf(b), quantity: 1 },
    ])
    const set = await cartService.setDiscountCode(SHOP, c.token, d.code, db)
    assert.deepEqual(set.lines.map((l) => [l.title, l.discountCents]).sort(), [
      ['A', 100],
      ['B', 300],
    ])
  })

  test('free shipping takes nothing off the lines (shipping is not chosen yet) but is applicable', async () => {
    const p = await fx.product()
    const d = await fx.discount({ type: 'free_shipping', value: 0 })
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 1 }])
    const set = await cartService.setDiscountCode(SHOP, c.token, d.code, db)
    assert.deepEqual([set.discountCode?.applicable, set.discountCents, set.discount?.type], [true, 0, 'free_shipping'])
  })

  test('a code under its minimum, inactive or unknown stays on the cart but is not applied', async () => {
    const p = await fx.product({ priceCents: 1000 })
    const c = await fx.cart([{ variantId: variantOf(p), quantity: 1 }])
    const minimum = await fx.discount({ minSubtotalCents: 5000 })
    const off = await fx.discount({ active: false })
    for (const [code, shown] of [
      [minimum.code, minimum.code],
      [off.code, off.code],
      ['NOSUCHCODE', 'NOSUCHCODE'],
    ] as const) {
      const set = await cartService.setDiscountCode(SHOP, c.token, code, db)
      assert.deepEqual(
        [set.discountCode, set.discount, set.discountCents, set.totalCents],
        [{ code: shown, applicable: false }, null, 0, 1000],
        code,
      )
    }
  })

  test('blank or null removes it, and the code is trimmed', async () => {
    const d = await fx.discount()
    const c = await fx.cart()
    assert.equal((await cartService.setDiscountCode(SHOP, c.token, `  ${d.code}  `, db)).discountCode?.code, d.code)
    assert.equal((await cartService.setDiscountCode(SHOP, c.token, '   ', db)).discountCode, null)
    await cartService.setDiscountCode(SHOP, c.token, d.code, db)
    assert.equal((await cartService.setDiscountCode(SHOP, c.token, null, db)).discountCode, null)
  })
})

describe('what checkout uses', () => {
  test('lineInputs lists variants and quantities oldest first; lockForCheckout finds a live cart of the shop', async () => {
    const [a, b] = [await fx.product({ title: 'A' }), await fx.product({ title: 'B' })]
    const c = await fx.cart([{ variantId: variantOf(a), quantity: 2 }])
    await cartService.addLines(SHOP, c.token, [{ variantId: variantOf(b), quantity: 1 }], db)
    const row = await db.transaction(async (tx) => {
      const locked = await cartService.lockForCheckout(tx, SHOP, c.token)
      assert.deepEqual(
        (await cartService.lineInputs(tx, locked!.id)).map((l) => [l.variantId, l.quantity]),
        [
          [variantOf(a), 2],
          [variantOf(b), 1],
        ],
      )
      assert.equal(await cartService.lockForCheckout(tx, OTHER_SHOP, c.token), null)
      return locked
    })
    assert.equal(row?.token, c.token)
  })

  test('markCompleted records the order, the customer and the email, and stops the cart being changed', async () => {
    const c = await fx.cart()
    const row = (await cartService.findByToken(SHOP, c.token, db))!
    await cartService
      .markCompleted(db, row.id, { id: MISSING, customerId: null, email: 'buyer@example.test' })
      .catch(() => undefined)
    const o = await db
      .insert(orders)
      .values({
        shopId: SHOP,
        orderNumber: 910_001,
        channelId: row.channelId,
        email: 'buyer@example.test',
        subtotalCents: 1,
        totalCents: 1,
      })
      .returning()
    await cartService.markCompleted(db, row.id, { id: o[0]!.id, customerId: null, email: 'buyer@example.test' })
    const done = await cartService.findByToken(SHOP, c.token, db)
    assert.deepEqual([done?.status, done?.orderId, done?.email], ['completed', o[0]!.id, 'buyer@example.test'])
  })

  test('setReminderContact keeps the email the buyer typed, lower case, on an open cart only', async () => {
    const [open, done] = [await fx.cart(), await fx.cart()]
    await db.update(carts).set({ status: 'completed' }).where(eq(carts.token, done.token))
    await cartService.setReminderContact(open.token, '  Shopper@Example.TEST ', db)
    await cartService.setReminderContact(done.token, 'late@example.test', db)
    assert.equal((await cartService.findByToken(SHOP, open.token, db))?.email, 'shopper@example.test')
    assert.equal((await cartService.findByToken(SHOP, done.token, db))?.email, null)
  })
})
