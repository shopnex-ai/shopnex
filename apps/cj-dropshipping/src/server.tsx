// CJ Dropshipping for Shopnex: a bundled app on @shopnex/app. Runs next to Shopnex (its own process) and keeps
// its data in DATA_DIR (SQLite): the shop's CJ key is stored there, encrypted with this app's key.
//
//   GET  /                          Embedded settings page (session token)
//   POST /api/connect               Save the CJ API key, subscribe to paid orders
//   POST /api/settings              Markup and auto-pay
//   POST /api/import                CJ product → draft Shopnex product (already in the shop: link it instead)
//   POST /api/link                  Tie a product already in the shop to CJ, so its orders go to CJ
//   POST /api/orders/:id/retry      Send a failed order to CJ again
//   POST /shopnex/webhook           Shopnex: order.paid → CJ order
//   POST /shipping/rates            Shopnex: what CJ shipping costs for this cart and address (carrier service)
//   (every 15 minutes)              CJ tracking numbers → Shopnex fulfillments
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createShopnexApp, type ShopContext } from '@shopnex/app'
import { openLocalStore } from '@shopnex/app/store'
import { connect, cjFor, isConnected, settingsOf } from './cj'
import { openTables } from './db'
import {
  checkAvailability,
  foregroundTask,
  importProduct,
  inShop,
  isOffSale,
  isSkuConflict,
  linkProduct,
  needsCheck,
  OFF_SALE_MESSAGE,
  shopSkus,
} from './import'
import { forwardOrder, syncTracking, type PaidOrder } from './orders'
import { quoteRates } from './shipping'
import { icon, SettingsPage, type MyProduct } from './settings'

// Public origin Shopnex and the admin (iframe) reach this app at
const APP_URL = (process.env.CJ_DROPSHIPPING_APP_URL || 'http://localhost:4700').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 4700)

// The app's identity and the shops' settings live in DATA_DIR (a volume in Docker). Shopnex reads the public key
// from /.well-known/shopnex-app.json (bundled app): see registerBundledApps in @shopnex/apps
const store = await openLocalStore()
const tables = openTables(store.db)
const shopnex = createShopnexApp({
  clientId: 'app_cj_dropshipping',
  appUrl: APP_URL,
  appKey: store.appKey,
  data: store.dataFor,
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
 * Paid orders reach the app through a subscription made with its own token. Uninstalling the app deletes it (and
 * installing again makes a new token), so check it is there instead of remembering that it was made.
 */
async function ensureOrderWebhook(shop: ShopContext) {
  const url = `${APP_URL}/shopnex/webhook`
  const mine = await shop.admin.get<{ url: string; active: boolean }[]>('/webhooks')
  if (mine.some((h) => h.url === url && h.active)) return
  await shop.admin.post('/webhooks', { url, description: 'CJ Dropshipping', topics: ['order.paid'], active: true })
}

/**
 * Offers CJ's shipping prices at checkout (a Shopnex carrier service). It needs the shipping permission, so a shop
 * that installed the app before it existed gets an error here until the app is installed again.
 */
async function registerCarrier(shop: ShopContext) {
  const service = await shop.shipping.configure({
    name: 'CJ Dropshipping',
    ratesUrl: `${APP_URL}/shipping/rates`,
    ready: true,
  })
  await shop.data.set('carrier_service', { id: service.id })
}

const app = new Hono()
app.route('/', shopnex.routes)
app.get('/icon.svg', (c) => c.body(icon, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }))

// --- settings (embedded page) ---

app.get('/', async (c) => {
  const shop = await shopnex.authenticate(c)
  const connected = await isConnected(shop)
  let products: MyProduct[] = []
  let productsError: string | null = null
  let shippingError: string | null = null
  // Registering again is safe, and keeps the service (and its id, which orders are matched on) right after a
  // new install; shops connected before shipping prices existed switch them on here too
  if (connected) await registerCarrier(shop).catch((error) => (shippingError = message(error)))
  // After an uninstall and a new install the subscription is gone: make it again, so paid orders still reach CJ
  if (connected)
    await ensureOrderWebhook(shop).catch((error) => console.warn('[cj] order subscription:', message(error)))
  if (connected) {
    try {
      const { cj } = await cjFor(shop)
      const result = await cj.products.getMyProducts()
      if (result.error) productsError = result.error
      else {
        const known = tables.availability(shop)
        const skus = await shopSkus(shop).catch(() => null)
        const linked = tables.linkedSkus(shop)
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
  }
  return c.html(
    <SettingsPage
      connected={connected}
      settings={await settingsOf(shop)}
      products={products}
      productsError={productsError}
      shippingError={shippingError}
      orders={tables.orders(shop)}
    />,
  )
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
    await ensureOrderWebhook(shop)
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
  if (tables.availability(shop).get(pid.trim())?.available === false) return c.json({ error: OFF_SALE_MESSAGE }, 422)
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
      tables.setAvailable(shop, pid.trim(), false)
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
  const order = await shop.admin.get<PaidOrder>(`/orders/${c.req.param('id')}`)
  await forwardOrder(shop, tables, order)
  return c.json({ message: 'Sent again' })
})

// --- Shopnex → app ---

// Answers right away; the CJ order is made in the background
app.post('/shopnex/webhook', async (c) => {
  const { event, shop } = await shopnex.verifyWebhook<PaidOrder>(c)
  if (event.type === 'order.paid') void forwardOrder(shop, tables, event.data)
  return c.body(null, 204)
})

// Shopnex asks what shipping costs once the buyer's address is known (see shipping.ts). A failure is no rates, not
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

// --- CJ → Shopnex: CJ pushes order changes only for some order kinds, so poll for tracking numbers ---

async function pollTracking() {
  for (const { instance, shop_id } of tables.shopsAwaitingTracking()) {
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

serve({ fetch: app.fetch, port: PORT }, () => console.log(`CJ Dropshipping app on ${APP_URL} (port ${PORT})`))
