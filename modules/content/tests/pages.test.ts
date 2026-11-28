// Pages: handles (made from the title or chosen, once per shop), publishing and scheduling, sanitized bodies, and what the storefront sees.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { pages } from '../src/content.schema'

const { db, eq, pageService, SHOP, OTHER_SHOP } = fx
const { ContentError } = await import('../src')

const taken = (e: unknown) => e instanceof ContentError && e.code === 'HANDLE_TAKEN'
const DAY = 86_400_000

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('creating a page', () => {
  test('the handle comes from the title, and a title used before gets -2, -3 …', async () => {
    const a = await pageService.create(SHOP, { title: 'About Us!' }, db)
    const b = await pageService.create(SHOP, { title: 'About Us!' }, db)
    const c = await pageService.create(SHOP, { title: 'About Us!' }, db)
    assert.deepEqual([a.handle, b.handle, c.handle], ['about-us', 'about-us-2', 'about-us-3'])
    assert.equal(
      (await pageService.create(SHOP, { title: '!!!' }, db)).handle,
      'page',
      'a title with nothing to make a handle from',
    )
  })

  test('a handle that is chosen is used as given, once per shop', async () => {
    await pageService.create(SHOP, { title: 'Shipping', handle: 'delivery' }, db)
    await assert.rejects(pageService.create(SHOP, { title: 'Other', handle: 'delivery' }, db), taken)
    await pageService.create(OTHER_SHOP, { title: 'Shipping', handle: 'delivery' }, db)
  })

  test('it is published now unless said otherwise, and the body is sanitized', async () => {
    const before = Date.now()
    const live = await pageService.create(SHOP, { title: 'Live', bodyHtml: '<p>Hi</p><script>alert(1)</script>' }, db)
    assert.ok(live.publishedAt && live.publishedAt.getTime() >= before - 1000)
    assert.ok(!/script/i.test(live.bodyHtml))
    assert.ok(live.bodyHtml.includes('<p>Hi</p>'))
    const draft = await pageService.create(SHOP, { title: 'Draft', published: false }, db)
    assert.equal(draft.publishedAt, null)
  })

  test('the search engine title and description are kept', async () => {
    const p = await pageService.create(SHOP, { title: 'FAQ', seo: { title: 'Questions', description: 'Answers' } }, db)
    assert.deepEqual([p.seoTitle, p.seoDescription], ['Questions', 'Answers'])
  })
})

describe('updating a page', () => {
  test('changes only what is given; another shop’s page or an unknown one is null', async () => {
    const p = await pageService.create(SHOP, { title: 'Old', bodyHtml: '<p>keep</p>' }, db)
    const changed = await pageService.update(SHOP, p.id, { title: 'New' }, db)
    assert.deepEqual([changed?.title, changed?.bodyHtml, changed?.handle], ['New', '<p>keep</p>', p.handle])
    assert.ok(changed!.updatedAt.getTime() >= p.updatedAt.getTime())
    assert.equal(await pageService.update(OTHER_SHOP, p.id, { title: 'No' }, db), null)
    assert.equal(await pageService.update(SHOP, '00000000-0000-4000-8000-000000000000', { title: 'No' }, db), null)
  })

  test('a handle can be kept or changed, but not to another page’s', async () => {
    const [a, b] = [
      await pageService.create(SHOP, { title: 'One' }, db),
      await pageService.create(SHOP, { title: 'Two' }, db),
    ]
    assert.equal((await pageService.update(SHOP, a.id, { handle: a.handle }, db))?.handle, a.handle)
    assert.equal((await pageService.update(SHOP, a.id, { handle: 'renamed' }, db))?.handle, 'renamed')
    await assert.rejects(pageService.update(SHOP, b.id, { handle: 'renamed' }, db), taken)
  })

  test('unpublishing clears the date; publishing again sets one, and publishing a live page keeps its date', async () => {
    const p = await pageService.create(SHOP, { title: 'Toggle' }, db)
    const kept = await pageService.update(SHOP, p.id, { published: true }, db)
    assert.equal(kept?.publishedAt?.getTime(), p.publishedAt?.getTime(), 'a live page keeps its date')
    assert.equal((await pageService.update(SHOP, p.id, { published: false }, db))?.publishedAt, null)
    assert.ok((await pageService.update(SHOP, p.id, { published: true }, db))?.publishedAt)
    const untouched = await pageService.update(SHOP, p.id, { title: 'Still live' }, db)
    assert.ok(untouched?.publishedAt, 'an update that does not mention publishing leaves it')
  })

  test('the body is sanitized on update too', async () => {
    const p = await pageService.create(SHOP, { title: 'Body' }, db)
    const changed = await pageService.update(SHOP, p.id, { bodyHtml: '<img src=x onerror=alert(1)><p>ok</p>' }, db)
    assert.ok(!/onerror/i.test(changed!.bodyHtml))
  })
})

describe('reading pages', () => {
  test('the admin sees every page of the shop, oldest first, and only its own', async () => {
    const [a, b] = [
      await pageService.create(SHOP, { title: 'First' }, db),
      await pageService.create(SHOP, { title: 'Second', published: false }, db),
    ]
    await db
      .update(pages)
      .set({ createdAt: new Date('2026-01-01') })
      .where(eq(pages.id, a.id))
    await db
      .update(pages)
      .set({ createdAt: new Date('2026-01-02') })
      .where(eq(pages.id, b.id))
    await pageService.create(OTHER_SHOP, { title: 'Elsewhere' }, db)
    assert.deepEqual(
      (await pageService.list(SHOP, db)).map((p) => p.id),
      [a.id, b.id],
    )
    assert.equal((await pageService.getById(SHOP, a.id, db))?.id, a.id)
    assert.equal(await pageService.getById(OTHER_SHOP, a.id, db), null)
  })

  test('the storefront sees published pages only: not drafts, and not ones scheduled for later', async () => {
    const live = await pageService.create(SHOP, { title: 'Live' }, db)
    await pageService.create(SHOP, { title: 'Draft', published: false }, db)
    const later = await pageService.create(SHOP, { title: 'Later' }, db)
    await db
      .update(pages)
      .set({ publishedAt: new Date(Date.now() + DAY) })
      .where(eq(pages.id, later.id))
    assert.deepEqual(
      (await pageService.listPublished(SHOP, { limit: 10, offset: 0 }, db)).map((p) => p.id),
      [live.id],
    )
    assert.equal((await pageService.getPublishedByHandle(SHOP, live.handle, db))?.id, live.id)
    assert.equal(await pageService.getPublishedByHandle(SHOP, later.handle, db), null)
    assert.equal(await pageService.getPublishedByHandle(OTHER_SHOP, live.handle, db), null)
  })

  test('the published list pages through, oldest first', async () => {
    const made = []
    for (let i = 0; i < 3; i++) {
      const p = await pageService.create(SHOP, { title: `Paged ${String(i)}` }, db)
      await db
        .update(pages)
        .set({ createdAt: new Date(2026, 0, i + 1) })
        .where(eq(pages.id, p.id))
      made.push(p.id)
    }
    assert.deepEqual(
      (await pageService.listPublished(SHOP, { limit: 2, offset: 0 }, db)).map((p) => p.id),
      made.slice(0, 2),
    )
    assert.deepEqual(
      (await pageService.listPublished(SHOP, { limit: 2, offset: 2 }, db)).map((p) => p.id),
      made.slice(2),
    )
  })
})

describe('removing a page', () => {
  test('returns the page; another shop’s, or a second time, is null', async () => {
    const p = await pageService.create(SHOP, { title: 'Bye' }, db)
    assert.equal(await pageService.remove(OTHER_SHOP, p.id, db), null)
    assert.equal((await pageService.remove(SHOP, p.id, db))?.id, p.id)
    assert.equal(await pageService.remove(SHOP, p.id, db), null)
    assert.equal(await pageService.getById(SHOP, p.id, db), null)
  })

  test('removing many deletes only this shop’s pages and counts them', async () => {
    const a = await pageService.create(SHOP, { title: 'A bulk' }, db)
    const b = await pageService.create(SHOP, { title: 'B bulk' }, db)
    assert.equal(await pageService.removeMany(OTHER_SHOP, [a.id, b.id], db), 0)
    assert.equal(await pageService.removeMany(SHOP, [a.id, b.id], db), 2)
    assert.equal(await pageService.getById(SHOP, a.id, db), null)
    assert.equal(await pageService.removeMany(SHOP, [], db), 0)
  })
})
