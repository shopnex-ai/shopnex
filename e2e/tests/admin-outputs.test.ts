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
