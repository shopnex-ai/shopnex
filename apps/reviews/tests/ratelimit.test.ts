import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Hono } from 'hono'
import { createShopnexApp } from '@shopnex/app'
import { generateKeyPair } from '@shopnex/marketplace-sdk/keys'
import { buildApp } from '../src/app'
import { clientIp, rateLimit } from '../src/ratelimit'
import { testDatabase } from './db'

const from = (ip: string) => ({ headers: { 'x-client': ip } })

describe('rateLimit', () => {
  test('allows max per window, then 429 with Retry-After; the next window starts fresh', async () => {
    let t = 1_000_000
    const app = new Hono()
    app.use(
      '*',
      rateLimit({ bucket: 'a', max: 3, windowMs: 60_000, now: () => t, clientOf: (c) => c.req.header('x-client')! }),
    )
    app.get('/', (c) => c.text('ok'))

    for (let i = 0; i < 3; i++) assert.equal((await app.request('/', from('1.1.1.1'))).status, 200)
    const blocked = await app.request('/', from('1.1.1.1'))
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('retry-after'), '60')
    assert.equal(blocked.headers.get('ratelimit-remaining'), '0')
    assert.equal((await app.request('/', from('2.2.2.2'))).status, 200, 'another client has its own count')

    t += 59_000
    assert.equal((await app.request('/', from('1.1.1.1'))).status, 429)
    t += 1_001
    assert.equal((await app.request('/', from('1.1.1.1'))).status, 200, 'the window is over')
  })

  test('the client is the last hop of the configured header, so a visitor cannot pick their own address', async () => {
    const app = new Hono()
    app.get('/', (c) => c.text(clientIp(c, 'x-forwarded-for')))
    const ip = async (h: Record<string, string>) => (await app.request('/', { headers: h })).text()
    assert.equal(await ip({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }), '10.0.0.1')
    assert.equal(await ip({ 'x-forwarded-for': '10.0.0.1' }), '10.0.0.1')
    assert.equal(await ip({}), 'unknown')
  })
})

describe('the app routes are limited', () => {
  let app: ReturnType<typeof buildApp>
  let db: Awaited<ReturnType<typeof testDatabase>>
  const shop = { instance: 'https://shop.example.com', shopId: 'default' }

  after(() => db?.close())

  before(async () => {
    db = await testDatabase()
    const shopnex = createShopnexApp({ clientId: 'app_test', appKey: (await generateKeyPair()).privateKey })
    app = buildApp({
      shopnex,
      store: db.store,
      appUrl: 'https://reviews.example.com',
      icon: '<svg/>',
      widget: '',
      limits: { publicReviews: 2, reviewLink: 2 },
      rateLimit: { clientOf: (c) => c.req.header('x-client') ?? 'x' },
    })
  })

  const reviews = (ip: string) =>
    app.request(`/public/reviews?instance=${encodeURIComponent(shop.instance)}&shop=${shop.shopId}&product=p`, from(ip))

  test('/public/reviews: 429 JSON past the limit, still readable cross-origin', async () => {
    assert.equal((await reviews('3.3.3.3')).status, 200)
    assert.equal((await reviews('3.3.3.3')).status, 200)
    const blocked = await reviews('3.3.3.3')
    assert.equal(blocked.status, 429)
    assert.match((await blocked.json()).error, /Too many requests/)
    assert.equal(blocked.headers.get('access-control-allow-origin'), '*', 'the widget can read the error')
    assert.equal((await reviews('4.4.4.4')).status, 200)
  })

  test('/r/:token: guessing and posting is limited, with a page for people', async () => {
    const hit = (ip: string) => app.request('/r/not-a-token', from(ip))
    assert.equal((await hit('5.5.5.5')).status, 404)
    assert.equal((await hit('5.5.5.5')).status, 404)
    const blocked = await hit('5.5.5.5')
    assert.equal(blocked.status, 429)
    assert.match(await blocked.text(), /Too many requests/)
    const post = await app.request('/r/not-a-token', { method: 'POST', ...from('5.5.5.5') })
    assert.equal(post.status, 429, 'posts count too')
  })

  test('the limits are separate: the widget being busy does not block a buyer', async () => {
    for (let i = 0; i < 5; i++) await reviews('6.6.6.6')
    assert.equal((await app.request('/r/not-a-token', from('6.6.6.6'))).status, 404)
  })

  test('/shopnex/webhook is not rate limited (signed by ShopNex)', async () => {
    for (let i = 0; i < 5; i++) {
      assert.notEqual((await app.request('/shopnex/webhook', { method: 'POST', ...from('7.7.7.7') })).status, 429)
    }
  })
})
