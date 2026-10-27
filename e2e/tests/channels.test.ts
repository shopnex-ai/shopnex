// Sales channels end to end: what a storefront sees depends on the channel its key belongs to. Products and
// collections are published per channel (Admin API), carts only take what's live on their channel, and orders
// remember where they were placed. Uses its own product, collection and channel and removes them at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { channelService } from '@shopnex/channels'
import { db, schema } from '@shopnex/db'
import { createStorefrontKey, revokeStorefrontKey } from '@shopnex/tenancy'
import { Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36)

let admin: Record<string, string>
let online: { id: string }
let portal: { id: string }
let portalKey: Record<string, string> // storefront requests on the second channel
let product: { id: string; handle: string; variants: { id: string }[] }
let collection: { id: string; handle: string }
let shippingRateId: string

const publish = (path: string, publications: object[]) => call('PUT', path, { publications }, admin).then((r) => ok(r))
const handles = (list: { nodes: { handle: string }[] }) => list.nodes.map((n) => n.handle)

before(async () => {
  await requireApp()
  await fx.init()
  admin = await fx.token(['write_products', 'write_publications'])
  online = await channelService.getDefault(SHOP)
  portal = await channelService.create(SHOP, { name: `E2E Portal ${run}` })
  portalKey = { 'x-shopnex-key': (await createStorefrontKey(SHOP, 'e2e portal', portal.id)).token }
  shippingRateId = (await fx.shippingRate(300)).id
  const created = ok(await call('POST', '/admin/products', { title: `E2E channel ${run}`, priceCents: 1500 }, admin))
  product = { id: created.id, handle: created.slug, variants: created.variants }
  const col = ok(await call('POST', '/admin/collections', { title: `E2E channel col ${run}` }, admin))
  collection = { id: col.id, handle: col.slug }
})

after(async () => {
  await fx.cleanup()
  await db.delete(schema.carts).where(eq(schema.carts.channelId, portal.id))
  await db.delete(schema.storefrontKeys).where(eq(schema.storefrontKeys.channelId, portal.id))
  await db.delete(schema.orders).where(eq(schema.orders.channelId, portal.id))
  await channelService.remove(SHOP, portal.id).catch(() => {})
  await db.delete(schema.products).where(inArray(schema.products.id, [product.id]))
  await db.delete(schema.collections).where(eq(schema.collections.id, collection.id))
  await closeDb()
})

describe('publishing', () => {
  test('new products and collections are on the Online Store, and nowhere else', async () => {
    const mine = ok(await call('GET', `/admin/products/${product.id}/publications`, undefined, admin))
    assert.deepEqual(
      mine.map((p: any) => p.channelId),
      [online.id],
    )
    // The default storefront (no key) is the Online Store; the portal's key sees neither
    assert.ok(handles(ok(await call('GET', '/storefront/products?first=100'))).includes(product.handle))
    assert.ok(handles(ok(await call('GET', '/storefront/collections?first=100'))).includes(collection.handle))
    assert.ok(
      !handles(ok(await call('GET', '/storefront/products?first=100', undefined, portalKey))).includes(product.handle),
    )
    assert.equal(
      (await call('GET', `/storefront/products/by-handle/${product.handle}`, undefined, portalKey)).status,
      404,
    )
    assert.equal((await call('GET', `/storefront/collections/${collection.handle}`, undefined, portalKey)).status, 404)
  })

  test('publishing on another channel shows it there; unpublishing hides it', async () => {
    await publish(`/admin/products/${product.id}/publications`, [{ channelId: portal.id }])
    await publish(`/admin/collections/${collection.id}/publications`, [{ channelId: portal.id }])
    assert.ok(
      handles(ok(await call('GET', '/storefront/products?first=100', undefined, portalKey))).includes(product.handle),
    )
    ok(await call('GET', `/storefront/collections/${collection.handle}`, undefined, portalKey))
    // Left the Online Store: gone from the default storefront
    assert.ok(!handles(ok(await call('GET', '/storefront/products?first=100'))).includes(product.handle))
    assert.equal((await call('GET', `/storefront/products/by-handle/${product.handle}`)).status, 404)
  })

  test('a scheduled publication is not live yet and keeps its date when saved again', async () => {
    const at = new Date(Date.now() + 3600e3).toISOString()
    const saved = await publish(`/admin/products/${product.id}/publications`, [{ channelId: portal.id, publishAt: at }])
    assert.equal(new Date(saved[0].publishedAt).toISOString(), at)
    assert.ok(
      !handles(ok(await call('GET', '/storefront/products?first=100', undefined, portalKey))).includes(product.handle),
    )
    const again = await publish(`/admin/products/${product.id}/publications`, [
      { channelId: portal.id },
      { channelId: online.id },
    ])
    assert.equal(new Date(again.find((p: any) => p.channelId === portal.id).publishedAt).toISOString(), at)
  })

  test('a draft product stays hidden even when published', async () => {
    await publish(`/admin/products/${product.id}/publications`, [{ channelId: online.id }])
    ok(await call('PATCH', `/admin/products/${product.id}`, { status: 'draft' }, admin))
    assert.equal((await call('GET', `/storefront/products/by-handle/${product.handle}`)).status, 404)
    ok(await call('PATCH', `/admin/products/${product.id}`, { status: 'active' }, admin))
    ok(await call('GET', `/storefront/products/by-handle/${product.handle}`))
  })

  test('the publications list is on admin product list items; foreign channels are refused', async () => {
    const list = ok(await call('GET', '/admin/products?limit=100', undefined, admin))
    const item = list.items.find((p: any) => p.id === product.id)
    assert.deepEqual(
      item.publications.map((p: any) => p.channelId),
      [online.id],
    )
    const other = await fx.shop()
    const foreign = await channelService.getDefault(other.id)
    const r = await call(
      'PUT',
      `/admin/products/${product.id}/publications`,
      { publications: [{ channelId: foreign.id }] },
      admin,
    )
    assert.equal(r.status, 404)
  })
})

describe('carts and orders', () => {
  test('a cart takes only what is live on its channel', async () => {
    await publish(`/admin/products/${product.id}/publications`, [{ channelId: online.id }])
    const variantId = ok(await call('GET', `/storefront/products/by-handle/${product.handle}`)).variants[0].id
    const lines = [{ merchandiseId: variantId, quantity: 1 }]
    const portalCart = await call('POST', '/storefront/carts', { lines }, portalKey)
    assert.equal(portalCart.status, 404, 'not published on the portal')
    assert.equal(portalCart.body.code ?? portalCart.body.data?.code, 'MERCHANDISE_NOT_FOUND')
    const cart = await fx.cart(lines)
    assert.equal(cart.totalQuantity, 1)
  })

  test('an order is placed on its cart’s channel; unpublishing before checkout blocks it', async () => {
    await publish(`/admin/products/${product.id}/publications`, [{ channelId: portal.id }])
    const variantId = product.variants[0]!.id
    const cart = ok(
      await call('POST', '/storefront/carts', { lines: [{ merchandiseId: variantId, quantity: 1 }] }, portalKey),
    )
    const done = await fx.complete(cart.id, { countryCode: 'US' }, shippingRateId)
    ok(done)
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, done.body.orderId))
    assert.equal(order!.channelId, portal.id)

    const second = ok(
      await call('POST', '/storefront/carts', { lines: [{ merchandiseId: variantId, quantity: 1 }] }, portalKey),
    )
    await publish(`/admin/products/${product.id}/publications`, [{ channelId: online.id }])
    const blocked = await fx.complete(second.id, { countryCode: 'US' }, shippingRateId)
    assert.notEqual(blocked.status, 200)
  })

  test('a channel with orders or keys cannot be deleted', async () => {
    await assert.rejects(channelService.remove(SHOP, portal.id), /orders or active storefront keys/)
    await assert.rejects(channelService.remove(SHOP, online.id), /can’t be deleted/)
  })
})

describe('permissions', () => {
  test('tokens need the publications scopes; channels are managed by staff only', async () => {
    const products = await fx.token(['write_products'])
    assert.equal((await call('GET', '/admin/channels', undefined, products)).status, 403)
    assert.equal(
      (await call('PUT', `/admin/products/${product.id}/publications`, { publications: [] }, products)).status,
      403,
    )
    const reader = await fx.token(['read_publications'])
    const list = ok(await call('GET', '/admin/channels', undefined, reader))
    assert.ok(list.some((c: any) => c.id === online.id))
    assert.equal((await call('POST', '/admin/channels', { name: 'x' }, admin)).status, 401)
  })
})

describe('consistency', () => {
  test('a collection that is not published on a channel is invisible there, with its members', async () => {
    ok(await call('POST', `/admin/collections/${collection.id}/products`, { productId: product.id }, admin))
    await publish(`/admin/products/${product.id}/publications`, [{ channelId: online.id }, { channelId: portal.id }])
    await publish(`/admin/collections/${collection.id}/publications`, [{ channelId: online.id }])
    const url = `/storefront/products?first=100&collection=${collection.handle}`

    // Online Store: the collection is published, so its products and the product's collection handle show
    assert.ok(handles(ok(await call('GET', url))).includes(product.handle))
    const onOnline = ok(await call('GET', `/storefront/products/by-handle/${product.handle}`))
    assert.ok(onOnline.collectionHandles.includes(collection.handle))

    // Portal: the product is there, but the collection isn't, so it can't be listed by it or name it
    assert.deepEqual(ok(await call('GET', url, undefined, portalKey)).nodes, [])
    const onPortal = ok(await call('GET', `/storefront/products/by-handle/${product.handle}`, undefined, portalKey))
    assert.ok(!onPortal.collectionHandles.includes(collection.handle))
  })

  test('publishing changes queue product.updated for webhook subscribers', async () => {
    const endpoint = ok(
      await call(
        'POST',
        '/admin/webhooks',
        { url: 'https://example.com/e2e-hook', topics: ['product.updated'] },
        admin,
      ),
    )
    try {
      const count = async () =>
        (await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, endpoint.id)))
          .length
      assert.equal(await count(), 0)
      await publish(`/admin/products/${product.id}/publications`, [{ channelId: online.id }])
      assert.equal(await count(), 1)
    } finally {
      await call('DELETE', `/admin/webhooks/${endpoint.id}`, undefined, admin)
    }
  })

  test('a channel whose keys are all revoked can be deleted; an active key blocks it', async () => {
    const spare = await channelService.create(SHOP, { name: `E2E Spare ${run}` })
    const key = await createStorefrontKey(SHOP, 'e2e spare', spare.id)
    await assert.rejects(channelService.remove(SHOP, spare.id), /active storefront keys/)
    await revokeStorefrontKey(SHOP, key.id)
    assert.ok(await channelService.remove(SHOP, spare.id))
    const left = await db.select().from(schema.storefrontKeys).where(eq(schema.storefrontKeys.id, key.id))
    assert.equal(left.length, 0)
  })
})
