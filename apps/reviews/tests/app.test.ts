import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { createShopnexApp } from '@shopnex/app'
import { generateKeyPair } from '@shopnex/marketplace-sdk/keys'
import { buildApp } from '../src/app'
import { openStore, type Store } from '../src/store'

const shop = { instance: 'https://shop.example.com', shopId: 'default' }
const PRODUCT = '11111111-1111-4111-8111-111111111111'
const APP_URL = 'https://reviews.example.com'

let store: Store
let app: ReturnType<typeof buildApp>

before(async () => {
  store = openStore(':memory:')
  const shopnex = createShopnexApp({ clientId: 'app_test', appKey: (await generateKeyPair()).privateKey })
  app = buildApp({
    shopnex,
    store,
    appUrl: APP_URL,
    icon: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    widget: '/* widget */',
  })
})

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
})

describe('public routes', () => {
  test('serve the icon and the widget', async () => {
    assert.equal((await app.request('/icon.svg')).headers.get('content-type'), 'image/svg+xml')
    const widget = await app.request('/widget.js')
    assert.equal(widget.headers.get('content-type'), 'text/javascript')
    assert.equal(await widget.text(), '/* widget */')
  })

  test('the review link: form, thanks, and a second use is refused', async () => {
    const [request] = store.addRequests(
      shop,
      { id: 'o1', email: 'b@example.com', items: [{ productId: PRODUCT, title: 'Mug <b>' }] },
      0,
    )
    const page = await app.request(`/r/${request!.token}`)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /Mug &lt;b&gt;/, 'the product title is escaped')

    const bad = await app.request(`/r/${request!.token}`, form({ rating: '9', body: 'x' }))
    assert.equal(bad.status, 400)
    assert.match(await bad.text(), /Choose a rating/)

    const done = await app.request(`/r/${request!.token}`, form({ rating: '5', body: 'Lovely', author: 'Sam' }))
    assert.equal(done.status, 200)
    assert.match(await done.text(), /Thank you/)
    assert.equal(store.list(shop, 'pending').length, 1)

    assert.equal((await app.request(`/r/${request!.token}`)).status, 404)
    assert.equal((await app.request(`/r/${request!.token}`, form({ rating: '5', body: 'again' }))).status, 404)
    assert.equal((await app.request('/r/not-a-token')).status, 404)
  })

  test('/public/reviews: open to any origin, published reviews only, input checked', async () => {
    const [request] = store.addRequests(
      shop,
      { id: 'o2', email: 'b@example.com', items: [{ productId: PRODUCT, title: 'Mug' }] },
      0,
    )
    const pending = store.submit(request!.token, { rating: 4, body: 'Pretty good', author: 'Alex' })
    const query = `instance=${encodeURIComponent(shop.instance)}&shop=${shop.shopId}&product=${PRODUCT}`

    let res = await app.request(`/public/reviews?${query}`)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.equal((await res.json()).count, 0, 'a pending review is not public')

    store.setStatus(shop, pending.id, 'published')
    res = await app.request(`/public/reviews?${query}`)
    const data = await res.json()
    assert.equal(data.count, 1)
    assert.equal(data.average, 4)
    assert.deepEqual(Object.keys(data.reviews[0]).sort(), [
      'author',
      'body',
      'createdAt',
      'rating',
      'title',
      'verified',
    ])

    assert.equal((await app.request(`/public/reviews?instance=nope&shop=a&product=b`)).status, 400)
    assert.equal((await app.request(`/public/reviews?instance=javascript:alert(1)&shop=a&product=b`)).status, 400)
    assert.equal((await app.request(`/public/reviews?instance=${encodeURIComponent(shop.instance)}`)).status, 400)
  })
})

describe('admin and webhook routes need proof of who is calling', () => {
  test('no session token: 401', async () => {
    assert.equal((await app.request('/')).status, 401)
    assert.equal((await app.request('/api/settings', { method: 'POST', body: '{}' })).status, 401)
    assert.equal((await app.request('/api/reviews/x/publish', { method: 'POST' })).status, 401)
  })

  test('an unsigned webhook is refused', async () => {
    assert.equal((await app.request('/shopnex/webhook', { method: 'POST', body: '{}' })).status, 401)
  })
})
