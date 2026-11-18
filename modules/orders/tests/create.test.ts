// Placing an order: prices come from the catalog, stock is taken and given back as one, the discount and tax rules, the number and the
// snapshots an order keeps, who the customer is, and everything that makes the whole order fail without leaving anything behind.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shops } from '@shopnex/core/schema'
import * as fx from './fixtures'
import { orders } from '../src/orders.schema'

const { db, schema, eq, orderService, SHOP, OTHER_SHOP } = fx
const { OrderError } = await import('../src')

const refused = (code: string) => (e: unknown) => e instanceof OrderError && e.code === code
const MISSING = '00000000-0000-4000-8000-000000000000'
const variantOf = (p: Awaited<ReturnType<typeof fx.product>>) => p.variants[0]!.id
const row = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!
const stockOf = async (variantId: string) =>
  (await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, variantId)))[0]!.inventoryQuantity
const orderCount = async () => (await db.select().from(orders).where(eq(orders.shopId, SHOP))).length

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('what an order is made of', () => {
  test('lines at the catalog’s prices, snapshotted with the product title, variant, SKU, vendor and image; totals add up', async () => {
    const p = await fx.product({
      title: 'Tee',
      vendor: 'Acme',
      images: [{ url: 'https://example.com/tee.png' }],
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1000, sku: 'TEE-S' },
        { options: { Size: 'M' }, priceCents: 1200 },
      ],
    })
    const o = await orderService.create(SHOP, {
      email: 'buyer@example.test',
      items: [
        { variantId: p.variants[0]!.id, quantity: 2 },
        { variantId: p.variants[1]!.id, quantity: 1 },
      ],
    })
    assert.deepEqual(
      [o.subtotalCents, o.shippingCents, o.discountCents, o.taxCents, o.totalCents],
      [3200, 0, 0, 0, 3200],
    )
    const small = o.items.find((i) => i.variantTitle === 'S')!
    assert.deepEqual(
      [
        small.title,
        small.sku,
        small.vendor,
        small.imageUrl,
        small.unitPriceCents,
        small.quantity,
        small.discountCents,
        small.productId,
      ],
      ['Tee', 'TEE-S', 'Acme', 'https://example.com/tee.png', 1000, 2, 0, p.id],
    )
  })

  test('a price changed in the catalog afterwards does not change the order', async () => {
    const p = await fx.product({ priceCents: 1000 })
    const o = await orderService.create(SHOP, {
      email: 'a@example.test',
      items: [{ variantId: variantOf(p), quantity: 1 }],
    })
    await db
      .update(schema.productVariants)
      .set({ priceCents: 9999 })
      .where(eq(schema.productVariants.id, variantOf(p)))
    assert.equal((await orderService.getById(SHOP, o.id))?.items[0]?.unitPriceCents, 1000)
  })

  test('a simple product can be ordered by product id; the hidden default variant has no title on the order', async () => {
    const p = await fx.product()
    const o = await orderService.create(SHOP, { email: 'a@example.test', items: [{ productId: p.id, quantity: 3 }] })
    assert.deepEqual([o.items[0]?.variantId, o.items[0]?.variantTitle, o.items[0]?.quantity], [variantOf(p), null, 3])
  })

  test('the order keeps the payment method it was placed with, and is manual and unpaid unless told otherwise', async () => {
    const plain = await fx.place()
    assert.deepEqual(
      [
        plain.paymentGateway,
        plain.paymentMethodName,
        plain.financialStatus,
        plain.fulfillmentStatus,
        plain.cancelledAt,
      ],
      ['manual', null, 'pending', 'unfulfilled', null],
    )
    const p = await fx.product()
    const paid = await orderService.create(SHOP, {
      email: 'a@example.test',
      items: [{ variantId: variantOf(p), quantity: 1 }],
      payment: { gateway: 'stripe', name: 'Card', instructions: null },
      note: 'Gift',
      phone: '+1',
    })
    assert.deepEqual(
      [paid.paymentGateway, paid.paymentMethodName, paid.note, paid.phone],
      ['stripe', 'Card', 'Gift', '+1'],
    )
  })

  test('the phone falls back to the shipping address’s, and the billing address to the shipping address', async () => {
    const o = await fx.place({ shippingAddress: fx.address })
    assert.deepEqual([o.phone, o.shippingAddress?.city, o.billingAddress?.city], ['+33100000000', 'Paris', 'Paris'])
  })

  test('the shop’s currency at that moment is recorded', async () => {
    await db.update(shops).set({ currency: 'EUR' }).where(eq(shops.id, SHOP))
    const o = await fx.place()
    await db.update(shops).set({ currency: 'USD' }).where(eq(shops.id, SHOP))
    assert.equal((await row(o.id)).currency, 'EUR')
  })

  test('numbers follow one another per shop, starting at 1001, and a failed order does not use one', async () => {
    const [a, b] = [await fx.place(), await fx.place()]
    assert.deepEqual([a.orderNumber, b.orderNumber], [1001, 1002])
    await assert.rejects(
      orderService.create(SHOP, { email: 'a@example.test', items: [{ variantId: MISSING, quantity: 1 }] }),
    )
    assert.equal((await fx.place()).orderNumber, 1003)
    const p = await fx.product({}, OTHER_SHOP)
    const theirs = await orderService.create(OTHER_SHOP, {
      email: 'a@example.test',
      items: [{ variantId: variantOf(p), quantity: 1 }],
    })
    assert.equal(theirs.orderNumber, 1001)
  })

  test('two orders placed at once get two numbers', async () => {
    const [a, b] = await Promise.all([fx.place(), fx.place()])
    assert.deepEqual([a.orderNumber, b.orderNumber].sort(), [1001, 1002])
  })

  test('it goes on the Online Store unless a channel is named, and only that shop’s channel can be named', async () => {
    const quiet = await fx.quietChannel()
    assert.equal((await fx.place()).channelId, (await fx.onlineStore()).id)
    assert.equal((await fx.place({ channelId: quiet.id })).channelId, quiet.id)
  })

  test('tells webhooks order.created with the whole order as the admin API shows it', async () => {
    const sent = await fx.hook(['order.created'])
    const o = await fx.place()
    const [delivery] = await sent()
    assert.deepEqual(
      [delivery?.topic, delivery?.data.id, delivery?.data.orderNumber],
      ['order.created', o.id, o.orderNumber],
    )
    assert.equal((delivery?.data.items as unknown[]).length, 1)
  })
})

describe('shipping', () => {
  test('a shipping line is kept with its title and code, and charged', async () => {
    const o = await fx.place({ shipping: { title: 'Standard', code: 'std', priceCents: 599, freeAboveCents: null } })
    assert.deepEqual([o.shippingCents, o.totalCents], [599, 2500 + 599])
    assert.deepEqual(
      o.shippingLines.map((s) => [s.title, s.code, s.priceCents, s.discountCents]),
      [['Standard', 'std', 599, 0]],
    )
  })

  test('free once the subtotal reaches the threshold, exactly', async () => {
    const shipping = { title: 'Standard', code: null, priceCents: 599, freeAboveCents: 2500 }
    assert.equal((await fx.place({ shipping })).shippingCents, 0)
    assert.equal((await fx.place({ shipping: { ...shipping, freeAboveCents: 2501 } })).shippingCents, 599)
  })

  test('an order without a shipping method has no shipping line', async () => {
    assert.deepEqual((await fx.place()).shippingLines, [])
  })
})

describe('discounts', () => {
  test('a percentage code takes its share off each line, is kept on the order and counted as used', async () => {
    const d = await fx.discount({ type: 'percentage', value: 10 })
    const p = await fx.product({ priceCents: 1000 })
    const o = await orderService.create(SHOP, {
      email: 'a@example.test',
      items: [{ variantId: variantOf(p), quantity: 2 }],
      discountCode: d.code.toLowerCase(),
    })
    assert.deepEqual(
      [o.discountCents, o.totalCents, o.discountCodes, o.items[0]?.discountCents],
      [200, 1800, [d.code], 200],
    )
    const redemptions = await db.execute(
      `select count(*)::int as n from discount_redemptions where order_id = '${o.id}'`,
    )
    assert.equal(redemptions.rows[0]?.n, 1)
    assert.equal(
      (
        await db
          .select()
          .from((await import('@shopnex/pricing/schema')).discounts)
          .where(eq((await import('@shopnex/pricing/schema')).discounts.id, d.id))
      )[0]?.usageCount,
      1,
    )
  })

  test('free shipping takes the shipping line’s price off, not the products’', async () => {
    const d = await fx.discount({ type: 'free_shipping', value: 0 })
    const o = await fx.place({
      discountCode: d.code,
      shipping: { title: 'Standard', code: null, priceCents: 600, freeAboveCents: null },
    })
    assert.deepEqual([o.discountCents, o.totalCents, o.shippingLines[0]?.discountCents], [600, 2500, 600])
  })

  test('a code that cannot be used fails the whole order: unknown, inactive, used up, under its minimum', async () => {
    const off = await fx.discount({ active: false })
    const used = await fx.discount({ usageLimit: 1 })
    await fx.place({ discountCode: used.code })
    const minimum = await fx.discount({ minSubtotalCents: 100_000 })
    for (const code of ['NOSUCHCODE', off.code, used.code, minimum.code])
      await assert.rejects(fx.place({ discountCode: code }), refused('DISCOUNT_NOT_APPLICABLE'), code)
  })

  test('a once-per-customer code works once for a customer, and the next customer can use it', async () => {
    const d = await fx.discount({ oncePerCustomer: true })
    const [ada, bob] = [await fx.customer(), await fx.customer()]
    await fx.place({ customerId: ada.id, discountCode: d.code })
    await assert.rejects(fx.place({ customerId: ada.id, discountCode: d.code }), refused('DISCOUNT_NOT_APPLICABLE'))
    await fx.place({ customerId: bob.id, discountCode: d.code })
  })

  test('a failed order leaves the code unused', async () => {
    const d = await fx.discount({ usageLimit: 1 })
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 0 }] })
    await assert.rejects(
      orderService.create(SHOP, {
        email: 'a@example.test',
        items: [{ variantId: variantOf(p), quantity: 1 }],
        discountCode: d.code,
      }),
      refused('OUT_OF_STOCK'),
    )
    await fx.place({ discountCode: d.code })
  })
})

describe('tax', () => {
  test('follows the shipping address: added on top by default, on the products only', async () => {
    await fx.taxRate()
    const p = await fx.product({ priceCents: 1000 })
    const o = await orderService.create(SHOP, {
      email: 'a@example.test',
      items: [{ variantId: variantOf(p), quantity: 1 }],
      shippingAddress: fx.address,
      shipping: { title: 'Standard', code: null, priceCents: 500, freeAboveCents: null },
    })
    assert.deepEqual([o.taxCents, o.totalCents, o.taxesIncluded], [200, 1000 + 500 + 200, false])
    assert.deepEqual(
      o.taxLines.map((t) => [t.title, t.ratePercent, t.amountCents]),
      [['VAT', 20, 200]],
    )
  })

  test('shipping is taxed when the shop says so, and prices include tax when the shop says so', async () => {
    await fx.taxRate()
    await db.update(shops).set({ taxShipping: true }).where(eq(shops.id, SHOP))
    const p = await fx.product({ priceCents: 1000 })
    const base = {
      email: 'a@example.test',
      items: [{ variantId: variantOf(p), quantity: 1 }],
      shippingAddress: fx.address,
      shipping: { title: 'S', code: null, priceCents: 500, freeAboveCents: null },
    }
    assert.equal((await orderService.create(SHOP, base)).taxCents, 300)
    await db.update(shops).set({ taxesIncluded: true }).where(eq(shops.id, SHOP))
    const included = await orderService.create(SHOP, base)
    assert.deepEqual([included.taxesIncluded, included.totalCents], [true, 1500])
  })

  test('no address, or an address in a country with no rate, means no tax', async () => {
    await fx.taxRate()
    assert.equal((await fx.place()).taxCents, 0)
    assert.equal((await fx.place({ shippingAddress: { ...fx.address, countryCode: 'US' } })).taxCents, 0)
  })
})

describe('stock', () => {
  test('is taken for the quantities ordered, summed per variant across lines', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 10 }] })
    await orderService.create(SHOP, {
      email: 'a@example.test',
      items: [
        { variantId: variantOf(p), quantity: 3 },
        { productId: p.id, quantity: 2 },
      ],
    })
    assert.equal(await stockOf(variantOf(p)), 5)
  })

  test('a variant whose stock is not tracked sells without limit and stays untracked', async () => {
    const p = await fx.product()
    await fx.place({ items: [{ variantId: variantOf(p), quantity: 5000 }] })
    assert.equal(await stockOf(variantOf(p)), null)
  })

  test('not enough is OUT_OF_STOCK naming the variant and what is left, and nothing at all is kept', async () => {
    const [plenty, scarce] = [
      await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 10 }] }),
      await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 1 }] }),
    ]
    await assert.rejects(
      orderService.create(SHOP, {
        email: 'a@example.test',
        items: [
          { variantId: variantOf(plenty), quantity: 4 },
          { variantId: variantOf(scarce), quantity: 2 },
        ],
      }),
      (e: unknown) => {
        assert.ok(e instanceof OrderError)
        assert.equal(e.code, 'OUT_OF_STOCK')
        assert.deepEqual(e.data, { variantId: variantOf(scarce), available: 1 })
        return true
      },
    )
    assert.deepEqual(
      [await stockOf(variantOf(plenty)), await stockOf(variantOf(scarce)), await orderCount()],
      [10, 1, 0],
    )
  })

  test('the last unit goes to one of two orders placed at once', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 1 }] })
    const results = await Promise.allSettled([
      fx.place({ items: [{ variantId: variantOf(p), quantity: 1 }] }),
      fx.place({ items: [{ variantId: variantOf(p), quantity: 1 }] }),
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
    assert.equal(await stockOf(variantOf(p)), 0)
  })

  test('tells webhooks inventory.updated for what the order took', async () => {
    const sent = await fx.hook(['inventory.updated'])
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 10 }] })
    await orderService.create(SHOP, { email: 'a@example.test', items: [{ variantId: variantOf(p), quantity: 4 }] })
    const [delivery] = await sent()
    assert.deepEqual([delivery?.data.inventoryQuantity, delivery?.data.change, delivery?.data.reason], [6, -4, 'order'])
  })
})

describe('who the customer is', () => {
  test('an email makes a guest customer with the name and phone given; the same email again is the same customer', async () => {
    const a = await fx.place({ email: 'Guest@Example.test', name: 'Guest', phone: '+1' })
    const b = await fx.place({ email: 'guest@example.test' })
    assert.equal(a.customerId, b.customerId)
    const customer = await fx.customerService.getById(SHOP, a.customerId!)
    assert.deepEqual(
      [customer?.email, customer?.name, customer?.phone, a.email],
      ['guest@example.test', 'Guest', '+1', 'guest@example.test'],
    )
  })

  test('an existing customer is used as they are: their email is the order’s', async () => {
    const c = await fx.customer({ email: 'known@example.test' })
    const o = await fx.place({ customerId: c.id, email: 'ignored@example.test' })
    assert.deepEqual([o.customerId, o.email], [c.id, 'known@example.test'])
  })

  test('without a customer or an email, or with a customer of another shop, it is CUSTOMER_NOT_FOUND', async () => {
    const p = await fx.product()
    const items = [{ variantId: variantOf(p), quantity: 1 }]
    await assert.rejects(orderService.create(SHOP, { items }), refused('CUSTOMER_NOT_FOUND'))
    await assert.rejects(orderService.create(SHOP, { items, customerId: MISSING }), refused('CUSTOMER_NOT_FOUND'))
    await fx.otherShop()
    const theirs = await fx.customer({}, OTHER_SHOP)
    await assert.rejects(orderService.create(SHOP, { items, customerId: theirs.id }), refused('CUSTOMER_NOT_FOUND'))
  })
})

describe('what cannot be ordered', () => {
  test('an order with no lines is EMPTY_ORDER', async () => {
    await assert.rejects(orderService.create(SHOP, { email: 'a@example.test', items: [] }), refused('EMPTY_ORDER'))
  })

  test('a variant or product that is unknown or another shop’s is named, and nothing is placed', async () => {
    const theirs = await fx.product({}, OTHER_SHOP)
    for (const items of [[{ variantId: MISSING, quantity: 1 }], [{ variantId: variantOf(theirs), quantity: 1 }]])
      await assert.rejects(
        orderService.create(SHOP, { email: 'a@example.test', items }),
        (e: unknown) => e instanceof OrderError && e.code === 'VARIANT_NOT_FOUND' && e.data.variantIds?.length === 1,
      )
    await assert.rejects(
      orderService.create(SHOP, { email: 'a@example.test', items: [{ productId: MISSING, quantity: 1 }] }),
      (e: unknown) => e instanceof OrderError && e.code === 'PRODUCT_NOT_FOUND' && e.data.productIds?.[0] === MISSING,
    )
    assert.equal(await orderCount(), 0)
  })

  test('a product with several variants must be ordered by variant', async () => {
    const p = await fx.product({
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        { options: { Size: 'S' }, priceCents: 1 },
        { options: { Size: 'M' }, priceCents: 1 },
      ],
    })
    await assert.rejects(
      orderService.create(SHOP, { email: 'a@example.test', items: [{ productId: p.id, quantity: 1 }] }),
      refused('VARIANT_REQUIRED'),
    )
  })
})
