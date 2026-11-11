// CJ Dropshipping for ShopNex: a bundled app on @shopnex/app. Runs next to ShopNex (its own process) and keeps
// its tables in Postgres (a schema of its own, APP_DATABASE_URL); the shop's settings and CJ key are in ShopNex (shop.data), encrypted with this app's key.
//
//   GET  /                          Embedded settings page (session token)
//   GET  /api/products              My Products cards (HTML), loaded by the settings page after it opens
//   POST /api/connect               Save the CJ API key, subscribe to paid orders
//   POST /api/settings              Markup and auto-pay
//   POST /api/import                CJ product → draft ShopNex product (already in the shop: link it instead)
//   POST /api/link                  Tie a product already in the shop to CJ, so its orders go to CJ
//   POST /api/orders/:id/retry      Send a failed order to CJ again
//   POST /shopnex/webhook           ShopNex: order.paid → CJ order
//   POST /shipping/rates            ShopNex: what CJ shipping costs for this cart and address (carrier service)
//   (every 15 minutes)              CJ tracking numbers → ShopNex fulfillments
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createShopnexApp, type ShopContext } from '@shopnex/app'
import { openAppDatabase } from '@shopnex/app/store'
import { connect, cjFor, isConnected, settingsOf } from './cj'
import { openTables } from './db'
import { migrationsFolder } from './migrations'
import { SCHEMA } from './schema'
import {
  checkAvailability,
  foregroundTask,
  importProduct,
  inShop,
  isOffSale,
  CLIENT_ID,
  markFulfilled,
  isSkuConflict,
  linkProduct,
  needsCheck,
  OFF_SALE_MESSAGE,
  shopSkus,
} from './import'
import { forwardOrder, syncTracking, type PaidOrder } from './orders'
import { quoteRates } from './shipping'
import { ensureOrderWebhook } from './webhook'
import { icon, ProductList, SettingsPage, type MyProduct } from './settings'

// Public origin ShopNex and the admin (iframe) reach this app at
const APP_URL = (process.env.CJ_DROPSHIPPING_APP_URL || 'http://localhost:4700').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 4700)

// Its identity is CJ_DROPSHIPPING_APP_KEY (env only); ShopNex stores the shops' settings and sealed secrets (shop.data). ShopNex reads the public key
// from /.well-known/shopnex-app.json (bundled app): see registerBundledApps in @shopnex/apps
const database = await openAppDatabase({ schema: SCHEMA })
await database.migrate(migrationsFolder())
const tables = openTables(database.db)
const shopnex = createShopnexApp({
  clientId: CLIENT_ID,
  appUrl: APP_URL,
  appKey: process.env.CJ_DROPSHIPPING_APP_KEY,
})

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** My Products items aren't described in CJ's docs: read the usual field names */
function myProducts(data: unknown): MyProduct[] {
  const rows: any[] = Array.isArray(data) ? data : ((data as any)?.list ?? (data as any)?.content ?? [])
  return rows.flatMap((r) => {
    const pid = r.pid ?? r.productId ?? r.id
    if (!pid) return []
    return [
      {
        pid: String(pid),
        name: r.nameEn ?? r.productNameEn ?? r.productName ?? r.name ?? String(pid),
        sku: r.sku ?? r.productSku ?? null,
        image: r.bigImage ?? r.productImage ?? null,
        price: r.sellPrice ?? null,
        available: null,
        inShop: false,
        linked: false,
      },
    ]
  })
}

/**
 * Offers CJ's shipping prices at checkout (a ShopNex carrier service). It needs the shipping permission, so a shop
 * that installed the app before it existed gets an error here until the app is installed again.
 */
async function registerCarrier(shop: ShopContext) {
  const service = await shop.shipping.configure({
    name: 'CJ Dropshipping',
    ratesUrl: `${APP_URL}/shipping/rates`,
    ready: true,
  })
  await shop.data.set('carrier_service', { id: service.id })
  return service
}

/** One time per shop: mark the products the app already ships as fulfilled by CJ (see markFulfilled) */
async function backfillFulfilledBy(shop: ShopContext) {
  if (await shop.data.get('fulfilled_by_marked')) return
  const skus = new Set([...(await tables.linkedSkus(shop)).values()].flat())
  if (skus.size) await markFulfilled(shop, skus)
  await shop.data.set('fulfilled_by_marked', true)
}

const app = new Hono()
app.route('/', shopnex.routes)
app.get('/icon.svg', (c) => c.body(icon, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }))

// --- settings (embedded page) ---

app.get('/', async (c) => {
  const shop = await shopnex.authenticate(c)
  const connected = await isConnected(shop)
  // Products imported or linked before `fulfilledBy` existed get it once, in the background
  if (connected)
    void backfillFulfilledBy(shop).catch((error) => console.warn('[cj] fulfilledBy backfill:', message(error)))
  let shippingError: string | null = null
  let shippingOff = false
  // Registering again is safe, and keeps the service (and its id, which orders are matched on) right after a
  // new install; shops connected before shipping prices existed switch them on here too
  // `active` is the merchant's switch in Settings → Shipping: registering doesn't turn it back on
  if (connected)
    await registerCarrier(shop)
      .then((service) => (shippingOff = !service.active))
      .catch((error) => (shippingError = message(error)))
  // After an uninstall and a new install the subscription is gone: make it again, so paid orders still reach CJ
  if (connected)
    await ensureOrderWebhook(shop, APP_URL).catch((error) => console.warn('[cj] order subscription:', message(error)))
  return c.html(
    <SettingsPage
      connected={connected}
      settings={await settingsOf(shop)}
      shippingError={shippingError}
      shippingOff={shippingOff}
      orders={await tables.orders(shop)}
    />,
  )
})

// My Products, as HTML for the settings page to drop in. CJ allows one call a second, so this is not part of the
// page load: the page opens first and asks for the list
app.get('/api/products', async (c) => {
  const shop = await shopnex.authenticate(c)
  let products: MyProduct[] = []
  let productsError: string | null = null
  try {
    const { cj } = await cjFor(shop)
    const result = await cj.products.getMyProducts()
    if (result.error) productsError = result.error
    else {
      const known = await tables.availability(shop)
      const skus = await shopSkus(shop).catch(() => null)
      const linked = await tables.linkedSkus(shop)
      products = myProducts(result.data).map((p) => ({
        ...p,
        available: known.get(p.pid)?.available ?? null,
        inShop: inShop(skus, p.sku, linked.get(p.pid)),
        linked: linked.has(p.pid),
      }))
      // Unknown or stale ones are checked in the background; their answers show on the next load
      const unchecked = products.filter((p) => needsCheck(known, p.pid)).map((p) => p.pid)
      if (unchecked.length > 0) void checkAvailability(shop, tables, unchecked)
    }
  } catch (error) {
    productsError = message(error)
  }
  return c.html(<ProductList products={products} productsError={productsError} />)
})

app.post('/api/connect', async (c) => {
  const shop = await shopnex.authenticate(c)
  const { apiKey } = (await c.req.json().catch(() => ({}))) as { apiKey?: string }
  if (!apiKey?.trim()) return c.json({ error: 'Enter your CJ API key' }, 400)
  try {
    await connect(shop, apiKey.trim())
  } catch (error) {
    return c.json({ error: `CJ rejected this key: ${message(error)}` }, 400)
  }
  try {
    await ensureOrderWebhook(shop, APP_URL)
  } catch (error) {
    return c.json({ error: `Saved, but couldn't subscribe to paid orders: ${message(error)}` }, 502)
  }
  // From now on checkout asks CJ what shipping costs
  let warning = ''
  try {
    await registerCarrier(shop)
  } catch (error) {
    warning = ` (shipping prices are not on yet: ${message(error)})`
  }
  return c.json({ message: `CJ is connected${warning}` })
})

app.post('/api/settings', async (c) => {
  const shop = await shopnex.authenticate(c)
  const body = (await c.req.json().catch(() => ({}))) as { markupPercent?: string | number; autoPay?: boolean }
  const markupPercent = Number(body.markupPercent)
  if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 1000) {
    return c.json({ error: 'Markup is a percentage from 0 to 1000' }, 400)
  }
  await shop.data.set('settings', { markupPercent, autoPay: Boolean(body.autoPay) })
  return c.json({ message: 'Saved' })
})

app.post('/api/import', async (c) => {
  const shop = await shopnex.authenticate(c)
  const { pid } = (await c.req.json().catch(() => ({}))) as { pid?: string }
  if (!pid?.trim()) return c.json({ error: 'Enter a CJ product ID' }, 400)
  if ((await tables.availability(shop)).get(pid.trim())?.available === false)
    return c.json({ error: OFF_SALE_MESSAGE }, 422)
  try {
    const product = await foregroundTask(() => importProduct(shop, tables, pid.trim()))
    return c.json({ message: `Imported "${product.title}" as a draft` })
  } catch (error) {
    // The SKUs are already in the shop: don't duplicate the product, just tie it to CJ for its orders
    if (isSkuConflict(error)) {
      try {
        await foregroundTask(() => linkProduct(shop, tables, pid.trim()))
        return c.json({ message: 'Already in your shop. Linked to CJ, so its orders will be sent to CJ.' })
      } catch (linkError) {
        return c.json({ error: message(linkError) }, 502)
      }
    }
    if (isOffSale(error)) {
      await tables.setAvailable(shop, pid.trim(), false)
      return c.json({ error: OFF_SALE_MESSAGE }, 422)
    }
    return c.json({ error: message(error) }, 502)
  }
})

app.post('/api/link', async (c) => {
  const shop = await shopnex.authenticate(c)
  const { pid } = (await c.req.json().catch(() => ({}))) as { pid?: string }
  if (!pid?.trim()) return c.json({ error: 'Missing product' }, 400)
  try {
    await foregroundTask(() => linkProduct(shop, tables, pid.trim()))
    return c.json({ message: 'Linked to CJ: its orders will be sent to CJ' })
  } catch (error) {
    if (isOffSale(error)) return c.json({ error: OFF_SALE_MESSAGE }, 422)
    return c.json({ error: message(error) }, 502)
  }
})

app.post('/api/orders/:id/retry', async (c) => {
  const shop = await shopnex.authenticate(c)
  const order = await shop.admin.api.get('/orders/{id}', { params: { path: { id: c.req.param('id') } } })
  // The API types the shipping address as plain JSON; it is the same address the order.paid webhook carries
  await forwardOrder(shop, tables, order as PaidOrder)
  return c.json({ message: 'Sent again' })
})

// --- ShopNex → app ---

// Answers right away; the CJ order is made in the background
app.post('/shopnex/webhook', async (c) => {
  const { event, shop } = await shopnex.verifyWebhook<PaidOrder>(c)
  if (event.type === 'order.paid') void forwardOrder(shop, tables, event.data)
  return c.body(null, 204)
})

// ShopNex asks what shipping costs once the buyer's address is known (see shipping.ts). A failure is no rates, not
// an error: checkout carries on with the shop's other methods, or says it can't ship there.
app.post('/shipping/rates', async (c) => {
  const { request, shop } = await shopnex.verifyRatesRequest(c)
  try {
    return c.json({ rates: await quoteRates(shop, tables, request) })
  } catch (error) {
    console.error(`[cj] shipping prices for ${request.destination.countryCode}:`, message(error))
    return c.json({ rates: [] })
  }
})

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error('[cj]', error)
  return c.json({ error: message(error) }, 500)
})

// --- CJ → ShopNex: CJ pushes order changes only for some order kinds, so poll for tracking numbers ---

async function pollTracking() {
  for (const { instance, shop_id } of await tables.shopsAwaitingTracking()) {
    let shop: ShopContext
    try {
      shop = await shopnex.forShop(instance, shop_id)
    } catch (error) {
      console.warn(`[cj] tracking for ${instance} ${shop_id}:`, message(error))
      continue
    }
    await syncTracking(shop, tables).catch((error) => console.error('[cj] tracking:', message(error)))
  }
}
setInterval(() => void pollTracking(), 15 * 60_000).unref()

serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST || undefined }, () =>
  console.log(`CJ Dropshipping app on ${APP_URL} (port ${PORT})`),
)
