// Cross-shop access by id. Shop A owns a resource; shop B (an empty second shop, every API scope) is handed A's id
// on each route that takes one. The only acceptable answer is "not found" (or "forbidden"), and A's resource must be
// exactly as it was afterwards.
//
// A 400 is NOT accepted as a refusal: the API validates the body before it looks anything up, so a request with a
// bad body would be turned away for the wrong reason and hide a real hole. Every attack therefore sends a valid body.
//
// This file covers the routes an API token can reach, and the storefront (shop B's publishable key). Routes that need
// a staff session (tax rates, shipping rates, payment methods, channels, domains, staff, storefront keys, API tokens)
// are listed in PENDING below until they get their own cases.
//
// A staff session cannot be used to attack from shop B here: this suite runs against a server in single mode, where a
// staff session always acts in the default shop, so shop B's owner is refused everywhere for not being a member of
// it, whatever the route does with the id. Only attacks made with an API token or a storefront key prove anything.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, like } from 'drizzle-orm'
import { db } from '@shopnex/db'
import { API, Fixtures, SHOP, call, closeDb, ok, requireApp, sellableVariants } from '../lib'
import { API_SCOPES } from '@shopnex/core/schema'
import { accountService } from '@shopnex/customers'
import { customers } from '@shopnex/customers/schema'
import { orderService } from '@shopnex/orders'
import { orders } from '@shopnex/orders/schema'
import { DEFAULT_SHOP_ID } from '@shopnex/tenancy'

const fx = new Fixtures()
const run = Date.now().toString(36)

let a: Record<string, string> // shop A: the default shop
let b: Record<string, string> // shop B: someone else, with every scope
let otherId: string
let ownerA: Record<string, string> // staff session, owner of shop A
let ownerB: Record<string, string> // staff session, owner of shop B (see the note at the top: not usable to attack)
let keyB: Record<string, string> // shop B's publishable key: storefront requests made as shop B

const CUSTOMER_TOKEN = 'x-shopnex-customer-token'

type Attack = { method: string; path: string; body?: unknown }
const covered = new Set<string>() // "METHOD /openapi/path/{param}" of every route attacked below

/** Marks the route as covered (by its OpenAPI path, so the coverage check can compare) and sends it as shop B */
async function attack(openapiPath: string, { method, path, body }: Attack, as: Record<string, string> = b) {
  covered.add(`${method} ${openapiPath}`)
  return call(method, path, body, as)
}

/** Shop B is turned away: 404 (or 403). Anything else, including 400 and 2xx, is a failure */
function assertRefused(r: { status: number; body: unknown }, what: string) {
  assert.ok(
    r.status === 404 || r.status === 403,
    `${what}: expected 404/403, got ${r.status} ${JSON.stringify(r.body)}` +
      (r.status === 400 ? ' (the request body was rejected: fix the test so it sends a valid one)' : ''),
  )
}

const cleanup: (() => Promise<unknown>)[] = []

// A case that fails partway never records the routes after the failure as covered, so the coverage check would
// fail too, for a reason that has nothing to do with coverage. It reports only when every case ran to the end.
const cases = { started: 0, finished: 0 }
function isolated(name: string, fn: () => Promise<void>) {
  test(name, async () => {
    cases.started++
    await fn()
    cases.finished++
  })
}

before(async () => {
  await requireApp()
  await fx.init()
  otherId = (await fx.shop()).id
  a = await fx.token([...API_SCOPES])
  b = await fx.token([...API_SCOPES], otherId)
  ownerA = (await fx.account('owner')).headers
  ownerB = (await fx.account('owner', otherId)).headers
  keyB = { 'x-shopnex-key': (await fx.storefrontKey(otherId)).token }
  // Control: the key really puts a storefront request in shop B. Without this, every refusal below could be a key
  // that resolves to nothing.
  assert.equal(ok(await call('GET', '/storefront/shop', undefined, keyB)).id, otherId, 'shop B’s key reaches shop B')
})

after(async () => {
  for (const undo of cleanup.reverse()) await undo().catch(() => {})
  await fx.cleanup()
  // Placing the manual order created a customer from its email
  await db.delete(customers).where(like(customers.email, 'e2e-iso-%'))
  await closeDb()
})

describe('shop B cannot reach shop A by id', () => {
  isolated('products and variants', async () => {
    const p = ok(await call('POST', '/admin/products', { title: `E2E iso ${run}`, priceCents: 1500 }, a))
    cleanup.push(() => call('DELETE', '/admin/products/bulk', { ids: [p.id] }, a))
    const variantId = p.variants[0].id as string

    assertRefused(await attack('/admin/products/{id}', { method: 'GET', path: `/admin/products/${p.id}` }), 'GET')
    assertRefused(
      await attack('/admin/products/{id}', {
        method: 'PATCH',
        path: `/admin/products/${p.id}`,
        body: { title: 'hacked' },
      }),
      'PATCH',
    )
    assertRefused(
      await attack('/admin/products/{id}/publications', {
        method: 'GET',
        path: `/admin/products/${p.id}/publications`,
      }),
      'GET publications',
    )
    assertRefused(
      await attack('/admin/variants/{variantId}', {
        method: 'PATCH',
        path: `/admin/variants/${variantId}`,
        body: { priceCents: 1 },
      }),
      'PATCH variant',
    )

    // Bulk delete takes ids in the body: B names A's product and nothing of A's may go
    covered.add('DELETE /admin/products/bulk')
    const bulk = await call('DELETE', '/admin/products/bulk', { ids: [p.id] }, b)
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body))
    assert.equal(
      bulk.body.count ?? bulk.body.deleted ?? 0,
      0,
      `bulk delete removed A's product: ${JSON.stringify(bulk.body)}`,
    )

    const still = ok(await call('GET', `/admin/products/${p.id}`, undefined, a))
    assert.equal(still.title, `E2E iso ${run}`, 'A left alone')
    assert.equal(ok(await call('GET', '/admin/products', undefined, b)).total, 0, 'not in B’s list')
  })

  isolated('collections', async () => {
    const c = ok(await call('POST', '/admin/collections', { title: `E2E iso col ${run}` }, a))
    cleanup.push(() => call('DELETE', `/admin/collections/${c.id}`, undefined, a))

    // A product inside the collection, so an empty answer for B means "nothing shown", not "nothing there"
    const inside = ok(await call('POST', '/admin/products', { title: `E2E iso member ${run}`, priceCents: 900 }, a))
    cleanup.push(() => call('DELETE', '/admin/products/bulk', { ids: [inside.id] }, a))
    ok(await call('POST', `/admin/collections/${c.id}/products`, { productId: inside.id }, a))
    assert.equal(
      ok(await call('GET', `/admin/collections/${c.id}/products`, undefined, a)).length,
      1,
      'A sees its member',
    )

    // Listing the members of a collection that is not B's: a refusal, or an empty list with none of A's data in it
    const members = await attack('/admin/collections/{id}/products', {
      method: 'GET',
      path: `/admin/collections/${c.id}/products`,
    })
    assert.ok(
      members.status === 404 || members.status === 403 || (members.status === 200 && members.body.length === 0),
      `GET members: B must get a refusal or an empty list, got ${members.status} ${JSON.stringify(members.body)}`,
    )
    assertRefused(
      await attack('/admin/collections/{id}/products', {
        method: 'POST',
        path: `/admin/collections/${c.id}/products`,
        body: { productId: inside.id },
      }),
      'POST member',
    )
    assertRefused(
      await attack('/admin/collections/{id}/products/{productId}', {
        method: 'DELETE',
        path: `/admin/collections/${c.id}/products/${inside.id}`,
      }),
      'DELETE member',
    )
    assert.equal(
      ok(await call('GET', `/admin/collections/${c.id}/products`, undefined, a)).length,
      1,
      'A still has its member',
    )

    for (const [m, p, body] of [
      ['GET', '/admin/collections/{id}'],
      ['PATCH', '/admin/collections/{id}', { title: 'hacked' }],
      ['GET', '/admin/collections/{id}/publications'],
    ] as const) {
      assertRefused(await attack(p, { method: m, path: p.replace('{id}', c.id), body }), `${m} ${p}`)
    }
    covered.add('DELETE /admin/collections/bulk')
    const bulk = await call('DELETE', '/admin/collections/bulk', { ids: [c.id] }, b)
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body))
    assert.equal(
      bulk.body.count ?? bulk.body.deleted ?? 0,
      0,
      `bulk delete removed A's collection: ${JSON.stringify(bulk.body)}`,
    )
    assertRefused(
      await attack('/admin/collections/{id}', { method: 'DELETE', path: `/admin/collections/${c.id}` }),
      'DELETE',
    )

    assert.equal(ok(await call('GET', `/admin/collections/${c.id}`, undefined, a)).title, `E2E iso col ${run}`)
  })

  isolated('customers', async () => {
    const c = ok(
      await call(
        'POST',
        '/admin/customers',
        { email: `e2e-iso-${run}@example.com`, name: 'Iso Customer', phone: '+15550100' },
        a,
      ),
    )
    cleanup.push(() => call('DELETE', '/admin/customers/bulk', { ids: [c.id] }, a))

    assertRefused(await attack('/admin/customers/{id}', { method: 'GET', path: `/admin/customers/${c.id}` }), 'GET')
    assertRefused(
      await attack('/admin/customers/{id}', {
        method: 'PATCH',
        path: `/admin/customers/${c.id}`,
        body: { name: 'hacked' },
      }),
      'PATCH',
    )
    assertRefused(
      await attack('/admin/customers/{id}/data-export', {
        method: 'GET',
        path: `/admin/customers/${c.id}/data-export`,
      }),
      'data-export',
    )
    // Erasing needs a staff session (owners and admins), never a token: shop B's owner is the one to turn away
    assertRefused(
      await attack('/admin/customers/{id}/erase', { method: 'POST', path: `/admin/customers/${c.id}/erase` }, ownerB),
      'erase',
    )
    covered.add('DELETE /admin/customers/bulk')
    const bulk = await call('DELETE', '/admin/customers/bulk', { ids: [c.id] }, b)
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body))
    assert.equal(
      bulk.body.count ?? bulk.body.deleted ?? 0,
      0,
      `bulk delete removed A's customer: ${JSON.stringify(bulk.body)}`,
    )

    assert.equal(ok(await call('GET', `/admin/customers/${c.id}`, undefined, a)).name, 'Iso Customer')
  })

  isolated('discounts', async () => {
    const d = ok(await call('POST', '/admin/discounts', { code: `E2E${run}ISO2`, type: 'percentage', value: 10 }, a))
    fx.discount(d.id)

    assertRefused(await attack('/admin/discounts/{id}', { method: 'GET', path: `/admin/discounts/${d.id}` }), 'GET')
    assertRefused(
      await attack('/admin/discounts/{id}', { method: 'PATCH', path: `/admin/discounts/${d.id}`, body: { value: 99 } }),
      'PATCH',
    )
    covered.add('DELETE /admin/discounts/bulk')
    const bulk = await call('DELETE', '/admin/discounts/bulk', { ids: [d.id] }, b)
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body))
    assert.equal(
      bulk.body.count ?? bulk.body.deleted ?? 0,
      0,
      `bulk delete removed A's discount: ${JSON.stringify(bulk.body)}`,
    )
    assertRefused(
      await attack('/admin/discounts/{id}', { method: 'DELETE', path: `/admin/discounts/${d.id}` }),
      'DELETE',
    )

    assert.equal(ok(await call('GET', `/admin/discounts/${d.id}`, undefined, a)).value, 10)
  })

  isolated('gift cards', async () => {
    const g = ok(await call('POST', '/admin/gift-cards', { amountCents: 5000 }, a))
    fx.giftCard(g.id)

    assertRefused(await attack('/admin/gift-cards/{id}', { method: 'GET', path: `/admin/gift-cards/${g.id}` }), 'GET')
    assertRefused(
      await attack('/admin/gift-cards/{id}/adjust', {
        method: 'POST',
        path: `/admin/gift-cards/${g.id}/adjust`,
        body: { amountCents: -5000 },
      }),
      'adjust',
    )
    assertRefused(
      await attack('/admin/gift-cards/{id}/disable', { method: 'POST', path: `/admin/gift-cards/${g.id}/disable` }),
      'disable',
    )
    assertRefused(
      await attack('/admin/gift-cards/{id}/enable', { method: 'POST', path: `/admin/gift-cards/${g.id}/enable` }),
      'enable',
    )

    const still = ok(await call('GET', `/admin/gift-cards/${g.id}`, undefined, a))
    assert.equal(still.balanceCents, 5000, 'A’s card keeps its balance')
    assert.equal(still.active, true, 'A’s card is still active')
  })

  isolated('store imports', async () => {
    const id = await fx.storeImport(DEFAULT_SHOP_ID)
    assertRefused(
      await attack('/admin/store-import/{id}', { method: 'GET', path: `/admin/store-import/${id}` }, ownerB),
      'GET',
    )
    assert.equal(ok(await call('GET', `/admin/store-import/${id}`, undefined, ownerA)).status, 'done')
    // Importing writes products, pages and the theme: owners and admins from a session only, never an API token
    const token = await call('POST', '/admin/store-import', { url: 'store.example.com' }, a)
    assert.ok(
      token.status === 401 || token.status === 403,
      `an API token must not start an import: ${token.status} ${JSON.stringify(token.body)}`,
    )
  })

  isolated('orders', async () => {
    const p = ok(await call('POST', '/admin/products', { title: `E2E iso order ${run}`, priceCents: 2500 }, a))
    cleanup.push(() => call('DELETE', '/admin/products/bulk', { ids: [p.id] }, a))
    const created = ok(
      await call(
        'POST',
        '/admin/orders',
        {
          email: `e2e-iso-order-${run}@example.com`,
          name: 'Iso Buyer',
          items: [{ variantId: p.variants[0].id, quantity: 1 }],
        },
        a,
      ),
    )
    const orderId = (created.id ?? created.order?.id) as string
    assert.ok(orderId, JSON.stringify(created))
    fx.order(orderId)

    assertRefused(await attack('/admin/orders/{id}', { method: 'GET', path: `/admin/orders/${orderId}` }), 'GET')
    assertRefused(
      await attack('/admin/orders/{id}/mark-as-paid', {
        method: 'POST',
        path: `/admin/orders/${orderId}/mark-as-paid`,
      }),
      'mark-as-paid',
    )
    assertRefused(
      await attack('/admin/orders/{id}/fulfill', {
        method: 'POST',
        path: `/admin/orders/${orderId}/fulfill`,
        body: {},
      }),
      'fulfill',
    )
    assertRefused(
      await attack('/admin/orders/{id}/cancel', {
        method: 'POST',
        path: `/admin/orders/${orderId}/cancel`,
        body: { reason: 'other', restock: false },
      }),
      'cancel',
    )
    assertRefused(
      await attack('/admin/orders/{id}/refund', {
        method: 'POST',
        path: `/admin/orders/${orderId}/refund`,
        body: { amountCents: 100 },
      }),
      'refund',
    )
    covered.add('DELETE /admin/orders/bulk')
    const bulk = await call('DELETE', '/admin/orders/bulk', { ids: [orderId] }, b)
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body))
    assert.equal(
      bulk.body.count ?? bulk.body.deleted ?? 0,
      0,
      `bulk delete removed A's order: ${JSON.stringify(bulk.body)}`,
    )

    const still = ok(await call('GET', `/admin/orders/${orderId}`, undefined, a))
    assert.equal(still.financialStatus ?? still.financial_status, 'pending', 'A’s order is still unpaid')
    assert.ok(!still.cancelledAt && !still.cancelled, 'A’s order is not cancelled')
  })

  // KNOWN WEAK: shop B's owner attacks with a staff session, and in single mode that session acts in the default shop,
  // where B's owner is no member: every call below is a 403 whatever the routes do with the id (shop B's owner cannot
  // even create a page in shop B, which a control would show). It catches a route that stops checking membership, not
  // one that forgets to scope by shop. It needs a multi-mode server to prove more.
  isolated('pages and menus', async () => {
    const page = ok(await call('POST', '/admin/pages', { title: `E2E iso page ${run}` }, ownerA))
    cleanup.push(() => call('DELETE', `/admin/pages/${page.id}`, undefined, ownerA))
    assertRefused(
      await attack('/admin/pages/{id}', { method: 'GET', path: `/admin/pages/${page.id}` }, ownerB),
      'GET page',
    )
    assertRefused(
      await attack(
        '/admin/pages/{id}',
        { method: 'PATCH', path: `/admin/pages/${page.id}`, body: { title: 'hacked' } },
        ownerB,
      ),
      'PATCH page',
    )
    assertRefused(
      await attack('/admin/pages/{id}', { method: 'DELETE', path: `/admin/pages/${page.id}` }, ownerB),
      'DELETE page',
    )
    assert.equal(ok(await call('GET', `/admin/pages/${page.id}`, undefined, ownerA)).title, `E2E iso page ${run}`)

    const menu = ok(
      await call('POST', '/admin/menus', { handle: `e2e-iso-${run}`, title: `E2E iso menu ${run}`, items: [] }, ownerA),
    )
    cleanup.push(() => call('DELETE', `/admin/menus/${menu.id}`, undefined, ownerA))
    assertRefused(
      await attack('/admin/menus/{id}', { method: 'GET', path: `/admin/menus/${menu.id}` }, ownerB),
      'GET menu',
    )
    assertRefused(
      await attack(
        '/admin/menus/{id}',
        { method: 'PATCH', path: `/admin/menus/${menu.id}`, body: { title: 'hacked' } },
        ownerB,
      ),
      'PATCH menu',
    )
    assertRefused(
      await attack('/admin/menus/{id}', { method: 'DELETE', path: `/admin/menus/${menu.id}` }, ownerB),
      'DELETE menu',
    )
    assert.equal(ok(await call('GET', `/admin/menus/${menu.id}`, undefined, ownerA)).title, `E2E iso menu ${run}`)
  })
})

/** Shop B is turned away, with "not signed in" counted too: the customer token is shop A's, so B has no such customer */
function assertDenied(r: { status: number; body: unknown }, what: string) {
  assert.ok(
    r.status === 401 || r.status === 403 || r.status === 404,
    `${what}: expected 401/403/404, got ${r.status} ${JSON.stringify(r.body)}`,
  )
}

/** A customer token for `email` in `shopId`, through the same service the storefront sign-in route calls */
async function customerToken(shopId: string, email: string) {
  let code = ''
  await accountService.requestLoginCode(
    shopId,
    email,
    async (_to, c) => {
      code = c
    },
    db,
  )
  return (await accountService.verifyLoginCode(shopId, email, code, db)).token
}

const ADDRESS = {
  firstName: 'Iso',
  lastName: 'Tester',
  company: null,
  address1: '1 Main St',
  address2: null,
  city: 'Somewhere',
  province: null,
  countryCode: 'US',
  zip: '10001',
  phone: null,
}

// The storefront's own shape: optional fields are left out, not null (null is a validation error there)
const STOREFRONT_ADDRESS = {
  firstName: 'Iso',
  lastName: 'Tester',
  address1: '1 Main St',
  city: 'Somewhere',
  countryCode: 'US',
  zip: '10001',
}

// The storefront is public: shop B's publishable key is all an attacker needs. A cart id is a secret that stands
// for the cart, so another shop's key must not open it either.
describe('shop B’s storefront cannot reach shop A by id or handle', () => {
  isolated('carts', async () => {
    const [variant] = await sellableVariants(1)
    assert.ok(variant, 'the demo catalog has a sellable variant')
    const cart = await fx.cart([{ merchandiseId: variant.id, quantity: 1 }])
    const lineId = cart.lines[0].id as string
    assert.equal(ok(await call('GET', `/storefront/carts/${cart.id}`)).totalQuantity, 1, 'A sees its cart')

    const email = `e2e-iso-cart-${run}@example.com`
    const base = `/storefront/carts/${cart.id}`
    assertRefused(await attack('/storefront/carts/{id}', { method: 'GET', path: base }, keyB), 'GET cart')
    assertRefused(
      await attack(
        '/storefront/carts/{cartId}/checkout-options',
        { method: 'GET', path: `${base}/checkout-options` },
        keyB,
      ),
      'GET checkout-options',
    )
    assertRefused(
      await attack(
        '/storefront/carts/{cartId}/lines',
        { method: 'POST', path: `${base}/lines`, body: { lines: [{ merchandiseId: variant.id, quantity: 1 }] } },
        keyB,
      ),
      'POST lines',
    )
    assertRefused(
      await attack(
        '/storefront/carts/{cartId}/lines',
        { method: 'PATCH', path: `${base}/lines`, body: { lines: [{ id: lineId, quantity: 5 }] } },
        keyB,
      ),
      'PATCH lines',
    )
    assertRefused(
      await attack(
        '/storefront/carts/{cartId}/lines/remove',
        { method: 'POST', path: `${base}/lines/remove`, body: { lineIds: [lineId] } },
        keyB,
      ),
      'remove lines',
    )
    assertRefused(
      await attack(
        '/storefront/carts/{cartId}/discount-codes',
        { method: 'PUT', path: `${base}/discount-codes`, body: { discountCodes: ['E2EISO'] } },
        keyB,
      ),
      'PUT discount-codes',
    )
    assertRefused(
      await attack(
        '/storefront/carts/{cartId}/complete',
        { method: 'POST', path: `${base}/complete`, body: { email, shippingAddress: STOREFRONT_ADDRESS } },
        keyB,
      ),
      'complete',
    )

    const still = ok(await call('GET', base))
    assert.equal(still.lines.length, 1, 'A’s cart has the line it had')
    assert.equal(still.lines[0].quantity, 1, 'A’s line quantity is unchanged')
    assert.equal(still.status, 'active', 'A’s cart was not completed')
    assert.equal((await db.select().from(orders).where(eq(orders.email, email))).length, 0, 'no order was placed')
  })

  isolated('customer orders', async () => {
    const [variant] = await sellableVariants(1)
    assert.ok(variant)
    // The same address is a customer in both shops: the situation the sign-in code bug (GHSA-w9q2-8c32-gmhm) abused
    const email = `e2e-iso-buyer-${run}@example.com`
    const order = await orderService.create(
      SHOP,
      {
        email,
        name: 'Iso Buyer',
        items: [{ variantId: variant.id, quantity: 1 }],
        shippingAddress: ADDRESS,
        payment: { gateway: 'manual', name: 'Bank transfer', instructions: 'IBAN 123' },
      },
      db,
    )
    fx.order(order.id)
    const tokenA = await customerToken(SHOP, email)
    const tokenB = await customerToken(otherId, email)
    const path = `/storefront/customer/orders/${order.id}`

    const mine = await call('GET', path, undefined, { [CUSTOMER_TOKEN]: tokenA })
    assert.equal(mine.status, 200, `control: A's customer reads A's order, got ${mine.status}`)

    // A's token, B's key: the token belongs to another shop, so nobody is signed in at B
    assertDenied(
      await attack('/storefront/customer/orders/{id}', { method: 'GET', path }, { ...keyB, [CUSTOMER_TOKEN]: tokenA }),
      'A’s token at B',
    )
    // B's own customer with the same email asks for A's order id
    assertRefused(
      await attack('/storefront/customer/orders/{id}', { method: 'GET', path }, { ...keyB, [CUSTOMER_TOKEN]: tokenB }),
      'B’s customer asks for A’s order',
    )
    assert.equal((await call('GET', path, undefined, { [CUSTOMER_TOKEN]: tokenA })).status, 200, 'A still reads it')
  })

  isolated('catalog by id and handle', async () => {
    const products = ok(await call('GET', '/storefront/products?first=1')).nodes
    const collections = ok(await call('GET', '/storefront/collections?first=1')).nodes
    assert.ok(products[0] && collections[0], 'the demo catalog has a product and a collection')
    const product = products[0]
    const collection = collections[0]

    const page = ok(await call('POST', '/admin/pages', { title: `E2E iso page ${run}-sf`, published: true }, ownerA))
    cleanup.push(() => call('DELETE', `/admin/pages/${page.id}`, undefined, ownerA))
    const menu = ok(
      await call(
        'POST',
        '/admin/menus',
        { handle: `e2e-iso-sf-${run}`, title: `E2E iso menu ${run}-sf`, items: [] },
        ownerA,
      ),
    )
    cleanup.push(() => call('DELETE', `/admin/menus/${menu.id}`, undefined, ownerA))

    // Controls: shop A's storefront shows each of them, so a refusal for B means "not B's", not "not there"
    const reads = [
      ['/storefront/products/{id}', `/storefront/products/${product.id}`],
      ['/storefront/products/by-handle/{handle}', `/storefront/products/by-handle/${product.handle}`],
      ['/storefront/collections/{handle}', `/storefront/collections/${collection.handle}`],
      ['/storefront/pages/{handle}', `/storefront/pages/${page.handle}`],
      ['/storefront/menus/{handle}', `/storefront/menus/${menu.handle}`],
    ] as const
    for (const [, path] of reads) {
      assert.equal((await call('GET', path)).status, 200, `control: shop A's storefront shows ${path}`)
    }
    for (const [openapi, path] of reads) {
      assertRefused(await attack(openapi, { method: 'GET', path }, keyB), `GET ${path}`)
    }
  })
})

// Invariant 23: a request cannot link another shop's objects by naming their ids in the body. Each case names A's id
// from shop B and then checks, in B's data, that nothing was linked. An error status alone is not enough.
describe('shop B cannot link shop A’s objects through ids in a request body', () => {
  // A client error that came from looking the id up, not from the body failing validation (that would hide a hole)
  const is4xx = (r: { status: number; body: unknown }) =>
    r.status >= 400 && r.status < 500 && !(r.body as { data?: { issues?: unknown } } | null)?.data?.issues

  isolated('an order cannot name A’s variant or A’s customer', async () => {
    const pA = ok(await call('POST', '/admin/products', { title: `E2E iso link A ${run}`, priceCents: 1200 }, a))
    cleanup.push(() => call('DELETE', '/admin/products/bulk', { ids: [pA.id] }, a))
    const pB = ok(await call('POST', '/admin/products', { title: `E2E iso link B ${run}`, priceCents: 1200 }, b))
    cleanup.push(() => call('DELETE', '/admin/products/bulk', { ids: [pB.id] }, b))
    const custA = ok(
      await call('POST', '/admin/customers', { email: `e2e-iso-link-${run}@example.com`, name: 'Link A' }, a),
    )
    cleanup.push(() => call('DELETE', '/admin/customers/bulk', { ids: [custA.id] }, a))

    // Control: the same bodies work with B's own variant, so a refusal is about A's id
    const own = await call(
      'POST',
      '/admin/orders',
      { email: `e2e-iso-own-${run}@example.com`, name: 'Own', items: [{ variantId: pB.variants[0].id, quantity: 1 }] },
      b,
    )
    assert.equal(own.status, 200, `control: B orders its own variant, got ${own.status} ${JSON.stringify(own.body)}`)
    fx.order((own.body.id ?? own.body.order?.id) as string)
    const before = ok(await call('GET', '/admin/orders', undefined, b)).total as number

    const withVariant = await call(
      'POST',
      '/admin/orders',
      { email: `e2e-iso-x-${run}@example.com`, name: 'X', items: [{ variantId: pA.variants[0].id, quantity: 1 }] },
      b,
    )
    assert.ok(is4xx(withVariant), `A's variant in B's order: ${withVariant.status} ${JSON.stringify(withVariant.body)}`)
    const withCustomer = await call(
      'POST',
      '/admin/orders',
      {
        email: `e2e-iso-y-${run}@example.com`,
        name: 'Y',
        customerId: custA.id,
        items: [{ variantId: pB.variants[0].id, quantity: 1 }],
      },
      b,
    )
    assert.ok(
      is4xx(withCustomer),
      `A's customer on B's order: ${withCustomer.status} ${JSON.stringify(withCustomer.body)}`,
    )

    assert.equal(ok(await call('GET', '/admin/orders', undefined, b)).total, before, 'no order was added in B')
  })

  isolated('a collection and a publication cannot name A’s product or channel', async () => {
    const pA = ok(await call('POST', '/admin/products', { title: `E2E iso pub A ${run}`, priceCents: 900 }, a))
    cleanup.push(() => call('DELETE', '/admin/products/bulk', { ids: [pA.id] }, a))
    const colA = ok(await call('POST', '/admin/collections', { title: `E2E iso pub col A ${run}` }, a))
    cleanup.push(() => call('DELETE', `/admin/collections/${colA.id}`, undefined, a))
    const pB = ok(await call('POST', '/admin/products', { title: `E2E iso pub B ${run}`, priceCents: 900 }, b))
    cleanup.push(() => call('DELETE', '/admin/products/bulk', { ids: [pB.id] }, b))
    const colB = ok(await call('POST', '/admin/collections', { title: `E2E iso pub col B ${run}` }, b))
    cleanup.push(() => call('DELETE', `/admin/collections/${colB.id}`, undefined, b))
    const channelA = ok(await call('GET', '/admin/channels', undefined, ownerA))[0].id as string

    // B's collection takes A's product
    assertRefused(
      await call('POST', `/admin/collections/${colB.id}/products`, { productId: pA.id }, b),
      'A’s product in B’s collection',
    )
    assert.equal(ok(await call('GET', `/admin/collections/${colB.id}/products`, undefined, b)).length, 0, 'still empty')

    // B's product and collection published to A's channel
    const toA = { publications: [{ channelId: channelA, published: true }] }
    assertRefused(await call('PUT', `/admin/products/${pB.id}/publications`, toA, b), 'B’s product to A’s channel')
    assertRefused(
      await call('PUT', `/admin/collections/${colB.id}/publications`, toA, b),
      'B’s collection to A’s channel',
    )

    // And the route’s own id: B publishes A's product, A's collection
    assertRefused(
      await attack('/admin/products/{id}/publications', {
        method: 'PUT',
        path: `/admin/products/${pA.id}/publications`,
        body: { publications: [] },
      }),
      'PUT A’s product publications',
    )
    assertRefused(
      await attack('/admin/collections/{id}/publications', {
        method: 'PUT',
        path: `/admin/collections/${colA.id}/publications`,
        body: { publications: [] },
      }),
      'PUT A’s collection publications',
    )
    // A's product is where it was
    assert.equal(ok(await call('GET', `/admin/products/${pA.id}`, undefined, a)).title, `E2E iso pub A ${run}`)
  })

  isolated('a storefront cart cannot name A’s variant, shipping rate or payment method', async () => {
    const [variantA] = await sellableVariants(1)
    assert.ok(variantA)
    const rateA = await fx.shippingRate(500)
    const methodA = await fx.paymentMethod()

    // Control: B's key can build a cart with B's own product, so a refusal below is about A's ids
    const pB = ok(await call('POST', '/admin/products', { title: `E2E iso cart B ${run}`, priceCents: 700 }, b))
    cleanup.push(() => call('DELETE', '/admin/products/bulk', { ids: [pB.id] }, b))
    const variantB = pB.variants[0].id as string
    const cartB = ok(
      await call('POST', '/storefront/carts', { lines: [{ merchandiseId: variantB, quantity: 1 }] }, keyB),
    )

    const create = await call(
      'POST',
      '/storefront/carts',
      { lines: [{ merchandiseId: variantA.id, quantity: 1 }] },
      keyB,
    )
    assertRefused(create, 'B’s new cart with A’s variant')
    assertRefused(
      await call(
        'POST',
        `/storefront/carts/${cartB.id}/lines`,
        { lines: [{ merchandiseId: variantA.id, quantity: 1 }] },
        keyB,
      ),
      'A’s variant added to B’s cart',
    )

    const email = `e2e-iso-link-cart-${run}@example.com`
    const complete = (body: object) =>
      call(
        'POST',
        `/storefront/carts/${cartB.id}/complete`,
        { email, shippingAddress: STOREFRONT_ADDRESS, ...body },
        keyB,
      )
    const withRate = await complete({ shippingRateId: rateA.id })
    assert.ok(is4xx(withRate), `A's shipping rate on B's cart: ${withRate.status} ${JSON.stringify(withRate.body)}`)
    const withMethod = await complete({ paymentMethodId: methodA.id })
    assert.ok(
      is4xx(withMethod),
      `A's payment method on B's cart: ${withMethod.status} ${JSON.stringify(withMethod.body)}`,
    )
    assert.equal((await db.select().from(orders).where(eq(orders.email, email))).length, 0, 'no order was placed')
  })
})

// Every route that takes an id is either attacked above or named in PENDING with a reason. A new route that is in
// neither fails here, so adding one forces a decision. Delete a line from PENDING when its case is written.
const PENDING: Record<string, string[]> = {
  // Addressed by a language code, not an id: a shop only ever sees its own languages (tested in modules/languages)
  'admin, staff session: languages (shop settings; the other languages routes list and write by shop, with no id)': [
    'DELETE /admin/languages/{code}',
  ],
  'admin, staff session: custom fields (definitions are shop settings; tested in custom-fields.test.ts)': [
    'DELETE /admin/custom-fields/{id}',
    'PATCH /admin/custom-fields/{id}',
    'PATCH /admin/orders/{id}',
  ],
  'admin, API token or staff session: webhooks': [
    'DELETE /admin/webhooks/{id}',
    'GET /admin/webhooks/{endpointId}/deliveries',
    'PATCH /admin/webhooks/{id}',
    'POST /admin/webhook-deliveries/{id}/redeliver',
    'POST /admin/webhooks/{id}/rotate-secret',
    'POST /admin/webhooks/{id}/test',
  ],
  'admin, other (files, app data, AI, publications)': [
    'DELETE /admin/app-data/{key}',
    'DELETE /admin/files/{id}',
    'GET /admin/app-data/{key}',
    'POST /admin/ai/generations/{id}/feedback',
    'PUT /admin/app-data/{key}',
    'PUT /admin/products/{id}/variants',
  ],
  'admin, payments app token only': [
    'GET /admin/payment-sessions/{id}',
    'POST /admin/payment-sessions/{id}/attempt-failed',
    'POST /admin/payment-sessions/{id}/reject',
    'POST /admin/payment-sessions/{id}/resolve',
  ],
  'admin, platform super admin only': [
    'DELETE /admin/app-registry/{id}',
    'PATCH /admin/app-registry/{id}',
    'POST /admin/app-registry/{id}/rotate-key',
  ],
  'admin, staff session required (shop owner or admin)': [
    'DELETE /admin/channels/{id}',
    'DELETE /admin/domains/{id}',
    'DELETE /admin/payment-methods/{id}',
    'DELETE /admin/shipping-rates/{id}',
    'DELETE /admin/staff/members/{id}',
    'DELETE /admin/tax-rates/{id}',
    'GET /admin/notifications/{notification}',
    'PATCH /admin/carrier-services/{id}',
    'PATCH /admin/channels/{id}',
    'PATCH /admin/notifications/{notification}',
    'PATCH /admin/payment-methods/{id}',
    'PATCH /admin/shipping-rates/{id}',
    'PATCH /admin/staff/members/{id}',
    'PATCH /admin/tax-rates/{id}',
    'POST /admin/api-tokens/{id}/revoke',
    'POST /admin/apps/{id}/session-token',
    'POST /admin/apps/{id}/uninstall',
    'POST /admin/domains/{id}/verify',
    'POST /admin/notifications/{notification}/preview',
    'POST /admin/notifications/{notification}/revert',
    'POST /admin/notifications/{notification}/test',
    'POST /admin/staff/invitations/{id}/cancel',
    'POST /admin/storefront-keys/{id}/revoke',
  ],
  'admin, staff session: themes': [
    'DELETE /admin/themes/{id}',
    'DELETE /admin/themes/{id}/files',
    'GET /admin/themes/{id}',
    'GET /admin/themes/{id}/files',
    'PATCH /admin/themes/{id}',
    'POST /admin/themes/store/{id}',
    'POST /admin/themes/{id}/discard',
    'POST /admin/themes/{id}/duplicate',
    'POST /admin/themes/{id}/files/discard',
    'POST /admin/themes/{id}/files/publish',
    'POST /admin/themes/{id}/preview-token',
    'POST /admin/themes/{id}/publish',
    'PUT /admin/themes/{id}/draft',
    'PUT /admin/themes/{id}/files',
  ],
  // The only storefront route with an id that has no case: a shop with no theme copy has nothing to attack it with
  'storefront: themes (needs a theme copy in shop A; the demo shop has none)': ['GET /storefront/themes/{themeId}'],
}

describe('coverage', () => {
  test('every route that takes an id is covered or listed as pending', async (t) => {
    if (cases.finished !== cases.started) return t.skip('an isolation case failed: coverage not evaluated')
    const spec = (await (await fetch(`${API}/openapi.json`)).json()) as {
      paths: Record<string, Record<string, unknown>>
    }
    const methods = ['get', 'post', 'put', 'patch', 'delete']
    const idRoutes = Object.entries(spec.paths).flatMap(([path, ops]) =>
      path.includes('{') ? methods.filter((m) => m in ops).map((m) => `${m.toUpperCase()} ${path}`) : [],
    )
    assert.ok(idRoutes.length > 50, `the API spec lists only ${idRoutes.length} routes with an id: is it reachable?`)

    // A covered route that is not in the API is not covered at all (a 404 for a route that doesn't exist proves nothing)
    const all = Object.entries(spec.paths).flatMap(([path, ops]) =>
      methods.filter((m) => m in ops).map((m) => `${m.toUpperCase()} ${path}`),
    )
    assert.deepEqual(
      [...covered].filter((r) => !all.includes(r)),
      [],
      'Attacked routes that do not exist in the API spec:',
    )

    const pending = new Set(Object.values(PENDING).flat())
    const unaccounted = idRoutes.filter((r) => !covered.has(r) && !pending.has(r))
    assert.deepEqual(
      unaccounted,
      [],
      `Routes with an id that no isolation case covers (add a case or list them in PENDING):`,
    )

    // PENDING must not rot: a route that is covered, or gone from the API, comes off the list
    const stale = [...pending].filter((r) => covered.has(r) || !idRoutes.includes(r))
    assert.deepEqual(stale, [], 'PENDING lists routes that are covered or no longer exist')
  })
})
