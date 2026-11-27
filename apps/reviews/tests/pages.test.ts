import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { AdminPage, type AdminPageProps } from '../src/pages'
import type { RequestRow, Review } from '../src/store'

const review = (over: Partial<Review> = {}): Review => ({
  id: 'r1',
  productId: 'p1',
  productTitle: 'Mug',
  rating: 5,
  title: 'Lovely',
  body: 'Holds coffee',
  author: 'Sam',
  verified: true,
  status: 'published',
  reply: null,
  createdAt: Date.UTC(2026, 10, 20),
  ...over,
})

const request = (over: Partial<RequestRow> = {}): RequestRow => ({
  token: 'tok1',
  productId: 'p1',
  productTitle: 'Mug',
  email: 'buyer@example.com',
  sendAfter: Date.now() + 86_400_000,
  sentAt: null,
  status: 'scheduled',
  ...over,
})

const props = (over: Partial<AdminPageProps> = {}): AdminPageProps => ({
  instance: 'https://shop.example.com',
  shopId: 'default',
  appUrl: 'https://reviews.example.com',
  delayDays: 7,
  publishMode: 'off',
  counts: { pending: 0, published: 1, hidden: 0 },
  overview: {
    count: 1,
    average: 5,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    requests: { total: 3, sent: 2, reviewed: 1 },
  },
  products: [{ productId: 'p1', title: 'Mug', total: 1, published: 1, average: 5 }],
  reviews: [review()],
  requests: [],
  emailTexts: { subject: '', message: '' },
  emailOff: false,
  waiting: 0,
  webhookError: null,
  ...over,
})

const render = async (over?: Partial<AdminPageProps>) => String(await AdminPage(props(over)))

describe('the admin page', () => {
  test('has the overview and the four sections', async () => {
    const out = await render()
    assert.match(out, /snx-avg">5\.0</)
    assert.match(out, /Review rate/)
    assert.match(out, /50%/, 'one answer to two sent requests')
    for (const id of ['reviews', 'requests', 'widget', 'settings']) {
      assert.match(out, new RegExp(`data-sx-view-button="${id}"`))
      assert.match(out, new RegExp(`data-sx-view="${id}"`))
    }
  })

  test('shows a dash instead of an average, and no rate, before there is anything to show', async () => {
    const out = await render({
      counts: { pending: 0, published: 0, hidden: 0 },
      overview: {
        count: 0,
        average: null,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        requests: { total: 0, sent: 0, reviewed: 0 },
      },
      products: [],
      reviews: [],
    })
    assert.match(out, /snx-avg">–</)
    assert.match(out, /No reviews yet/)
    assert.doesNotMatch(out, /By product/)
  })

  test('writes what buyers wrote as text, never as markup', async () => {
    const out = await render({
      reviews: [review({ body: '<script>alert(1)</script>', author: '<img src=x onerror=alert(2)>', title: '"><b>' })],
      requests: [request({ email: 'a"><i@example.com' })],
    })
    assert.doesNotMatch(out, /<script>alert\(1\)|<img src=x|"><b>|<i@/)
    assert.match(out, /&quot;&gt;&lt;b&gt;/)
    assert.match(out, /&lt;script&gt;alert\(1\)/)
  })

  test('offers “publish all” only while reviews are waiting, with their number', async () => {
    assert.doesNotMatch(await render(), /Publish all waiting/)
    const out = await render({
      counts: { pending: 2, published: 1, hidden: 0 },
      reviews: [review({ status: 'pending' })],
    })
    assert.match(out, /2 reviews are waiting for you/)
    assert.match(out, /Publish all waiting</)
    assert.match(out, /data-shopnex-action="\/api\/publish-pending"/)
    assert.match(out, /data-confirm-title="Publish all waiting reviews\?"/)
  })

  test('filters by product only when more than one product has reviews', async () => {
    assert.doesNotMatch(await render(), /data-sx-select="product"/)
    const out = await render({ reviews: [review(), review({ id: 'r2', productId: 'p2', productTitle: 'Plate' })] })
    assert.match(out, /data-sx-select="product"/)
    assert.match(out, /data-sx-f-product="p2"/)
  })

  test('lists the requests, with “send now” only on those that have not gone out', async () => {
    const out = await render({
      requests: [
        request({ token: 'soon' }),
        request({ token: 'gone', status: 'sent', sentAt: Date.UTC(2026, 10, 1) }),
        request({ token: 'done', status: 'reviewed', sentAt: Date.UTC(2026, 10, 1) }),
      ],
    })
    assert.match(out, /data-shopnex-action="\/api\/requests\/soon\/send-now"/)
    assert.doesNotMatch(out, /requests\/gone\/send-now|requests\/done\/send-now/)
    assert.match(out, /Sent Nov 1, 2026/)
    assert.match(out, /data-name="requests"/)
    assert.match(out, /data-name="reviews"/)
  })

  test('says so when no request was made yet', async () => {
    assert.match(await render(), /A request is made for every product of an order/)
  })

  test('previews the request email with the shop’s own wording', async () => {
    const out = await render({
      emailTexts: { subject: 'About your {product}', message: 'Please review {product} at {shop}.' },
    })
    assert.match(out, /About your Ceramic Cup/)
    assert.match(out, /Please review Ceramic Cup at Your shop\./)
    assert.match(out, /value="About your \{product\}"/)
  })

  test('gives the embed snippet its instance and shop', async () => {
    const out = await render()
    assert.match(
      out,
      /data-instance=&quot;https:\/\/shop\.example\.com&quot;|data-instance="https:\/\/shop\.example\.com"/,
    )
    assert.match(out, /reviews\.example\.com\/widget\.js/)
  })
})
