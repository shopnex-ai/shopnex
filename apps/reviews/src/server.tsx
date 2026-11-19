// Reviews for ShopNex: a bundled app on @shopnex/app. Runs next to ShopNex (its own process). Reviews and review
// requests live in DATA_DIR (SQLite, one file: give the container a volume); each shop's settings (days to wait,
// whether its email is off) live in that shop's own ShopNex storage. Email goes through the shop's own email settings.
//
//   GET  /                      Embedded moderation + setup page (session token)
//   POST /api/settings          Days to wait before asking for a review
//   POST /shopnex/webhook       ShopNex: order.fulfilled → review requests
//   GET  /public/reviews        Published reviews of a product (the widget; rate limited)
//   GET  /widget.js             The storefront widget
//   GET|POST /r/:token          The page a buyer opens from the request email (rate limited)
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createShopnexApp } from '@shopnex/app'
import { buildApp } from './app'
import { log } from './log'
import { emailMailer } from './mailer'
import { sendDue } from './send'
import { openStore } from './store'
import { ensureWebhook } from './webhook'

// Public origin ShopNex, the admin (iframe), the storefront and buyers reach this app at
const APP_URL = (process.env.REVIEWS_APP_URL || 'http://localhost:5100').replace(/\/$/, '')
// Listens on the URL's port unless the platform sets PORT (behind a proxy the public URL has none)
const PORT = Number(process.env.PORT || new URL(APP_URL).port || 5100)
const DATA_DIR = process.env.DATA_DIR || '.data'

mkdirSync(DATA_DIR, { recursive: true })
const store = openStore(join(DATA_DIR, 'reviews.db'))

// Its identity is REVIEWS_APP_KEY (env only). ShopNex reads the public key from /.well-known/shopnex-app.json
// (bundled app): see registerBundledApps in @shopnex/apps
const shopnex = createShopnexApp({
  icon: readFileSync(new URL('./icon.svg', import.meta.url), 'utf8'),
  clientId: 'app_reviews',
  appUrl: APP_URL,
  appKey: process.env.REVIEWS_APP_KEY,
  onInstalled: async (shop) => void (await ensureWebhook(shop, APP_URL)),
})

const app = buildApp({
  shopnex,
  store,
  appUrl: APP_URL,
  icon: readFileSync(new URL('./icon.svg', import.meta.url), 'utf8'),
  widget: readFileSync(new URL('./widget.js', import.meta.url), 'utf8'),
})

// Review requests whose time has come go out every minute, through each shop's own email settings
const mailerFor = async (key: { instance: string; shopId: string }) => {
  const shop = await shopnex.forShop(key.instance, key.shopId)
  const mailer = emailMailer(shop)
  const shopName = await shop.admin.api.get('/shop').then(
    (s) => s.name,
    () => null,
  )
  return { mailer, shopName }
}
setInterval(() => void sendDue(store, { appUrl: APP_URL, mailerFor }), 60_000).unref()

serve({ fetch: app.fetch, port: PORT }, () => log.info('Reviews app on %s (port %d)', APP_URL, PORT))
