import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import { EmailOffError, type Mailer } from '../src/mailer'
import { sendDue } from '../src/send'
import { productKey, ReviewError, type ShopKey, type Store } from '../src/store'
import { testDatabase } from './db'

const shop: ShopKey = { instance: 'https://shop.example.com', shopId: 'default' }
const other: ShopKey = { instance: 'https://shop.example.com', shopId: 'another' }
const PRODUCT = '11111111-1111-4111-8111-111111111111'

let db: Awaited<ReturnType<typeof testDatabase>>
let store: Store
before(async () => {
  db = await testDatabase()
  store = db.store
})
beforeEach(() => db.reset())
after(() => db.close())

const order = (
  id = 'order-1',
  items: { productId: string | null; title: string }[] = [{ productId: PRODUCT, title: 'Mug' }],
) => ({
  id,
  email: 'buyer@example.com',
  items,
})

const review = (token: string, input = { rating: 5, body: 'Great mug' }) => store.submit(token, input)
const refused = (code: string) => (e: unknown) => e instanceof ReviewError && e.code === code
const firstToken = async (key: ShopKey, o = order()) => (await store.addRequests(key, o, 0))[0]!.token

describe('review requests', () => {
  test('one per distinct product in the order; lines without a product are skipped', async () => {
    const made = await store.addRequests(
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

  test('a webhook retry for the same order makes no second request', async () => {
    assert.equal((await store.addRequests(shop, order(), 0)).length, 1)
    assert.equal((await store.addRequests(shop, order(), 0)).length, 0)
  })

  test('the same order number in another shop is its own request', async () => {
    assert.equal((await store.addRequests(shop, order(), 0)).length, 1)
    assert.equal((await store.addRequests(other, order(), 0)).length, 1)
  })

  test('product ids from a theme (gid://…/uuid) and from the API are the same product', async () => {
    assert.equal(productKey(`gid://shopnex/Product/${PRODUCT}`), PRODUCT)
    await store.addRequests(shop, order('o1', [{ productId: `gid://shopnex/Product/${PRODUCT}`, title: 'Mug' }]), 0)
    assert.equal((await store.due(0))[0]!.productId, PRODUCT)
  })

  test('only requests whose time has come are due, and only until they are sent', async () => {
    const [soon] = await store.addRequests(shop, order('o1'), 1000)
    await store.addRequests(shop, order('o2'), 5000)
    assert.deepEqual(
      (await store.due(2000)).map((r) => r.token),
      [soon!.token],
    )
    await store.markSent(soon!.token, 2000)
    assert.equal((await store.due(2000)).length, 0)
    assert.equal((await store.due(9000)).length, 1)
  })

  test('sendDue sends what is due; a failed send stays due for the next pass', async () => {
    await store.addRequests(shop, order('o1'), 0)
    const sent: string[] = []
    const failing: Mailer = () => {
      throw new Error('smtp down')
    }
    const mailerFor = async () => ({ mailer: failing, shopName: 'Shop' })
    assert.equal(await sendDue(store, { appUrl: 'https://reviews.example.com', mailerFor, now: 1 }), 0)
    assert.equal((await store.due(1)).length, 1)
    const ok: Mailer = (email) => void sent.push(email.link)
    const okFor = async () => ({ mailer: ok, shopName: 'Shop' })
    assert.equal(await sendDue(store, { appUrl: 'https://reviews.example.com', mailerFor: okFor, now: 2 }), 1)
    assert.match(sent[0]!, /^https:\/\/reviews\.example\.com\/r\/[\w-]+$/)
    assert.equal((await store.due(3)).length, 0)
  })

  test("sendDue uses each shop's own mailer; a shop with email off or unreachable keeps its requests", async () => {
    await store.addRequests(shop, order('o1'), 0)
    await store.addRequests(other, order('o2'), 0)
    await store.addRequests(other, order('o3'), 0)
    const third: ShopKey = { instance: 'https://third.example.com', shopId: 'default' }
    await store.addRequests(third, order('o4'), 0)
    const sentBy: string[] = []
    const offCalls: string[] = []
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
    assert.deepEqual(sentBy, ['Mugs:buyer@example.com'])
    assert.deepEqual(offCalls, ['another'], 'email off is asked once per pass, not once per request')
    assert.equal((await store.due(1)).length, 3, 'the other two shops are still waiting')
    assert.equal(await store.unsent(other, 1), 2)
    assert.equal(await store.unsent(shop, 1), 0)
    assert.equal(await store.unsent(other, -1), 0, 'not due yet is not waiting')
  })
})

describe('reviews', () => {
  test('a link is single use; the review waits for moderation and is marked verified', async () => {
    const [request] = await store.addRequests(shop, order(), 0)
    assert.deepEqual(await store.openRequest(request!.token), { productTitle: 'Mug' })
    const created = await review(request!.token)
    assert.equal(created.status, 'pending')
    assert.equal(created.verified, true)
    assert.equal(created.author, 'Anonymous')
    assert.equal(await store.openRequest(request!.token), null)
    await assert.rejects(review(request!.token), refused('ALREADY_REVIEWED'))
  })

  test('two people sending the same link at once: one review, one refusal', async () => {
    const token = await firstToken(shop)
    const results = await Promise.allSettled([review(token), review(token), review(token)])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    for (const r of results) if (r.status === 'rejected') assert.ok(refused('ALREADY_REVIEWED')(r.reason))
    assert.equal((await store.list(shop)).length, 1)
  })

  test('unknown links and invalid reviews are refused, and an invalid review does not use the link', async () => {
    await assert.rejects(review('nope'), refused('INVALID_LINK'))
    const [request] = await store.addRequests(shop, order(), 0)
    for (const input of [
      { rating: 0, body: 'x' },
      { rating: 6, body: 'x' },
      { rating: 4.5, body: 'x' },
      { rating: 'five', body: 'x' },
      { rating: 5, body: '   ' },
    ]) {
      await assert.rejects(review(request!.token, input as never), refused('INVALID_REVIEW'))
    }
    assert.notEqual(await store.openRequest(request!.token), null)
  })

  test('a rating outside 1 to 5 is refused by the database itself, not only by the app', async () => {
    const token = await firstToken(shop)
    await assert.rejects(
      db.database.db.execute(
        sql`insert into app_reviews.reviews (id, instance, shop_id, token, product_id, product_title, rating, title, body, author, verified, status, created_at)
            values ('x', 'i', 's', ${token}, 'p', 't', 9, '', 'b', 'a', true, 'pending', 0)`,
      ),
    )
  })

  test('long text is cut, not stored whole', async () => {
    const [request] = await store.addRequests(shop, order(), 0)
    const created = await store.submit(request!.token, {
      rating: 5,
      body: 'x'.repeat(9000),
      title: 't'.repeat(500),
      author: 'a'.repeat(500),
    })
    assert.equal(created.body.length, 5000)
    assert.equal(created.title.length, 120)
    assert.equal(created.author.length, 80)
  })

  test('the storefront sees published reviews only, with their count and average', async () => {
    const a = await review(await firstToken(shop, order('o1')), { rating: 5, body: 'a' })
    const b = await review(await firstToken(shop, order('o2')), { rating: 2, body: 'b' })
    const c = await review(await firstToken(shop, order('o3')), { rating: 4, body: 'c' })

    assert.deepEqual(await store.forProduct(shop, PRODUCT), { count: 0, average: null, reviews: [] })
    await store.setStatus(shop, a.id, 'published')
    await store.setStatus(shop, c.id, 'published')
    await store.setStatus(shop, b.id, 'hidden')
    const shown = await store.forProduct(shop, `gid://shopnex/Product/${PRODUCT}`)
    assert.equal(shown.count, 2)
    assert.equal(shown.average, 4.5)
    assert.deepEqual(shown.reviews.map((r) => r.body).sort(), ['a', 'c'])
    assert.deepEqual(await store.counts(shop), { pending: 0, published: 2, hidden: 1 })
  })

  test('the moderation list is newest first and can be filtered by status', async () => {
    const first = await review(await firstToken(shop, order('o1')), { rating: 5, body: 'first' })
    await new Promise((r) => setTimeout(r, 5))
    await review(await firstToken(shop, order('o2')), { rating: 4, body: 'second' })
    await store.setStatus(shop, first.id, 'published')
    assert.deepEqual(
      (await store.list(shop)).map((r) => r.body),
      ['second', 'first'],
    )
    assert.deepEqual(
      (await store.list(shop, 'pending')).map((r) => r.body),
      ['second'],
    )
  })

  test("shops never see or change each other's reviews", async () => {
    const created = await review(await firstToken(shop))
    assert.equal(await store.setStatus(other, created.id, 'published'), false)
    assert.equal((await store.list(other)).length, 0)
    assert.equal(await store.setStatus(shop, created.id, 'published'), true)
    assert.equal((await store.forProduct(other, PRODUCT)).count, 0)
    assert.equal((await store.forProduct({ ...shop, instance: 'https://elsewhere.example.com' }, PRODUCT)).count, 0)
    assert.equal((await store.forProduct(shop, PRODUCT)).count, 1)
  })
})

describe('the migration', () => {
  test('applying it again is a no-op', async () => {
    const { migrationsFolder } = await import('../src/migrations')
    await db.database.migrate(migrationsFolder())
    assert.deepEqual(await store.counts(shop), { pending: 0, published: 0, hidden: 0 })
  })
})
