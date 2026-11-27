import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { Hono } from 'hono'
import type { ShopnexApp } from '@shopnex/app'
import { buildApp } from '../src/app'
import { MAX_MESSAGE, MAX_SUBJECT } from '../src/mailer'
import type { ShopKey, Store } from '../src/store'
import { testDatabase } from './db'

const shop: ShopKey = { instance: 'https://shop.example.com', shopId: 'default' }
const PRODUCT = '11111111-1111-4111-8111-111111111111'

// The part of ShopnexApp these routes use: who is asking (always this shop), and its app storage
const saved = new Map<string, unknown>()
const shopnex = {
  routes: new Hono(),
  authenticate: async () => ({
    ...shop,
    data: {
      get: async (key: string) => saved.get(key) ?? null,
      set: async (key: string, value: unknown) => void saved.set(key, value),
    },
  }),
} as unknown as ShopnexApp

let db: Awaited<ReturnType<typeof testDatabase>>
let store: Store
let app: ReturnType<typeof buildApp>
before(async () => {
  db = await testDatabase()
  store = db.store
  app = buildApp({ shopnex, store, appUrl: 'https://reviews.example.com', icon: '', widget: '' })
})
beforeEach(async () => {
  await db.reset()
  saved.clear()
})
after(() => db.close())

const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('POST /api/email', () => {
  test('saves the subject and message, trimmed', async () => {
    const res = await post('/api/email', { subject: '  About {product} ', message: ' Please review. ' })
    assert.equal(res.status, 200)
    assert.equal(saved.get('email_subject'), 'About {product}')
    assert.equal(saved.get('email_message'), 'Please review.')
  })

  test('empty fields bring the standard text back', async () => {
    await post('/api/email', { subject: 'x', message: 'y' })
    assert.equal((await post('/api/email', { subject: '', message: '' })).status, 200)
    assert.equal(saved.get('email_subject'), '')
    assert.equal(saved.get('email_message'), '')
  })

  test('refuses text that is too long, and saves nothing', async () => {
    const long = await post('/api/email', { subject: 'x'.repeat(MAX_SUBJECT + 1), message: 'ok' })
    assert.equal(long.status, 400)
    assert.equal((await post('/api/email', { subject: 'ok', message: 'x'.repeat(MAX_MESSAGE + 1) })).status, 400)
    assert.equal(saved.size, 0)
  })
})

describe('POST /api/publish-pending', () => {
  test('publishes what is waiting and says how many', async () => {
    for (const id of ['o1', 'o2']) {
      const [request] = await store.addRequests(
        shop,
        { id, email: 'b@example.com', items: [{ productId: PRODUCT, title: 'Mug' }] },
        0,
      )
      await store.submit(request!.token, { rating: 4, body: 'Nice' })
    }
    const res = await post('/api/publish-pending')
    assert.deepEqual(await res.json(), { message: 'Published 2 reviews' })
    assert.equal((await store.counts(shop)).pending, 0)
    assert.deepEqual(await (await post('/api/publish-pending')).json(), { message: 'Published 0 reviews' })
  })
})

describe('POST /api/requests/:token/send-now', () => {
  test('makes a scheduled request due', async () => {
    const [request] = await store.addRequests(
      shop,
      { id: 'o1', email: 'b@example.com', items: [{ productId: PRODUCT, title: 'Mug' }] },
      Date.now() + 86_400_000,
    )
    assert.equal((await store.due(Date.now())).length, 0)
    assert.equal((await post(`/api/requests/${request!.token}/send-now`)).status, 200)
    assert.equal((await store.due(Date.now())).length, 1)
  })

  test('404 for a request that is unknown or already sent', async () => {
    assert.equal((await post('/api/requests/nope/send-now')).status, 404)
    const [request] = await store.addRequests(
      shop,
      { id: 'o1', email: 'b@example.com', items: [{ productId: PRODUCT, title: 'Mug' }] },
      0,
    )
    await store.markSent(request!.token, 1)
    assert.equal((await post(`/api/requests/${request!.token}/send-now`)).status, 404)
  })
})
