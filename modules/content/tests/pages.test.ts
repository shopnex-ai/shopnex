// Pages: handles (made from the title or chosen, once per shop), publishing and scheduling, sanitized bodies, and what the storefront sees.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { pages } from '../src/content.schema'

const { db, eq, content, SHOP, OTHER_SHOP } = fx
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
    const a = await content.pages.create(SHOP, { title: 'About Us!' })
    const b = await content.pages.create(SHOP, { title: 'About Us!' })
    const c = await content.pages.create(SHOP, { title: 'About Us!' })
    assert.deepEqual([a.handle, b.handle, c.handle], ['about-us', 'about-us-2', 'about-us-3'])
    assert.equal(
      (await content.pages.create(SHOP, { title: '!!!' })).handle,
      'page',
      'a title with nothing to make a handle from',
    )
  })

  test('a handle that is chosen is used as given, once per shop', async () => {
    await content.pages.create(SHOP, { title: 'Shipping', handle: 'delivery' })
    await assert.rejects(content.pages.create(SHOP, { title: 'Other', handle: 'delivery' }), taken)
    await content.pages.create(OTHER_SHOP, { title: 'Shipping', handle: 'delivery' })
  })

  test('it is published now unless said otherwise, and the body is sanitized', async () => {
    const before = Date.now()
    const live = await content.pages.create(SHOP, { title: 'Live', bodyHtml: '<p>Hi</p><script>alert(1)</script>' })
    assert.ok(live.publishedAt && live.publishedAt.getTime() >= before - 1000)
    assert.ok(!/script/i.test(live.bodyHtml))
    assert.ok(live.bodyHtml.includes('<p>Hi</p>'))
    const draft = await content.pages.create(SHOP, { title: 'Draft', published: false })
    assert.equal(draft.publishedAt, null)
  })

  test('the search engine title and description are kept', async () => {
    const p = await content.pages.create(SHOP, { title: 'FAQ', seo: { title: 'Questions', description: 'Answers' } })
    assert.deepEqual([p.seoTitle, p.seoDescription], ['Questions', 'Answers'])
  })
})

describe('updating a page', () => {
  test('changes only what is given; another shop’s page or an unknown one is null', async () => {
    const p = await content.pages.create(SHOP, { title: 'Old', bodyHtml: '<p>keep</p>' })
    const changed = await content.pages.update(SHOP, p.id, { title: 'New' })
    assert.deepEqual([changed?.title, changed?.bodyHtml, changed?.handle], ['New', '<p>keep</p>', p.handle])
    assert.ok(changed!.updatedAt.getTime() >= p.updatedAt.getTime())
    assert.equal(await content.pages.update(OTHER_SHOP, p.id, { title: 'No' }), null)
    assert.equal(await content.pages.update(SHOP, '00000000-0000-4000-8000-000000000000', { title: 'No' }), null)
  })

  test('a handle can be kept or changed, but not to another page’s', async () => {
    const [a, b] = [
      await content.pages.create(SHOP, { title: 'One' }),
      await content.pages.create(SHOP, { title: 'Two' }),
    ]
    assert.equal((await content.pages.update(SHOP, a.id, { handle: a.handle }))?.handle, a.handle)
    assert.equal((await content.pages.update(SHOP, a.id, { handle: 'renamed' }))?.handle, 'renamed')
    await assert.rejects(content.pages.update(SHOP, b.id, { handle: 'renamed' }), taken)
  })

  test('unpublishing clears the date; publishing again sets one, and publishing a live page keeps its date', async () => {
    const p = await content.pages.create(SHOP, { title: 'Toggle' })
    const kept = await content.pages.update(SHOP, p.id, { published: true })
    assert.equal(kept?.publishedAt?.getTime(), p.publishedAt?.getTime(), 'a live page keeps its date')
    assert.equal((await content.pages.update(SHOP, p.id, { published: false }))?.publishedAt, null)
    assert.ok((await content.pages.update(SHOP, p.id, { published: true }))?.publishedAt)
    const untouched = await content.pages.update(SHOP, p.id, { title: 'Still live' })
    assert.ok(untouched?.publishedAt, 'an update that does not mention publishing leaves it')
  })

  test('the body is sanitized on update too', async () => {
    const p = await content.pages.create(SHOP, { title: 'Body' })
    const changed = await content.pages.update(SHOP, p.id, { bodyHtml: '<img src=x onerror=alert(1)><p>ok</p>' })
    assert.ok(!/onerror/i.test(changed!.bodyHtml))
  })
})

describe('reading pages', () => {
  test('the admin sees every page of the shop, oldest first, and only its own', async () => {
    const [a, b] = [
      await content.pages.create(SHOP, { title: 'First' }),
      await content.pages.create(SHOP, { title: 'Second', published: false }),
    ]
    await db
      .update(pages)
      .set({ createdAt: new Date('2026-01-01') })
      .where(eq(pages.id, a.id))
    await db
      .update(pages)
      .set({ createdAt: new Date('2026-01-02') })
      .where(eq(pages.id, b.id))
    await content.pages.create(OTHER_SHOP, { title: 'Elsewhere' })
    assert.deepEqual(
      (await content.pages.list(SHOP)).map((p) => p.id),
      [a.id, b.id],
    )
    assert.equal((await content.pages.getById(SHOP, a.id))?.id, a.id)
    assert.equal(await content.pages.getById(OTHER_SHOP, a.id), null)
  })

  test('the storefront sees published pages only: not drafts, and not ones scheduled for later', async () => {
    const live = await content.pages.create(SHOP, { title: 'Live' })
    await content.pages.create(SHOP, { title: 'Draft', published: false })
    const later = await content.pages.create(SHOP, { title: 'Later' })
    await db
      .update(pages)
      .set({ publishedAt: new Date(Date.now() + DAY) })
      .where(eq(pages.id, later.id))
    assert.deepEqual(
      (await content.pages.listPublished(SHOP, { limit: 10, offset: 0 })).map((p) => p.id),
      [live.id],
    )
    assert.equal((await content.pages.getPublishedByHandle(SHOP, live.handle))?.id, live.id)
    assert.equal(await content.pages.getPublishedByHandle(SHOP, later.handle), null)
    assert.equal(await content.pages.getPublishedByHandle(OTHER_SHOP, live.handle), null)
  })

  test('the published list pages through, oldest first', async () => {
    const made = []
    for (let i = 0; i < 3; i++) {
      const p = await content.pages.create(SHOP, { title: `Paged ${String(i)}` })
      await db
        .update(pages)
        .set({ createdAt: new Date(2026, 0, i + 1) })
        .where(eq(pages.id, p.id))
      made.push(p.id)
    }
    assert.deepEqual(
      (await content.pages.listPublished(SHOP, { limit: 2, offset: 0 })).map((p) => p.id),
      made.slice(0, 2),
    )
    assert.deepEqual(
      (await content.pages.listPublished(SHOP, { limit: 2, offset: 2 })).map((p) => p.id),
      made.slice(2),
    )
  })
})

describe('removing a page', () => {
  test('returns the page; another shop’s, or a second time, is null', async () => {
    const p = await content.pages.create(SHOP, { title: 'Bye' })
    assert.equal(await content.pages.remove(OTHER_SHOP, p.id), null)
    assert.equal((await content.pages.remove(SHOP, p.id))?.id, p.id)
    assert.equal(await content.pages.remove(SHOP, p.id), null)
    assert.equal(await content.pages.getById(SHOP, p.id), null)
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
