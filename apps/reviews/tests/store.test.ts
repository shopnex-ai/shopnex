import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { EmailOffError, type Mailer } from '../src/mailer'
import { sendDue } from '../src/send'
import { openStore, productKey, ReviewError, type ShopKey, type Store } from '../src/store'

const shop: ShopKey = { instance: 'https://shop.example.com', shopId: 'default' }
const other: ShopKey = { instance: 'https://shop.example.com', shopId: 'another' }
const PRODUCT = '11111111-1111-4111-8111-111111111111'

let store: Store
beforeEach(() => {
  store = openStore(':memory:')
})

const order = (
  id = 'order-1',
  items: { productId: string | null; title: string }[] = [{ productId: PRODUCT, title: 'Mug' }],
) => ({
  id,
  email: 'buyer@example.com',
  items,
})

function review(token: string, input = { rating: 5, body: 'Great mug' }) {
  return store.submit(token, input)
}

describe('review requests', () => {
  test('one per distinct product in the order; lines without a product are skipped', () => {
    const made = store.addRequests(
      shop,
      order('o1', [
        { productId: PRODUCT, title: 'Mug' },
        { productId: PRODUCT, title: 'Mug (large)' },
        { productId: null, title: 'Deleted product' },
        { productId: '22222222-2222-4222-8222-222222222222', title: 'Plate' },
      ]),
      0,
    )
    assert.equal(made.length, 2)
    assert.notEqual(made[0]!.token, made[1]!.token)
  })

  test('a webhook retry for the same order makes no second request', () => {
    assert.equal(store.addRequests(shop, order(), 0).length, 1)
    assert.equal(store.addRequests(shop, order(), 0).length, 0)
  })

  test('product ids from a theme (gid://…/uuid) and from the API are the same product', () => {
    assert.equal(productKey(`gid://shopnex/Product/${PRODUCT}`), PRODUCT)
    store.addRequests(shop, order('o1', [{ productId: `gid://shopnex/Product/${PRODUCT}`, title: 'Mug' }]), 0)
    assert.equal(store.due(0)[0]!.productId, PRODUCT)
  })

  test('only requests whose time has come are due, and only until they are sent', () => {
    const [soon] = store.addRequests(shop, order('o1'), 1000)
    store.addRequests(shop, order('o2'), 5000)
    assert.deepEqual(
      store.due(2000).map((r) => r.token),
      [soon!.token],
    )
    store.markSent(soon!.token, 2000)
    assert.equal(store.due(2000).length, 0)
    assert.equal(store.due(9000).length, 1)
  })

  test('sendDue sends what is due; a failed send stays due for the next pass', async () => {
    store.addRequests(shop, order('o1'), 0)
    const sent: string[] = []
    const failing: Mailer = () => {
      throw new Error('smtp down')
    }
    const silence = console.error
    console.error = () => {}
    try {
      const mailerFor = async () => ({ mailer: failing, shopName: 'Shop' })
      assert.equal(await sendDue(store, { appUrl: 'https://reviews.example.com', mailerFor, now: 1 }), 0)
    } finally {
      console.error = silence
    }
    assert.equal(store.due(1).length, 1)
    const ok: Mailer = (email) => void sent.push(email.link)
    const mailerFor = async () => ({ mailer: ok, shopName: 'Shop' })
    assert.equal(await sendDue(store, { appUrl: 'https://reviews.example.com', mailerFor, now: 2 }), 1)
    assert.match(sent[0]!, /^https:\/\/reviews\.example\.com\/r\/[\w-]+$/)
    assert.equal(store.due(3).length, 0)
  })

  test("sendDue uses each shop's own mailer; a shop with email off or unreachable keeps its requests", async () => {
    store.addRequests(shop, order('o1'), 0)
    store.addRequests(other, order('o2'), 0)
    store.addRequests(other, order('o3'), 0)
    const third: ShopKey = { instance: 'https://third.example.com', shopId: 'default' }
    store.addRequests(third, order('o4'), 0)
    const sentBy: string[] = []
    const offCalls: string[] = []
    const silence = console.error
    console.error = () => {}
    try {
      const mailerFor = async (key: ShopKey) => {
        if (key.instance === third.instance) throw new Error('uninstalled')
        if (key.shopId === 'another') {
          const off: Mailer = () => {
            offCalls.push(key.shopId)
            throw new EmailOffError()
          }
          return { mailer: off, shopName: 'Off' }
        }
        return { mailer: ((email) => void sentBy.push(`${email.shopName}:${email.to}`)) as Mailer, shopName: 'Mugs' }
      }
      assert.equal(await sendDue(store, { appUrl: 'https://reviews.example.com', mailerFor, now: 1 }), 1)
    } finally {
      console.error = silence
    }
    assert.deepEqual(sentBy, ['Mugs:buyer@example.com'])
    assert.deepEqual(offCalls, ['another'], 'email off is asked once per pass, not once per request')
    assert.equal(store.due(1).length, 3, 'the other two shops are still waiting')
    assert.equal(store.unsent(other, 1), 2)
    assert.equal(store.unsent(shop, 1), 0)
    assert.equal(store.unsent(other, -1), 0, 'not due yet is not waiting')
  })
})

describe('reviews', () => {
  test('a link is single use; the review waits for moderation and is marked verified', () => {
    const [request] = store.addRequests(shop, order(), 0)
    assert.deepEqual(store.openRequest(request!.token), { productTitle: 'Mug' })
    const created = review(request!.token)
    assert.equal(created.status, 'pending')
    assert.equal(created.verified, true)
    assert.equal(created.author, 'Anonymous')
    assert.equal(store.openRequest(request!.token), null)
    assert.throws(
      () => review(request!.token),
      (e) => e instanceof ReviewError && e.code === 'ALREADY_REVIEWED',
    )
  })

  test('unknown links and invalid reviews are refused, and an invalid review does not use the link', () => {
    assert.throws(
      () => review('nope'),
      (e) => e instanceof ReviewError && e.code === 'INVALID_LINK',
    )
    const [request] = store.addRequests(shop, order(), 0)
    for (const input of [
      { rating: 0, body: 'x' },
      { rating: 6, body: 'x' },
      { rating: 4.5, body: 'x' },
      { rating: 'five', body: 'x' },
      { rating: 5, body: '   ' },
    ]) {
      assert.throws(
        () => review(request!.token, input as never),
        (e) => e instanceof ReviewError && e.code === 'INVALID_REVIEW',
      )
    }
    assert.notEqual(store.openRequest(request!.token), null)
  })

  test('long text is cut, not stored whole', () => {
    const [request] = store.addRequests(shop, order(), 0)
    const created = store.submit(request!.token, {
      rating: 5,
      body: 'x'.repeat(9000),
      title: 't'.repeat(500),
      author: 'a'.repeat(500),
    })
    assert.equal(created.body.length, 5000)
    assert.equal(created.title.length, 120)
    assert.equal(created.author.length, 80)
  })

  test('the storefront sees published reviews only, with their count and average', () => {
    const tokens = store.addRequests(shop, order('o1', [{ productId: PRODUCT, title: 'Mug' }]), 0)
    const a = review(tokens[0]!.token, { rating: 5, body: 'a' })
    const b = store.submit(store.addRequests(shop, order('o2'), 0)[0]!.token, { rating: 2, body: 'b' })
    const c = store.submit(store.addRequests(shop, order('o3'), 0)[0]!.token, { rating: 4, body: 'c' })

    assert.deepEqual(store.forProduct(shop, PRODUCT), { count: 0, average: null, reviews: [] })
    store.setStatus(shop, a.id, 'published')
    store.setStatus(shop, c.id, 'published')
    store.setStatus(shop, b.id, 'hidden')
    const shown = store.forProduct(shop, `gid://shopnex/Product/${PRODUCT}`)
    assert.equal(shown.count, 2)
    assert.equal(shown.average, 4.5)
    assert.deepEqual(shown.reviews.map((r) => r.body).sort(), ['a', 'c'])
    assert.deepEqual(store.counts(shop), { pending: 0, published: 2, hidden: 1 })
  })

  test("shops never see or change each other's reviews", () => {
    const created = review(store.addRequests(shop, order(), 0)[0]!.token)
    assert.equal(store.setStatus(other, created.id, 'published'), false)
    assert.equal(store.list(other).length, 0)
    assert.equal(store.setStatus(shop, created.id, 'published'), true)
    assert.equal(store.forProduct(other, PRODUCT).count, 0)
    assert.equal(store.forProduct({ ...shop, instance: 'https://elsewhere.example.com' }, PRODUCT).count, 0)
    assert.equal(store.forProduct(shop, PRODUCT).count, 1)
  })
})
