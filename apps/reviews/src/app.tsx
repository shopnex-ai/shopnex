// The routes. Admin (embedded page, needs a session token), public (the storefront widget and the review link a buyer
// opens from email, no session), and ShopNex → app (the order.fulfilled webhook).
//
//   GET  /                              Moderation + setup, embedded in the admin
//   POST /api/settings                  Days to wait before asking for a review
//   POST /api/publishing                Publish new reviews automatically: off, 4-5 stars, or all
//   POST /api/reviews/:id/publish|hide  Moderate a review
//   POST /api/reviews/:id/reply         The shop's public answer (empty removes it)
//   DELETE /api/reviews/:id             Delete a review
//   POST /shopnex/webhook               ShopNex: order.fulfilled → review requests
//   GET  /public/reviews                Published reviews of a product (CORS open, read-only, rate limited)
//   GET  /widget.js                     The storefront widget
//   GET|POST /r/:token                  The page a buyer opens from the request email (rate limited)
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { type ShopnexApp } from '@shopnex/app'
import { readEmailOff } from './mailer'
import { MessagePage, ReviewFormPage, SettingsPage } from './pages'
import { rateLimit, type RateLimitOptions } from './ratelimit'
import { ensureWebhook } from './webhook'
import { ReviewError, type AutoPublish, type ReviewStatus, type ShopKey, type Store } from './store'

export const DEFAULT_DELAY_DAYS = 7
export const PUBLISH_MODES: AutoPublish[] = ['off', 'positive', 'all']
const DAY_MS = 86_400_000

type FulfilledOrder = {
  id: string
  email: string
  items: { productId: string | null; title: string }[]
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const body = async (c: { req: { json(): Promise<unknown> } }) =>
  ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

// Per client and minute. Buyers open a link once or twice; a storefront page makes one widget call per product.
export const LIMITS = { publicReviews: 120, reviewLink: 20 }
const MINUTE = 60_000

export function buildApp(deps: {
  shopnex: ShopnexApp
  store: Store
  appUrl: string
  icon: string
  widget: string
  /** Overrides, for tests */
  publishModeFor?: (shop: ShopKey) => Promise<AutoPublish>
  limits?: Partial<typeof LIMITS>
  rateLimit?: Pick<RateLimitOptions, 'now' | 'clientOf'>
}) {
  const { shopnex, store, appUrl } = deps
  const limits = { ...LIMITS, ...deps.limits }
  const app = new Hono()
  app.route('/', shopnex.routes)

  // The buyer has no session, so the shop's choice is read with the app's own token. If the shop can't be reached the
  // review simply waits for approval.
  const publishModeFor =
    deps.publishModeFor ??
    (async (key: ShopKey): Promise<AutoPublish> => {
      const shop = await shopnex.forShop(key.instance, key.shopId)
      const mode = await shop.data.get<AutoPublish>('publish_mode')
      return mode && PUBLISH_MODES.includes(mode) ? mode : 'off'
    })

  app.get('/icon.svg', (c) =>
    c.body(deps.icon, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }),
  )
  app.get('/widget.js', (c) =>
    c.body(deps.widget, 200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=300' }),
  )

  // --- admin (embedded page) ---

  app.get('/', async (c) => {
    const shop = await shopnex.authenticate(c.req.raw)
    // An app that missed app.installed still sets itself up when it is first opened
    const webhookError = await ensureWebhook(shop, appUrl).then(
      () => null,
      (error) => message(error),
    )
    const key = { instance: shop.instance, shopId: shop.shopId }
    return c.html(
      <SettingsPage
        shopName={shop.shop.name}
        instance={shop.instance}
        shopId={shop.shopId}
        appUrl={appUrl}
        delayDays={(await shop.data.get<number>('delay_days')) ?? DEFAULT_DELAY_DAYS}
        counts={await store.counts(key)}
        publishMode={(await shop.data.get<AutoPublish>('publish_mode')) ?? 'off'}
        pending={await store.list(key, 'pending')}
        published={await store.list(key, 'published', 50)}
        hidden={await store.list(key, 'hidden', 50)}
        emailOff={await readEmailOff(shop)}
        waiting={await store.unsent(key, Date.now())}
        webhookError={webhookError}
      />,
    )
  })

  app.post('/api/settings', async (c) => {
    const shop = await shopnex.authenticate(c.req.raw)
    const input = await body(c)
    const days = Number(input.delayDays)
    if (!Number.isInteger(days) || days < 0 || days > 90) {
      return c.json({ error: 'Enter a whole number of days from 0 to 90' }, 400)
    }
    await shop.data.set('delay_days', days)
    return c.json({ ok: true })
  })

  app.post('/api/publishing', async (c) => {
    const shop = await shopnex.authenticate(c.req.raw)
    const mode = (await body(c)).publishMode as AutoPublish
    if (!PUBLISH_MODES.includes(mode)) return c.json({ error: 'Choose how new reviews are published' }, 400)
    await shop.data.set('publish_mode', mode)
    return c.json({ ok: true })
  })

  app.post('/api/reviews/:id/reply', async (c) => {
    const shop = await shopnex.authenticate(c.req.raw)
    const reply = String((await body(c)).reply ?? '')
    const done = await store.setReply({ instance: shop.instance, shopId: shop.shopId }, c.req.param('id'), reply)
    return done
      ? c.json({ message: reply.trim() ? 'Reply saved' : 'Reply removed' })
      : c.json({ error: 'Not found' }, 404)
  })

  app.delete('/api/reviews/:id', async (c) => {
    const shop = await shopnex.authenticate(c.req.raw)
    const done = await store.remove({ instance: shop.instance, shopId: shop.shopId }, c.req.param('id'))
    return done ? c.json({ message: 'Deleted' }) : c.json({ error: 'Not found' }, 404)
  })

  const ACTIONS: Record<string, ReviewStatus> = { publish: 'published', hide: 'hidden' }
  app.post('/api/reviews/:id/:action', async (c) => {
    const shop = await shopnex.authenticate(c.req.raw)
    const status = ACTIONS[c.req.param('action')]
    if (!status) return c.json({ error: 'Unknown action' }, 400)
    const done = await store.setStatus({ instance: shop.instance, shopId: shop.shopId }, c.req.param('id'), status)
    return done
      ? c.json({ message: status === 'published' ? 'Published' : 'Hidden' })
      : c.json({ error: 'Not found' }, 404)
  })

  // --- ShopNex → app ---

  app.post('/shopnex/webhook', async (c) => {
    const { event, shop } = await shopnex.verifyWebhook<FulfilledOrder>(c.req.raw)
    if (event.type === 'order.fulfilled' && event.data.email) {
      const days = (await shop.data.get<number>('delay_days')) ?? DEFAULT_DELAY_DAYS
      await store.addRequests({ instance: shop.instance, shopId: shop.shopId }, event.data, Date.now() + days * DAY_MS)
    }
    return c.body(null, 204)
  })

  // --- public: the widget reads published reviews ---

  app.use('/public/*', cors({ origin: '*', allowMethods: ['GET'] }))
  app.use('/public/*', rateLimit({ bucket: 'public', max: limits.publicReviews, windowMs: MINUTE, ...deps.rateLimit }))
  app.get('/public/reviews', async (c) => {
    const shopId = c.req.query('shop')?.slice(0, 100)
    const product = c.req.query('product')?.slice(0, 200)
    let instance: string
    try {
      const url = new URL(c.req.query('instance') ?? '')
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol')
      instance = url.origin
    } catch {
      return c.json({ error: "instance must be the shop's URL" }, 400)
    }
    if (!shopId || !product) return c.json({ error: 'shop and product are required' }, 400)
    const page = (name: string, max: number) => Math.min(Math.max(Math.trunc(Number(c.req.query(name))) || 0, 0), max)
    const limit = page('limit', 50) || 10
    const offset = page('offset', 100_000)
    const { count, average, distribution, reviews } = await store.forProduct({ instance, shopId }, product, {
      limit,
      offset,
    })
    return c.json(
      {
        count,
        average,
        distribution,
        reviews: reviews.map((r) => ({
          rating: r.rating,
          title: r.title,
          body: r.body,
          author: r.author,
          verified: r.verified,
          reply: r.reply,
          createdAt: r.createdAt,
        })),
      },
      200,
      { 'cache-control': 'public, max-age=60' },
    )
  })

  // --- public: the review link from the email ---

  const noLink = (c: Context) =>
    c.html(<MessagePage title="Link not valid" message="This review link is not valid, or you already used it." />, 404)

  // Guessing links is hopeless (192-bit tokens), but a form that anyone can post to still gets a ceiling
  app.use(
    '/r/*',
    rateLimit({
      bucket: 'link',
      max: limits.reviewLink,
      windowMs: MINUTE,
      ...deps.rateLimit,
      onLimit: (c, retryAfter) =>
        c.html(
          <MessagePage title="Slow down" message={`Too many requests. Try again in ${retryAfter} seconds.`} />,
          429,
        ),
    }),
  )

  app.get('/r/:token', async (c) => {
    const request = await store.openRequest(c.req.param('token'))
    return request ? c.html(<ReviewFormPage productTitle={request.productTitle} />) : noLink(c)
  })

  app.post('/r/:token', async (c) => {
    const token = c.req.param('token')
    const request = await store.openRequest(token)
    if (!request) return noLink(c)
    try {
      const mode = await publishModeFor(request).catch(() => 'off' as const)
      await store.submit(token, await c.req.parseBody(), mode)
    } catch (error) {
      if (!(error instanceof ReviewError)) throw error
      if (error.code === 'INVALID_REVIEW') {
        return c.html(<ReviewFormPage productTitle={request.productTitle} error={error.message} />, 400)
      }
      return noLink(c)
    }
    return c.html(
      <MessagePage title="Thank you" message="Your review was sent. The shop will publish it after a quick look." />,
    )
  })

  return app
}
