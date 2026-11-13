// Cross-shop access by id. Shop A owns a resource; shop B (an empty second shop, every API scope) is handed A's id
// on each route that takes one. The only acceptable answer is "not found" (or "forbidden"), and A's resource must be
// exactly as it was afterwards.
//
// A 400 is NOT accepted as a refusal: the API validates the body before it looks anything up, so a request with a
// bad body would be turned away for the wrong reason and hide a real hole. Every attack therefore sends a valid body.
//
// This file covers the routes an API token can reach. Routes that need a staff session (tax rates, shipping rates,
// payment methods, channels, domains, staff, storefront keys, API tokens) are listed in PENDING below, together with
// the storefront routes, until they get their own cases.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { like } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { API_SCOPES } from '@shopnex/db/schema'
import { API, Fixtures, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36)

let a: Record<string, string> // shop A: the default shop
let b: Record<string, string> // shop B: someone else, with every scope
let otherId: string
let ownerA: Record<string, string> // staff session, owner of shop A
let ownerB: Record<string, string> // staff session, owner of shop B

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
})

after(async () => {
  for (const undo of cleanup.reverse()) await undo().catch(() => {})
  await fx.cleanup()
  // Placing the manual order created a customer from its email
  await db.delete(schema.customers).where(like(schema.customers.email, 'e2e-iso-%'))
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

// Every route that takes an id is either attacked above or named in PENDING with a reason. A new route that is in
// neither fails here, so adding one forces a decision. Delete a line from PENDING when its case is written.
const PENDING: Record<string, string[]> = {
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
    'PUT /admin/collections/{id}/publications',
    'PUT /admin/products/{id}/publications',
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
  'storefront: public routes (publishable key, carts, orders, customer accounts)': [
    'GET /storefront/carts/{cartId}/checkout-options',
    'GET /storefront/carts/{id}',
    'GET /storefront/collections/{handle}',
    'GET /storefront/customer/orders/{id}',
    'GET /storefront/menus/{handle}',
    'GET /storefront/pages/{handle}',
    'GET /storefront/products/by-handle/{handle}',
    'GET /storefront/products/{id}',
    'GET /storefront/themes/{themeId}',
    'PATCH /storefront/carts/{cartId}/lines',
    'POST /storefront/carts/{cartId}/complete',
    'POST /storefront/carts/{cartId}/lines',
    'POST /storefront/carts/{cartId}/lines/remove',
    'PUT /storefront/carts/{cartId}/discount-codes',
  ],
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
