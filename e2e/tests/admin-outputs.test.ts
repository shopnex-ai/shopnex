// The admin routes that declare an `.output()` (the ones apps call): each answers with what the schema says, so a
// schema that drifts from the handler (a stripped field, a failed validation) shows up here as a failure, not as a
// 500 in production. Everything is created through the API with a token and removed at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Fixtures, SHOP, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()
let auth: Record<string, string>
let productId: string

const iso = /^\d{4}-\d{2}-\d{2}T/

before(async () => {
  await requireApp()
  await fx.init()
  auth = await fx.token(['read_products', 'write_products', 'read_orders', 'write_orders', 'write_shipping'])
})

after(async () => {
  if (productId) await call('DELETE', '/admin/products/bulk', { ids: [productId] }, auth)
  await fx.cleanup()
  await closeDb()
})

describe('products', () => {
  test('create, get, list, update and set variants answer with the product', async () => {
    const created = ok(
      await call('POST', '/admin/products', { title: `E2E outputs ${Date.now()}`, priceCents: 1200 }, auth),
    )
    productId = created.id
    assert.equal(created.status, 'active')
    assert.equal(created.fulfilledBy, null)
    assert.match(created.createdAt, iso)
    assert.equal(created.variants.length, 1)
    assert.equal(created.variants[0].priceCents, 1200)
    assert.deepEqual(created.options, [])

    const got = ok(await call('GET', `/admin/products/${productId}`, undefined, auth))
    assert.equal(got.id, productId)
    assert.equal(got.variants[0].available, true)

    const page = ok(await call('GET', '/admin/products?limit=100', undefined, auth))
    assert.equal(typeof page.total, 'number')
    const listed = page.items.find((p: { id: string }) => p.id === productId)
    assert.ok(listed, 'the new product is on the first page')
    assert.ok(Array.isArray(listed.publications))

    const updated = ok(await call('PATCH', `/admin/products/${productId}`, { title: 'E2E renamed' }, auth))
    assert.equal(updated.title, 'E2E renamed')

    const withVariants = ok(
      await call(
        'PUT',
        `/admin/products/${productId}/variants`,
        {
          options: [{ name: 'Size', values: ['S', 'M'] }],
          variants: [
            { options: { Size: 'S' }, priceCents: 1200 },
            { options: { Size: 'M' }, priceCents: 1400 },
          ],
        },
        auth,
      ),
    )
    assert.equal(withVariants.variants.length, 2)
    assert.equal(withVariants.options[0].name, 'Size')
    assert.ok(withVariants.variants[0].selectedOptions[0].value)
  })
})

describe('webhooks', () => {
  test('create, list and update answer with the endpoint', async () => {
    const created = ok(
      await call('POST', '/admin/webhooks', { url: 'https://example.com/e2e-hook', topics: ['order.created'] }, auth),
    )
    assert.ok(created.secret)
    assert.deepEqual(created.topics, ['order.created'])
    assert.match(created.createdAt, iso)

    const list = ok(await call('GET', '/admin/webhooks', undefined, auth))
    const mine = list.find((w: { id: string }) => w.id === created.id)
    assert.equal(mine.createdByApp, false)
    assert.equal(mine.apiTokenName, 'e2e')

    const updated = ok(await call('PATCH', `/admin/webhooks/${created.id}`, { active: false }, auth))
    assert.equal(updated.active, false)
    ok(await call('DELETE', `/admin/webhooks/${created.id}`, undefined, auth))
  })
})

describe('shop and orders', () => {
  test('the shop answers with its settings', async () => {
    const shop = ok(await call('GET', '/admin/shop', undefined, auth))
    assert.equal(shop.id, SHOP)
    assert.equal(typeof shop.currency, 'string')
  })

  test('an order answers with its items, and fulfilling it with the order', async () => {
    const [variant] = await sellableVariants(1)
    const cart = await fx.cart([{ merchandiseId: variant!.id, quantity: 1 }])
    const done = await fx.complete(cart.id, { countryCode: 'US' })
    if (done.status !== 200) return assert.fail(`checkout failed: ${JSON.stringify(done.body)}`)
    const order = ok(await call('GET', `/admin/orders/${done.body.orderId}`, undefined, auth))
    assert.equal(order.id, done.body.orderId)
    assert.equal(order.items.length, 1)
    assert.equal(order.fulfillmentStatus, 'unfulfilled')
    assert.ok(Array.isArray(order.shippingLines) && Array.isArray(order.transactions))
    assert.equal(order.customer?.email, fx.email)

    const fulfilled = ok(await call('POST', `/admin/orders/${order.id}/fulfill`, {}, auth))
    assert.equal(fulfilled.fulfillmentStatus, 'fulfilled')
  })
})

// The routes staff use: an owner session creates, reads, changes and removes one of each, and reads the settings
// pages. The answer to each must come back (a schema that disagrees with its handler is a 500 here).
describe('staff routes', () => {
  let owner: { headers: { cookie: string } }
  const get = (path: string) => call('GET', path, undefined, owner.headers)
  const send = (method: string, path: string, body?: unknown) => call(method, path, body ?? {}, owner.headers)
  const suffix = Date.now()

  before(async () => {
    owner = await fx.account('owner')
  })

  /** create → get/list → update → delete for a resource; `create` is the POST body */
  async function crud(
    base: string,
    create: Record<string, unknown>,
    update: Record<string, unknown>,
    opts: { listKey?: string; hasGet?: boolean; hasDelete?: boolean } = {},
  ) {
    const created = ok(await send('POST', base, create))
    assert.ok(created.id, `${base} create answers with the row`)
    const list = ok(await get(base))
    const rows = opts.listKey ? list[opts.listKey] : list
    assert.ok(
      rows.some((r: { id: string }) => r.id === created.id),
      `${base} lists it`,
    )
    if (opts.hasGet) assert.equal(ok(await get(`${base}/${created.id}`)).id, created.id)
    const updated = ok(await send('PATCH', `${base}/${created.id}`, update))
    assert.equal(updated.id, created.id)
    if (opts.hasDelete !== false) ok(await send('DELETE', `${base}/${created.id}`))
    return created
  }

  test('channels, shipping rates, payment methods, tax rates', async () => {
    await crud('/admin/channels', { name: `E2E ${suffix}`, type: 'headless' }, { name: `E2E b ${suffix}` })
    await crud('/admin/shipping-rates', { name: `E2E ${suffix}`, priceCents: 500 }, { priceCents: 700 })
    await crud('/admin/payment-methods', { name: `E2E ${suffix}`, provider: 'manual' }, { active: false })
    await crud('/admin/tax-rates', { name: `E2E ${suffix}`, countryCode: 'ZZ', ratePercent: 5 }, { ratePercent: 6 })
  })

  test('collections, customers, discounts, pages, menus', async () => {
    const collection = ok(await send('POST', '/admin/collections', { title: `E2E ${suffix}` }))
    ok(await get('/admin/collections'))
    assert.equal(ok(await get(`/admin/collections/${collection.id}`)).productCount, 0)
    ok(await get(`/admin/collections/${collection.id}/products`))
    ok(await get(`/admin/collections/${collection.id}/publications`))
    ok(await send('PATCH', `/admin/collections/${collection.id}`, { title: `E2E b ${suffix}` }))
    ok(await send('DELETE', `/admin/collections/${collection.id}`))

    const customer = ok(await send('POST', '/admin/customers', { email: `e2e-out-${suffix}@example.com` }))
    assert.equal(ok(await get(`/admin/customers/${customer.id}`)).id, customer.id)
    assert.ok(ok(await get('/admin/customers')).items.length >= 1)
    ok(await send('PATCH', `/admin/customers/${customer.id}`, { name: 'E2E' }))
    assert.equal(ok(await send('DELETE', '/admin/customers/bulk', { ids: [customer.id] })), 1)

    await crud(
      '/admin/discounts',
      { code: `E2E${suffix}`, type: 'percentage', value: 10 },
      { active: false },
      { hasGet: true },
    )
    await crud('/admin/pages', { title: `E2E ${suffix}`, bodyHtml: '<p>x</p>' }, { title: 'E2E b' }, { hasGet: true })
    await crud(
      '/admin/menus',
      { title: `E2E ${suffix}`, handle: `e2e-${suffix}`, items: [] },
      { title: 'b' },
      { hasGet: true },
    )
  })

  test('settings pages and the rest of the reads', async () => {
    for (const path of [
      '/admin/analytics/overview',
      '/admin/api-tokens',
      '/admin/apps',
      '/admin/apps/catalog',
      '/admin/domains',
      '/admin/email',
      '/admin/files',
      '/admin/notifications',
      '/admin/notifications/deliveries',
      '/admin/notifications/order_confirmation',
      '/admin/staff',
      '/admin/storage',
      '/admin/storefront-keys',
      '/admin/themes',
      '/admin/themes/store',
      '/admin/ai/capabilities',
      '/admin/ai/settings',
      '/admin/carrier-services',
      '/admin/carrier-services/available',
      '/admin/payment-apps/available',
    ]) {
      const r = await get(path)
      assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`)
    }
  })

  test('themes: read, duplicate, rename and delete', async () => {
    const themes = ok(await get('/admin/themes'))
    if (!themes.length) return // a fresh shop has none until the storefront asks for one
    const id = themes[0].id
    const detail = ok(await get(`/admin/themes/${id}`))
    assert.ok(detail.draft && detail.draft.settings)
    // (/files reads the theme's source from the running storefront, so it isn't called here)
    const copy = ok(await send('POST', `/admin/themes/${id}/duplicate`))
    ok(await send('PATCH', `/admin/themes/${copy.id}`, { name: 'E2E copy' }))
    ok(await send('DELETE', `/admin/themes/${copy.id}`))
  })

  test('keys and tokens: create, list and revoke', async () => {
    const key = ok(await send('POST', '/admin/storefront-keys', { name: `E2E ${suffix}` }))
    assert.ok(key.token)
    assert.ok(ok(await get('/admin/storefront-keys')).some((k: { id: string }) => k.id === key.id))
    ok(await send('POST', `/admin/storefront-keys/${key.id}/revoke`))
    const token = ok(await send('POST', '/admin/api-tokens', { name: `E2E ${suffix}`, scopes: ['read_products'] }))
    fx.apiToken(token.id)
    assert.ok(token.token)
    assert.equal(token.tokenHash, undefined, 'the hash is never sent')
    ok(await send('POST', `/admin/api-tokens/${token.id}/revoke`))
  })
})
