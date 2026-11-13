// Shippo for ShopNex: a bundled carrier app on @shopnex/app. Runs next to ShopNex (its own process) and keeps its
// data in ShopNex (shop.data): each shop's Shippo token is stored there, encrypted with this app's key. It registers
// one carrier service per shop; at checkout it asks Shippo for rates.
//
//   GET  /                 Embedded settings page (session token)
//   POST /api/token        Save the Shippo token (checked with Shippo)
//   POST /api/origin       Ship-from address and the default parcel
//   POST /shipping/rates   ShopNex: rates for this cart and address (carrier service)
import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createShopnexApp, type ShopContext } from '@shopnex/app'
import { getToken, isReady, loadConfig, saveConfig, setToken, type Config, type Origin } from './config'
import { SettingsPage } from './settings'
import { quoteRates, verifyKey } from './shippo'

// Public origin ShopNex and the admin (iframe) reach this app at
const APP_URL = (process.env.SHIPPO_APP_URL || 'http://localhost:4900').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 4900)

// Its identity is SHIPPO_APP_KEY (env only); ShopNex stores the shops' settings and sealed secrets (shop.data). ShopNex reads the public key
// from /.well-known/shopnex-app.json (bundled app): see registerBundledApps in @shopnex/apps
const shopnex = createShopnexApp({
  // Shippo's hippo mark (their favicon, which they publish only as a PNG) on a white tile
  icon: readFileSync(new URL('./icon.svg', import.meta.url), 'utf8'),
  clientId: 'app_shippo',
  appUrl: APP_URL,
  appKey: process.env.SHIPPO_APP_KEY,
  // Installed from Settings → Shipping or the discovery page: list the carrier service (not ready yet) right away
  onInstalled: async (shop) => void (await registerCarrier(shop)),
})

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Registers (or updates) the shop's carrier service; ready once there is a token and a ship-from address */
async function registerCarrier(shop: ShopContext, config?: Config) {
  const cfg = config ?? (await loadConfig(shop))
  return shop.shipping.configure({
    name: 'Shippo',
    ratesUrl: `${APP_URL}/shipping/rates`,
    ready: isReady(cfg, Boolean(await getToken(shop))),
  })
}

const app = new Hono()
app.route('/', shopnex.routes)

// --- settings (embedded page) ---

app.get('/', async (c) => {
  const shop = await shopnex.authenticate(c)
  const config = await loadConfig(shop)
  const hasToken = Boolean(await getToken(shop))
  let carrierError: string | null = null
  let carrierOff = false
  // `active` is the merchant's switch in Settings → Shipping: registering doesn't turn it back on
  await registerCarrier(shop, config)
    .then((service) => (carrierOff = !service.active))
    .catch((error) => (carrierError = message(error)))
  return c.html(
    <SettingsPage
      config={config}
      hasToken={hasToken}
      ready={isReady(config, hasToken)}
      carrierError={carrierError}
      carrierOff={carrierOff}
    />,
  )
})

const body = async (c: { req: { json(): Promise<unknown> } }) =>
  ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

app.post('/api/token', async (c) => {
  const shop = await shopnex.authenticate(c)
  const token = text((await body(c)).token)
  if (!token) return c.json({ error: 'Enter your Shippo API token' }, 400)
  try {
    await verifyKey(token)
  } catch (error) {
    return c.json({ error: `Shippo rejected this token: ${message(error)}` }, 400)
  }
  await setToken(shop, token)
  try {
    await registerCarrier(shop)
  } catch (error) {
    return c.json({ error: `Saved, but ShopNex didn't accept the carrier service: ${message(error)}` }, 502)
  }
  return c.json({ ok: true })
})

const number = (v: unknown, fallback: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= max ? n : fallback
}

app.post('/api/origin', async (c) => {
  const shop = await shopnex.authenticate(c)
  const input = await body(c)
  const config = await loadConfig(shop)
  const origin: Origin = {
    name: text(input.name),
    street1: text(input.street1),
    city: text(input.city),
    state: text(input.state),
    zip: text(input.zip),
    country: text(input.country).toUpperCase(),
  }
  if (!origin.street1 || !origin.city || !origin.zip) {
    return c.json({ error: 'Enter at least the street, city and postal code' }, 400)
  }
  if (!/^[A-Z]{2}$/.test(origin.country)) return c.json({ error: 'The country is a two-letter code, e.g. US' }, 400)
  config.origin = origin
  config.parcel = {
    itemWeightOz: number(input.itemWeightOz, config.parcel.itemWeightOz, 10_000),
    lengthIn: number(input.lengthIn, config.parcel.lengthIn, 200),
    widthIn: number(input.widthIn, config.parcel.widthIn, 200),
    heightIn: number(input.heightIn, config.parcel.heightIn, 200),
  }
  await saveConfig(shop, config)
  try {
    await registerCarrier(shop, config)
  } catch (error) {
    return c.json({ error: `Saved, but ShopNex didn't accept the carrier service: ${message(error)}` }, 502)
  }
  return c.json({ ok: true })
})

// --- ShopNex → app: rates for a cart ---

// A failure is no rates, not an error: checkout carries on with the shop's other methods
app.post('/shipping/rates', async (c) => {
  const { request, shop } = await shopnex.verifyRatesRequest(c)
  try {
    const [config, token] = [await loadConfig(shop), await getToken(shop)]
    if (!token || !config.origin) return c.json({ rates: [] })
    return c.json({ rates: await quoteRates(token, config.origin, config.parcel, request) })
  } catch (error) {
    console.error(`[shippo] rates for ${request.destination.countryCode}:`, message(error))
    return c.json({ rates: [] })
  }
})

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error('[shippo]', error)
  return c.json({ error: message(error) }, 500)
})

serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST || undefined }, () =>
  console.log(`Shippo app on ${APP_URL} (port ${PORT})`),
)
