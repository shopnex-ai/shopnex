// What a buyer typed for a cart line (an engraving, a gift message): the same variant with other properties is another line, the
// properties are cleaned, they survive a quantity change, and they end up on the order's line.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { orderItems } from '@shopnex/orders/schema'

const { db, eq, cartService, SHOP } = fx
const { checkoutService } = await import('../src')

const variantOf = (p: Awaited<ReturnType<typeof fx.product>>) => p.variants[0]!.id
const engraving = (value: string) => [{ name: 'Engraving', value }]
// Sorted: lines added in one call share a creation time, so the cart does not promise an order between them
const summary = (c: Awaited<ReturnType<typeof cartService.get>>) =>
  c.lines
    .map((l) => [l.properties.map((p) => `${p.name}=${p.value}`).join('&'), l.quantity] as const)
    .sort((x, y) => x[0].localeCompare(y[0]))

before(fx.prepareDatabase)
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('lines with properties', () => {
  test('one variant with different properties is different lines, with the same properties it is one line', async () => {
    const v = variantOf(await fx.product())
    const c = await fx.cart()
    await cartService.addLines(SHOP, c.token, [{ variantId: v, quantity: 1, properties: engraving('Anna') }], db)
    await cartService.addLines(SHOP, c.token, [{ variantId: v, quantity: 2, properties: engraving('Ben') }], db)
    const again = await cartService.addLines(
      SHOP,
      c.token,
      [{ variantId: v, quantity: 1, properties: engraving('Anna') }],
      db,
    )
    assert.deepEqual(summary(again), [
      ['Engraving=Anna', 2],
      ['Engraving=Ben', 2],
    ])
    assert.equal(again.totalQuantity, 4)
  })

  test('a line without properties is its own line, next to the same variant with some', async () => {
    const v = variantOf(await fx.product())
    const c = await fx.cart([{ variantId: v, quantity: 1 }])
    const after = await cartService.addLines(
      SHOP,
      c.token,
      [{ variantId: v, quantity: 1, properties: engraving('Anna') }],
      db,
    )
    assert.deepEqual(summary(after), [
      ['', 1],
      ['Engraving=Anna', 1],
    ])
  })

  test('what is kept: trimmed, empty values and names dropped, a name given twice keeps its last value, order kept', async () => {
    const v = variantOf(await fx.product())
    const c = await fx.cart()
    const made = await cartService.addLines(
      SHOP,
      c.token,
      [
        {
          variantId: v,
          quantity: 1,
          properties: [
            { name: '  Engraving ', value: '  first  ' },
            { name: 'Gift message', value: 'Happy\u0007 birthday' },
            { name: 'Note', value: '   ' },
            { name: '   ', value: 'no name' },
            { name: 'Engraving', value: 'last' },
          ],
        },
      ],
      db,
    )
    assert.deepEqual(made.lines[0]!.properties, [
      { name: 'Gift message', value: 'Happy birthday' },
      { name: 'Engraving', value: 'last' },
    ])
  })

  test('the same properties in another order are another line, and an empty list is no properties', async () => {
    const v = variantOf(await fx.product())
    const c = await fx.cart()
    const props = [
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
    ]
    await cartService.addLines(SHOP, c.token, [{ variantId: v, quantity: 1, properties: props }], db)
    await cartService.addLines(SHOP, c.token, [{ variantId: v, quantity: 1, properties: [...props].reverse() }], db)
    const withEmpty = await cartService.addLines(SHOP, c.token, [{ variantId: v, quantity: 1, properties: [] }], db)
    assert.deepEqual(summary(withEmpty), [
      ['', 1],
      ['A=1&B=2', 1],
      ['B=2&A=1', 1],
    ])
  })

  test('a quantity change or a removal touches only its own line', async () => {
    const v = variantOf(await fx.product())
    const c = await fx.cart()
    const two = await cartService.addLines(
      SHOP,
      c.token,
      [
        { variantId: v, quantity: 1, properties: engraving('Anna') },
        { variantId: v, quantity: 1, properties: engraving('Ben') },
      ],
      db,
    )
    const lineOf = (who: string) => two.lines.find((l) => l.properties[0]?.value === who)!
    const [anna, ben] = [lineOf('Anna'), lineOf('Ben')]
    const more = await cartService.updateLines(SHOP, c.token, [{ lineId: anna!.lineId, quantity: 3 }], db)
    assert.deepEqual(summary(more), [
      ['Engraving=Anna', 3],
      ['Engraving=Ben', 1],
    ])
    const zero = await cartService.updateLines(SHOP, c.token, [{ lineId: ben!.lineId, quantity: 0 }], db)
    assert.deepEqual(summary(zero), [['Engraving=Anna', 3]])
    const removed = await cartService.removeLines(SHOP, c.token, [anna!.lineId], db)
    assert.deepEqual(removed.lines, [])
  })
})

describe('the order of a cart with properties', () => {
  test('each line keeps its own properties on the order, and stock is taken for all of them together', async () => {
    const shirt = await fx.product({ priceCents: 3000 })
    const v = variantOf(shirt)
    const c = await fx.cart()
    await cartService.addLines(
      SHOP,
      c.token,
      [
        { variantId: v, quantity: 1, properties: [...engraving('Anna'), { name: '_source', value: 'popup' }] },
        { variantId: v, quantity: 2, properties: engraving('Ben') },
        { variantId: v, quantity: 1 },
      ],
      db,
    )
    const placed = await checkoutService.complete(
      SHOP,
      c.token,
      { email: 'buyer@example.com' },
      { returnUrl: 'http://localhost:3000/checkout/return' },
      db,
    )
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, placed.orderId))
    const byProps = items
      .map((i) => [JSON.stringify(i.properties), i.quantity, i.unitPriceCents] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
    assert.deepEqual(byProps, [
      [JSON.stringify([]), 1, 3000],
      [
        JSON.stringify([
          { name: 'Engraving', value: 'Anna' },
          { name: '_source', value: 'popup' },
        ]),
        1,
        3000,
      ],
      [JSON.stringify([{ name: 'Engraving', value: 'Ben' }]), 2, 3000],
    ])
  })

  test('four of a product with three in stock are refused, however the properties split them', async () => {
    const p = await fx.product({ priceCents: 1000, variants: undefined })
    const v = variantOf(p)
    const { productVariants } = await import('@shopnex/catalog/schema')
    await db.update(productVariants).set({ inventoryQuantity: 3 }).where(eq(productVariants.id, v))
    const c = await fx.cart()
    await cartService.addLines(
      SHOP,
      c.token,
      [
        { variantId: v, quantity: 2, properties: engraving('Anna') },
        { variantId: v, quantity: 2, properties: engraving('Ben') },
      ],
      db,
    )
    await assert.rejects(
      checkoutService.complete(
        SHOP,
        c.token,
        { email: 'buyer@example.com' },
        { returnUrl: 'http://localhost:3000/checkout/return' },
        db,
      ),
      /stock/i,
    )
  })
})
