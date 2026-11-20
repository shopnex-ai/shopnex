import type { Conn } from '@shopnex/db'
// The public Storefront API for what a shopper does: the cart, signing in with an emailed code and the customer's own data, and checking out.
// Through the real router with an in-memory database. Domain errors come out as the contract's typed errors (code, status, data).
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ORPCError } from '@orpc/server'
import * as fx from './fixtures'

const { db, eq, sf, run, SHOP, MISSING } = fx

const typed = (code: string, status: number, data?: unknown) => (e: unknown) => {
  assert.ok(e instanceof ORPCError, String(e))
  assert.deepEqual([e.code, e.status], [code, status])
  if (data !== undefined) assert.deepEqual(e.data, data)
  return true
}
const badRequest = (domainCode: string) => (e: unknown) =>
  e instanceof ORPCError && e.code === 'BAD_REQUEST' && (e.data as { code?: string } | undefined)?.code === domainCode
type Cart = Record<string, any>
const variantOf = (p: Awaited<ReturnType<typeof fx.product>>) => p.variants[0]!.id
const money = (amountMinor: number, currencyCode = 'USD') => ({ amountMinor, currencyCode })

before(fx.setup)
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('the cart', () => {
  test('is made with lines or without, and shown the way the contract says: its token is its id, with live prices and a checkout link', async () => {
    const p = await fx.product({
      title: 'Tee',
      images: [{ url: 'https://example.com/tee.png' }],
      options: [{ name: 'Size', values: ['S'] }],
      variants: [{ options: { Size: 'S' }, priceCents: 1000, compareAtPriceCents: 1500, sku: 'TEE-S' }],
    })
    const empty = await run<Cart>(sf.cart!.create, {})
    assert.deepEqual(
      [empty.status, empty.totalQuantity, empty.lines, empty.discountCodes, empty.orderId],
      ['active', 0, [], [], null],
    )
    assert.equal(empty.checkoutUrl, `http://localhost:3000/checkout/${empty.id}`)
    const cart = await run<Cart>(sf.cart!.create, { lines: [{ merchandiseId: p.variants[0]!.id, quantity: 2 }] })
    const [line] = cart.lines
    assert.deepEqual(
      [
        line.quantity,
        line.merchandise.title,
        line.merchandise.sku,
        line.merchandise.selectedOptions,
        line.merchandise.image.url,
        line.merchandise.product,
        line.availableForSale,
      ],
      [
        2,
        'S',
        'TEE-S',
        [{ name: 'Size', value: 'S' }],
        'https://example.com/tee.png',
        { id: p.id, handle: 'tee', title: 'Tee' },
        true,
      ],
    )
    assert.deepEqual(line.cost, {
      amountPerQuantity: money(1000),
      compareAtAmountPerQuantity: money(1500),
      subtotalAmount: money(2000),
      totalAmount: money(2000),
    })
    assert.deepEqual([cart.cost, cart.totalQuantity], [{ subtotalAmount: money(2000), totalAmount: money(2000) }, 2])
    assert.deepEqual(await run(sf.cart!.get, { id: cart.id }), cart)
  })

  test('lines are added to what is there, set by line id (0 removes) and removed; each answer is the whole cart', async () => {
    const [a, b] = [await fx.product({ title: 'A' }), await fx.product({ title: 'B' })]
    const created = await run<Cart>(sf.cart!.create, { lines: [{ merchandiseId: variantOf(a), quantity: 1 }] })
    const added = await run<Cart>(sf.cart!.linesAdd, {
      cartId: created.id,
      lines: [
        { merchandiseId: variantOf(a), quantity: 2 },
        { merchandiseId: variantOf(b), quantity: 1 },
      ],
    })
    assert.deepEqual(added.lines.map((l: Cart) => [l.merchandise.product.title, l.quantity]).sort(), [
      ['A', 3],
      ['B', 1],
    ])
    const lineOf = (c: Cart, title: string) => c.lines.find((l: Cart) => l.merchandise.product.title === title).id
    const updated = await run<Cart>(sf.cart!.linesUpdate, {
      cartId: created.id,
      lines: [
        { id: lineOf(added, 'A'), quantity: 5 },
        { id: lineOf(added, 'B'), quantity: 0 },
      ],
    })
    assert.deepEqual(
      updated.lines.map((l: Cart) => [l.merchandise.product.title, l.quantity]),
      [['A', 5]],
    )
    const removed = await run<Cart>(sf.cart!.linesRemove, { cartId: created.id, lineIds: [lineOf(updated, 'A')] })
    assert.deepEqual([removed.lines, removed.totalQuantity], [[], 0])
  })

  test('a discount code is shown with what it takes off; an unknown one is kept but not applicable; [] removes it', async () => {
    const p = await fx.product({ priceCents: 1000 })
    const d = await fx.discountService.create(
      SHOP,
      {
        code: 'SAVE10',
        type: 'percentage',
        value: 10,
        minSubtotalCents: null,
        usageLimit: null,
        oncePerCustomer: false,
        active: true,
        startsAt: null,
        endsAt: null,
      },
      db,
    )
    const cart = await run<Cart>(sf.cart!.create, { lines: [{ merchandiseId: variantOf(p), quantity: 2 }] })
    const withCode = await run<Cart>(sf.cart!.discountCodesUpdate, { cartId: cart.id, discountCodes: ['save10'] })
    assert.deepEqual(withCode.discountCodes, [{ code: 'SAVE10', applicable: true }])
    assert.deepEqual(
      [withCode.cost.totalAmount, withCode.discountAllocations],
      [money(1800), [{ code: 'SAVE10', discountedAmount: money(200) }]],
    )
    assert.deepEqual(withCode.lines[0].discountAllocations, [{ code: 'SAVE10', discountedAmount: money(200) }])
    assert.deepEqual(
      [withCode.lines[0].cost.subtotalAmount, withCode.lines[0].cost.totalAmount],
      [money(2000), money(1800)],
    )
    const unknown = await run<Cart>(sf.cart!.discountCodesUpdate, { cartId: cart.id, discountCodes: ['NOSUCH'] })
    assert.deepEqual(
      [unknown.discountCodes, unknown.discountAllocations, unknown.cost.totalAmount],
      [[{ code: 'NOSUCH', applicable: false }], [], money(2000)],
    )
    assert.deepEqual(
      (await run<Cart>(sf.cart!.discountCodesUpdate, { cartId: cart.id, discountCodes: [] })).discountCodes,
      [],
    )
    assert.ok(d)
  })

  test('input is checked: one code at most, line quantities 1–999, ids are ids', async () => {
    const cart = await run<Cart>(sf.cart!.create, {})
    const bad = (e: unknown) => e instanceof ORPCError && e.code === 'BAD_REQUEST'
    await assert.rejects(run(sf.cart!.discountCodesUpdate, { cartId: cart.id, discountCodes: ['A', 'B'] }), bad)
    await assert.rejects(run(sf.cart!.linesAdd, { cartId: cart.id, lines: [] }), bad)
    await assert.rejects(
      run(sf.cart!.linesAdd, { cartId: cart.id, lines: [{ merchandiseId: MISSING, quantity: 1000 }] }),
      bad,
    )
    await assert.rejects(
      run(sf.cart!.linesAdd, { cartId: cart.id, lines: [{ merchandiseId: 'nope', quantity: 1 }] }),
      bad,
    )
    await assert.rejects(run(sf.cart!.linesRemove, { cartId: cart.id, lineIds: ['nope'] }), bad)
  })

  test('a cart that does not exist is NOT_FOUND (404 typed), on every route that takes one', async () => {
    const lines = [{ merchandiseId: MISSING, quantity: 1 }]
    await assert.rejects(run(sf.cart!.get, { id: 'cart_nope' }), typed('NOT_FOUND', 404))
    await assert.rejects(run(sf.cart!.linesAdd, { cartId: 'cart_nope', lines }), typed('NOT_FOUND', 404))
    await assert.rejects(
      run(sf.cart!.linesUpdate, { cartId: 'cart_nope', lines: [{ id: MISSING, quantity: 1 }] }),
      typed('NOT_FOUND', 404),
    )
    await assert.rejects(
      run(sf.cart!.linesRemove, { cartId: 'cart_nope', lineIds: [MISSING] }),
      typed('NOT_FOUND', 404),
    )
    await assert.rejects(
      run(sf.cart!.discountCodesUpdate, { cartId: 'cart_nope', discountCodes: [] }),
      typed('NOT_FOUND', 404),
    )
    await assert.rejects(run(sf.checkout!.options, { cartId: 'cart_nope' }), typed('NOT_FOUND', 404))
  })

  test('merchandise that cannot be bought is MERCHANDISE_NOT_FOUND naming it; a line that is not in the cart is LINE_NOT_FOUND naming it', async () => {
    const draft = await fx.product({ status: 'draft' })
    const cart = await run<Cart>(sf.cart!.create, {})
    await assert.rejects(
      run(sf.cart!.linesAdd, { cartId: cart.id, lines: [{ merchandiseId: variantOf(draft), quantity: 1 }] }),
      typed('MERCHANDISE_NOT_FOUND', 404, { merchandiseIds: [variantOf(draft)] }),
    )
    await assert.rejects(
      run(sf.cart!.create, { lines: [{ merchandiseId: MISSING, quantity: 1 }] }),
      typed('MERCHANDISE_NOT_FOUND', 404, { merchandiseIds: [MISSING] }),
    )
    await assert.rejects(
      run(sf.cart!.linesUpdate, { cartId: cart.id, lines: [{ id: MISSING, quantity: 1 }] }),
      typed('LINE_NOT_FOUND', 404, { lineIds: [MISSING] }),
    )
    await assert.rejects(
      run(sf.cart!.linesRemove, { cartId: cart.id, lineIds: [MISSING] }),
      typed('LINE_NOT_FOUND', 404, { lineIds: [MISSING] }),
    )
  })

  test('more than is in stock is OUT_OF_STOCK (400 typed) with the merchandise and how many are left', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 3 }] })
    const cart = await run<Cart>(sf.cart!.create, {})
    await assert.rejects(
      run(sf.cart!.linesAdd, { cartId: cart.id, lines: [{ merchandiseId: variantOf(p), quantity: 4 }] }),
      typed('OUT_OF_STOCK', 400, { merchandiseId: variantOf(p), available: 3 }),
    )
  })
})

describe('signing in', () => {
  test('requesting a code while the shop sends no email is CUSTOMER_LOGIN_UNAVAILABLE (503 typed); so is an email server that is down', async () => {
    await assert.rejects(
      run(sf.customer!.requestCode, { email: `a-${fx.unique()}@example.test` }),
      typed('CUSTOMER_LOGIN_UNAVAILABLE', 503),
    )
    await db.insert(fx.schemas.emailSettings).values({
      shopId: SHOP,
      active: true,
      config: {
        preset: 'other',
        host: '127.0.0.1',
        port: 1,
        username: '',
        fromName: 'S',
        fromEmail: 's@example.test',
      },
    })
    await assert.rejects(
      run(sf.customer!.requestCode, { email: `b-${fx.unique()}@example.test` }),
      typed('CUSTOMER_LOGIN_UNAVAILABLE', 503),
    )
  })

  test('asking again and again is TOO_MANY_REQUESTS (429 typed) after four; an address that is not one is refused by the input check', async () => {
    const email = `c-${fx.unique()}@example.test`
    for (let i = 0; i < 4; i++)
      await assert.rejects(run(sf.customer!.requestCode, { email }), typed('CUSTOMER_LOGIN_UNAVAILABLE', 503))
    await assert.rejects(run(sf.customer!.requestCode, { email }), typed('TOO_MANY_REQUESTS', 429))
    await assert.rejects(
      run(sf.customer!.requestCode, { email: 'nobody' }),
      (e: unknown) => e instanceof ORPCError && e.code === 'BAD_REQUEST',
    )
  })

  test('the code signs in: a token and the customer, made on the first sign-in; a wrong code is INVALID_CODE (400 typed)', async () => {
    const email = `d-${fx.unique()}@example.test`
    let code = ''
    await fx.accountService.requestLoginCode(
      SHOP,
      email,
      (_to, c) => {
        code = c
        return Promise.resolve()
      },
      db,
    )
    await assert.rejects(run(sf.customer!.signIn, { email, code: '000000' }), typed('INVALID_CODE', 400))
    const signedIn = await run<{ token: string; customer: Record<string, unknown> }>(sf.customer!.signIn, {
      email,
      code,
    })
    assert.ok(signedIn.token)
    assert.deepEqual(
      [signedIn.customer.email, signedIn.customer.name, signedIn.customer.customFields],
      [email, null, {}],
    )
  })

  test('ten wrong codes in a row, then TOO_MANY_REQUESTS (429 typed)', async () => {
    const email = `e-${fx.unique()}@example.test`
    for (let i = 0; i < 10; i++)
      await assert.rejects(run(sf.customer!.signIn, { email, code: '000000' }), typed('INVALID_CODE', 400))
    await assert.rejects(run(sf.customer!.signIn, { email, code: '000000' }), typed('TOO_MANY_REQUESTS', 429))
  })
})

describe('the customer’s own data', () => {
  test('without a token, or with one that is not valid, every route is UNAUTHORIZED (401 typed)', async () => {
    for (const headers of [{}, { [fx.CUSTOMER_TOKEN_HEADER]: 'nope' }] as Record<string, string>[]) {
      await assert.rejects(run(sf.customer!.get, undefined, headers), typed('UNAUTHORIZED', 401))
      await assert.rejects(run(sf.customer!.update, { name: 'x' }, headers), typed('UNAUTHORIZED', 401))
      await assert.rejects(run(sf.customer!.orders, { first: 5 }, headers), typed('UNAUTHORIZED', 401))
      await assert.rejects(run(sf.customer!.order, { id: MISSING }, headers), typed('UNAUTHORIZED', 401))
    }
  })

  test('get and update: the name and phone, and only the custom fields the shop shows', async () => {
    await fx.customFieldService.create(
      SHOP,
      { resource: 'customer', key: 'tier', label: 'Tier', type: 'text', storefront: true },
      db,
    )
    await fx.customFieldService.create(
      SHOP,
      { resource: 'customer', key: 'internal', label: 'Internal', type: 'text', storefront: false },
      db,
    )
    const { customer, headers } = await fx.customerWithToken()
    await fx.customerService.update(SHOP, customer.id, { customFields: { tier: 'gold', internal: 'x' } }, db)
    const got = await run<Record<string, unknown>>(sf.customer!.get, undefined, headers)
    assert.deepEqual([got.id, got.email, got.customFields], [customer.id, customer.email, { tier: 'gold' }])
    const updated = await run<Record<string, unknown>>(sf.customer!.update, { name: ' Ada ', phone: '+1' }, headers)
    assert.deepEqual([updated.name, updated.phone], ['Ada', '+1'])
    assert.equal((await run<Record<string, unknown>>(sf.customer!.update, { phone: null }, headers)).phone, null)
    await assert.rejects(
      run(sf.customer!.update, { name: '' }, headers),
      (e: unknown) => e instanceof ORPCError && e.code === 'BAD_REQUEST',
    )
  })

  test('signing out ends the token', async () => {
    const { headers } = await fx.customerWithToken()
    assert.ok(await run(sf.customer!.get, undefined, headers))
    assert.deepEqual(await run(sf.customer!.signOut, undefined, headers), { success: true })
    await assert.rejects(run(sf.customer!.get, undefined, headers), typed('UNAUTHORIZED', 401))
    assert.deepEqual(await run(sf.customer!.signOut), { success: true }, 'with no token there is nothing to end')
  })

  test('orders: their own, newest first, paged, with money in the order’s currency and payment instructions only while unpaid', async () => {
    const { customer, headers } = await fx.customerWithToken()
    const other = await fx.customerWithToken()
    const p = await fx.product({ priceCents: 1000 })
    const place = (customerId: string, quantity = 1) =>
      fx.orderService.create(
        SHOP,
        {
          customerId,
          items: [{ variantId: variantOf(p), quantity }],
          payment: { gateway: 'manual', name: 'Bank', instructions: 'Pay to IBAN 1' },
        },
        db,
      )
    const first = await place(customer.id)
    await new Promise((r) => setTimeout(r, 5))
    const second = await place(customer.id, 2)
    await place(other.customer.id)
    await fx.orderService.markAsPaid(SHOP, first.id, db)
    const list = await run<{ nodes: Array<Record<string, any>>; pageInfo: Record<string, unknown> }>(
      sf.customer!.orders,
      { first: 1 },
      headers,
    )
    assert.deepEqual([list.nodes.map((o) => o.orderNumber), list.pageInfo.hasNextPage], [[second.orderNumber], true])
    const [o] = list.nodes
    assert.deepEqual(
      [
        o!.totalPrice,
        o!.financialStatus,
        o!.fulfillmentStatus,
        o!.paymentMethod,
        o!.paymentInstructions,
        o!.lines.map((l: Record<string, any>) => [l.title, l.quantity, l.totalPrice]),
      ],
      [money(2000), 'pending', 'unfulfilled', 'Bank', 'Pay to IBAN 1', [[p.title, 2, money(2000)]]],
    )
    const next = await run<{ nodes: Array<Record<string, any>> }>(
      sf.customer!.orders,
      { first: 5, after: list.pageInfo.endCursor as string },
      headers,
    )
    assert.deepEqual(
      [next.nodes.map((n) => n.orderNumber), next.nodes[0]!.paymentInstructions],
      [[first.orderNumber], null],
    )
  })

  test('one order: their own with its fulfillments and shipping address; another customer’s looks like a missing one', async () => {
    const { customer, headers } = await fx.customerWithToken()
    const other = await fx.customerWithToken()
    const p = await fx.product()
    const mine = await fx.orderService.create(
      SHOP,
      {
        customerId: customer.id,
        items: [{ variantId: variantOf(p), quantity: 1 }],
        shippingAddress: {
          firstName: 'Ada',
          lastName: 'Buyer',
          company: null,
          address1: '1 Main',
          address2: null,
          city: 'Paris',
          province: null,
          countryCode: 'FR',
          zip: '75001',
          phone: null,
        },
      },
      db,
    )
    await fx.orderService.fulfill(SHOP, mine.id, db, { trackingNumber: 'T1' })
    const theirs = await fx.orderService.create(
      SHOP,
      {
        customerId: other.customer.id,
        items: [{ variantId: variantOf(p), quantity: 1 }],
      },
      db,
    )
    const got = await run<Record<string, any>>(sf.customer!.order, { id: mine.id }, headers)
    assert.deepEqual(
      [
        got.id,
        got.fulfillmentStatus,
        got.fulfillments[0].trackingNumber,
        got.shippingAddress.name,
        got.shippingAddress.city,
      ],
      [mine.id, 'fulfilled', 'T1', 'Ada Buyer', 'Paris'],
    )
    await assert.rejects(run(sf.customer!.order, { id: theirs.id }, headers), typed('NOT_FOUND', 404))
    await assert.rejects(run(sf.customer!.order, { id: MISSING }, headers), typed('NOT_FOUND', 404))
  })
})

describe('checking out', () => {
  async function ready() {
    const rate = await db
      .insert(fx.schemas.shippingRates)
      .values({ shopId: SHOP, name: 'Standard', priceCents: 500 })
      .returning()
      .then((r) => r[0]!)
    const method = await fx.paymentMethodService.create(
      SHOP,
      { name: 'Bank transfer', active: true, additionalDetails: 'Details', instructions: 'Pay by transfer' },
      db,
    )
    const p = await fx.product({ title: 'Tee', priceCents: 2000 })
    const cart = await run<Cart>(sf.cart!.create, { lines: [{ merchandiseId: variantOf(p), quantity: 2 }] })
    return { rate, method, p, cart }
  }

  test('options: the cost for a rate (the first by default), the shipping rates priced for the cart and the payment methods', async () => {
    const { rate, method, cart } = await ready()
    const o = await run<Record<string, any>>(sf.checkout!.options, { cartId: cart.id })
    assert.deepEqual(o.cost, {
      subtotalAmount: money(4000),
      shippingAmount: money(500),
      discountAmount: money(0),
      totalTaxAmount: null,
      taxesIncluded: false,
      totalAmount: money(4500),
      giftCardAmount: null,
      giftCardError: null,
      dueAmount: money(4500),
    })
    assert.deepEqual(o.shippingRates, [{ id: rate.id, title: 'Standard', description: null, price: money(500) }])
    assert.deepEqual(o.paymentMethods, [
      { id: method.id, name: 'Bank transfer', additionalDetails: 'Details', offsite: false },
    ])
    const withAddress = await run<Record<string, any>>(sf.checkout!.options, {
      cartId: cart.id,
      shippingRateId: rate.id,
      countryCode: 'FR',
    })
    assert.equal(withAddress.cost.totalTaxAmount.amountMinor, 0, 'with an address tax is known (here: no rate)')
    await assert.rejects(
      run(sf.checkout!.options, { cartId: cart.id, shippingRateId: MISSING }),
      badRequest('INVALID_SHIPPING_RATE'),
    )
    await assert.rejects(
      run(sf.checkout!.options, { cartId: cart.id, countryCode: 'france' }),
      (e: unknown) => e instanceof ORPCError && e.code === 'BAD_REQUEST',
    )
  })

  test('complete places the order with the buyer, address, rate and method; completing again gives the same order', async () => {
    const { rate, method, cart } = await ready()
    const input = {
      cartId: cart.id,
      email: 'Buyer@Example.test',
      name: 'Ada Buyer',
      shippingAddress: { lastName: 'Buyer', address1: '1 Main St', city: 'Paris', countryCode: 'FR' },
      shippingRateId: rate.id,
      paymentMethodId: method.id,
      note: 'Gift',
    }
    const placed = await run<Record<string, any>>(sf.checkout!.complete, input)
    assert.deepEqual(
      [placed.alreadyCompleted, placed.orderNumber, placed.paymentUrl, placed.paymentError],
      [false, 1001, null, null],
    )
    const order = (await fx.orderService.getById(SHOP, placed.orderId, db))!
    assert.deepEqual(
      [
        order.email,
        order.totalCents,
        order.shippingCents,
        order.paymentMethodName,
        order.note,
        order.shippingAddress?.city,
        order.shippingAddress?.countryCode,
      ],
      ['buyer@example.test', 4500, 500, 'Bank transfer', 'Gift', 'Paris', 'FR'],
    )
    const again = await run<Record<string, any>>(sf.checkout!.complete, input)
    assert.deepEqual([again.orderId, again.alreadyCompleted], [placed.orderId, true])
    assert.equal((await run<Cart>(sf.cart!.get, { id: cart.id })).status, 'completed')
    await assert.rejects(
      run(sf.cart!.linesAdd, { cartId: cart.id, lines: [{ merchandiseId: MISSING, quantity: 1 }] }),
      typed('CART_COMPLETED', 409),
    )
  })

  test('complete refuses what cannot be placed: an empty cart (EMPTY_CART 400 typed), an unknown rate or method, a product withdrawn meanwhile', async () => {
    const { rate, p, cart } = await ready()
    const empty = await run<Cart>(sf.cart!.create, {})
    await assert.rejects(
      run(sf.checkout!.complete, { cartId: empty.id, email: 'a@example.test' }),
      typed('EMPTY_CART', 400),
    )
    await assert.rejects(
      run(sf.checkout!.complete, { cartId: cart.id, email: 'a@example.test', shippingRateId: MISSING }),
      badRequest('INVALID_SHIPPING_RATE'),
    )
    await assert.rejects(
      run(sf.checkout!.complete, { cartId: cart.id, email: 'a@example.test', paymentMethodId: MISSING }),
      badRequest('INVALID_PAYMENT_METHOD'),
    )
    await fx.productService.update(SHOP, p.id, { status: 'archived' }, db)
    await assert.rejects(
      run(sf.checkout!.complete, { cartId: cart.id, email: 'a@example.test', shippingRateId: rate.id }),
      typed('MERCHANDISE_NOT_FOUND', 404, { merchandiseIds: [variantOf(p)] }),
    )
    await assert.rejects(
      run(sf.checkout!.complete, { cartId: 'cart_nope', email: 'a@example.test' }),
      typed('NOT_FOUND', 404),
    )
    await assert.rejects(
      run(sf.checkout!.complete, { cartId: cart.id, email: 'nobody' }),
      (e: unknown) => e instanceof ORPCError && e.code === 'BAD_REQUEST',
    )
  })

  test('a product that sold out meanwhile is OUT_OF_STOCK (400 typed) at checkout, and nothing is placed', async () => {
    const p = await fx.product({ variants: [{ priceCents: 100, inventoryQuantity: 5 }] })
    const cart = await run<Cart>(sf.cart!.create, { lines: [{ merchandiseId: variantOf(p), quantity: 3 }] })
    await fx.productService.setVariants(
      SHOP,
      p.id,
      {
        options: [],
        variants: [{ priceCents: 100, inventoryQuantity: 1 }],
      },
      db,
    )
    await assert.rejects(
      run(sf.checkout!.complete, { cartId: cart.id, email: 'a@example.test' }),
      (e: unknown) => e instanceof ORPCError && e.code === 'OUT_OF_STOCK' && e.status === 400,
    )
    assert.equal((await db.select().from(fx.schemas.orders).where(eq(fx.schemas.orders.shopId, SHOP))).length, 0)
  })
})

describe('checking out with a payments app', () => {
  let provider: Server
  let providerUrl = ''
  const asked: { url: string; body: Record<string, any> }[] = []
  let answers: 'redirect' | 'down' = 'redirect'

  before(async () => {
    provider = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      asked.push({ url: req.url ?? '', body: body ? JSON.parse(body) : {} })
      if (answers === 'down') return res.writeHead(503).end('down')
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ redirectUrl: `${providerUrl}/pay/1` }))
    })
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
    providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
  })
  after(() => new Promise((resolve) => provider.close(resolve)))
  beforeEach(() => {
    asked.length = 0
    answers = 'redirect'
  })

  async function cardCart() {
    const { appService } = await import('@shopnex/apps')
    const { paymentsAppService } = await import('@shopnex/payments')
    const { app } = await appService.registerApp(
      {
        name: `Card ${fx.unique()}`,
        appUrl: `${providerUrl}/app`,
        redirectUrls: [],
        scopes: ['write_payment_sessions'],
      },
      null,
    )
    await appService.installManaged({
      appId: app.id,
      shopId: SHOP,
      userId: null as unknown as string,
      scopes: ['write_payment_sessions'],
    })
    await paymentsAppService.configure(
      SHOP,
      app.id,
      {
        name: 'Card',
        gateway: 'test',
        paymentSessionUrl: `${providerUrl}/session`,
        refundSessionUrl: `${providerUrl}/refund`,
        ready: true,
      },
      db,
    )
    const [method] = await db
      .select()
      .from(fx.schemas.paymentMethods)
      .where(eq(fx.schemas.paymentMethods.appId, app.id))
    const p = await fx.product({ priceCents: 1400 })
    const cart = await run<Cart>(sf.cart!.create, { lines: [{ merchandiseId: variantOf(p), quantity: 1 }] })
    return { app, method: method!, cart }
  }
  const cleanApps = async (appId: string) => {
    const { apps } = await import('@shopnex/core/schema')
    await db.delete(apps).where(eq(apps.id, appId))
  }

  test('the payment method is offered as off-site, the buyer is sent to the provider’s page, and the provider is told where to send them back: the cart’s checkout page', async () => {
    const { app, method, cart } = await cardCart()
    const options = await run<Record<string, any>>(sf.checkout!.options, { cartId: cart.id })
    assert.deepEqual(
      options.paymentMethods.map((m: Record<string, unknown>) => [m.name, m.offsite]),
      [['Card', true]],
    )
    const placed = await run<Record<string, any>>(sf.checkout!.complete, {
      cartId: cart.id,
      email: 'a@example.test',
      paymentMethodId: method.id,
    })
    assert.deepEqual(
      [placed.paymentUrl, placed.paymentError, placed.alreadyCompleted],
      [`${providerUrl}/pay/1`, null, false],
    )
    const session = asked.find((a) => a.url === '/session')!
    assert.equal(session.body.returnUrl, `http://localhost:3000/checkout/${cart.id}`)
    assert.deepEqual(session.body.amount, { cents: 1400, currency: 'USD' })
    await cleanApps(app.id)
  })

  test('a provider that is down leaves the order placed and unpaid, with the reason; completing again retries', async () => {
    const { app, method, cart } = await cardCart()
    answers = 'down'
    const first = await run<Record<string, any>>(sf.checkout!.complete, {
      cartId: cart.id,
      email: 'a@example.test',
      paymentMethodId: method.id,
    })
    assert.deepEqual([first.paymentUrl, typeof first.paymentError, first.alreadyCompleted], [null, 'string', false])
    answers = 'redirect'
    const again = await run<Record<string, any>>(sf.checkout!.complete, {
      cartId: cart.id,
      email: 'a@example.test',
      paymentMethodId: method.id,
    })
    assert.deepEqual(
      [again.orderId, again.alreadyCompleted, again.paymentUrl],
      [first.orderId, true, `${providerUrl}/pay/1`],
    )
    await cleanApps(app.id)
  })
})
