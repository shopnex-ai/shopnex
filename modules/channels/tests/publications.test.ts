// What is published where: setting the list exactly, keeping dates, schedules that are not live yet, auto-publish for new things.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { resourcePublications } from '../src/channels.schema'
import { channels } from '../src/channels.schema'

const { db, products, SHOP, OTHER_SHOP } = fx
const { channelService, publicationService, ChannelError } = await import('../src')

const refused = (code: string) => (e: unknown) => e instanceof ChannelError && e.code === code
const HOUR = 3600_000
const rows = (id: string) => db.select().from(resourcePublications).where(fx.eq(resourcePublications.resourceId, id))

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('set', () => {
  test('publishes on exactly the channels given, now when no date is given', async () => {
    const p = await fx.product()
    const a = await fx.channel()
    const b = await fx.channel()
    const before = Date.now()
    await publicationService.set(SHOP, 'product', p.id, [{ channelId: a.id }, { channelId: b.id }], db)
    const published = await rows(p.id)
    assert.deepEqual(published.map((r) => r.channelId).sort(), [a.id, b.id].sort())
    for (const r of published)
      assert.ok(r.publishedAt.getTime() >= before - 1000 && r.publishedAt.getTime() <= Date.now() + 1000)
  })

  test('a channel left out is unpublished', async () => {
    const p = await fx.product()
    const a = await fx.channel()
    const b = await fx.channel()
    await publicationService.set(SHOP, 'product', p.id, [{ channelId: a.id }, { channelId: b.id }], db)
    await publicationService.set(SHOP, 'product', p.id, [{ channelId: b.id }], db)
    assert.deepEqual(
      (await rows(p.id)).map((r) => r.channelId),
      [b.id],
    )
    await publicationService.set(SHOP, 'product', p.id, [], db)
    assert.equal((await rows(p.id)).length, 0)
  })

  test('saving the same list again keeps each channel’s date; a given date changes it', async () => {
    const p = await fx.product()
    const a = await fx.channel()
    const date = new Date('2030-01-01T00:00:00Z')
    await publicationService.set(SHOP, 'product', p.id, [{ channelId: a.id, publishAt: date }], db)
    await publicationService.set(SHOP, 'product', p.id, [{ channelId: a.id }], db)
    assert.equal((await rows(p.id))[0]!.publishedAt.getTime(), date.getTime(), 'the schedule survives a save')
    const later = new Date('2031-06-01T00:00:00Z')
    await publicationService.set(SHOP, 'product', p.id, [{ channelId: a.id, publishAt: later }], db)
    assert.equal((await rows(p.id))[0]!.publishedAt.getTime(), later.getTime())
  })

  test('a channel that is not the shop’s is refused and nothing at all is written', async () => {
    const p = await fx.product()
    const mine = await fx.channel()
    const [theirs] = await db
      .insert(channels)
      .values({ shopId: OTHER_SHOP, handle: 'theirs', name: 'Theirs' })
      .returning()
    await assert.rejects(
      publicationService.set(SHOP, 'product', p.id, [{ channelId: mine.id }, { channelId: theirs!.id }], db),
      refused('CHANNEL_NOT_FOUND'),
    )
    assert.equal((await rows(p.id)).length, 0)
  })

  test('works inside the caller’s transaction, and is undone with it', async () => {
    const p = await fx.product()
    const a = await fx.channel()
    await assert.rejects(
      db.transaction(async (tx) => {
        await publicationService.set(SHOP, 'product', p.id, [{ channelId: a.id }], tx)
        throw new Error('rolled back')
      }),
      /rolled back/,
    )
    assert.equal((await rows(p.id)).length, 0)
  })
})

describe('what is live', () => {
  test('a scheduled date in the future is listed but not live; a past or present one is live', async () => {
    const p = await fx.product()
    const now = await fx.channel()
    const later = await fx.channel()
    await publicationService.set(
      SHOP,
      'product',
      p.id,
      [{ channelId: now.id }, { channelId: later.id, publishAt: new Date(Date.now() + HOUR) }],
      db,
    )
    const listed = (await publicationService.listFor(SHOP, 'product', [p.id], db)).get(p.id)!
    assert.deepEqual(listed.map((x) => x.channelId).sort(), [now.id, later.id].sort(), 'scheduled ones are listed')
    assert.equal(await publicationService.isLive(SHOP, now.id, 'product', p.id, db), true)
    assert.equal(await publicationService.isLive(SHOP, later.id, 'product', p.id, db), false)
    assert.deepEqual([...(await publicationService.liveIds(SHOP, later.id, 'product', [p.id], db))], [])
  })

  test('listFor answers an empty list for a resource with none, and nothing for no ids', async () => {
    const p = await fx.product()
    assert.deepEqual((await publicationService.listFor(SHOP, 'product', [p.id], db)).get(p.id), [])
    assert.equal((await publicationService.listFor(SHOP, 'product', [], db)).size, 0)
    assert.equal((await publicationService.liveIds(SHOP, 'x', 'product', [], db)).size, 0)
  })

  test('liveOn narrows a query on the resource table to what is on the channel now', async () => {
    const live = await fx.product()
    const scheduled = await fx.product()
    const never = await fx.product()
    const ch = await fx.channel()
    await publicationService.set(SHOP, 'product', live.id, [{ channelId: ch.id }], db)
    await publicationService.set(
      SHOP,
      'product',
      scheduled.id,
      [{ channelId: ch.id, publishAt: new Date(Date.now() + HOUR) }],
      db,
    )
    const found = await db
      .select({ id: products.id })
      .from(products)
      .where(publicationService.liveOn('product', ch.id, products.id))
    const ids = found.map((r) => r.id)
    assert.ok(ids.includes(live.id))
    assert.ok(!ids.includes(scheduled.id))
    assert.ok(!ids.includes(never.id))
  })

  test('a resource type is its own: a product id published as a collection is not a product', async () => {
    const p = await fx.product()
    const ch = await fx.channel()
    await publicationService.set(SHOP, 'collection', p.id, [{ channelId: ch.id }], db)
    assert.equal(await publicationService.isLive(SHOP, ch.id, 'product', p.id, db), false)
    assert.equal(await publicationService.isLive(SHOP, ch.id, 'collection', p.id, db), true)
  })
})

describe('auto-publish and delete', () => {
  test('a new resource goes onto the channels that want new resources, and only those', async () => {
    const p = await fx.product()
    const store = await channelService.getDefault(SHOP, db)
    const auto = await fx.channel({ autoPublish: true })
    const manual = await fx.channel({ autoPublish: false })
    await publicationService.autoPublish(SHOP, 'product', p.id, db)
    const on = (await rows(p.id)).map((r) => r.channelId).sort()
    assert.deepEqual(on, [store.id, auto.id].sort())
    assert.ok(!on.includes(manual.id))
    await publicationService.autoPublish(SHOP, 'product', p.id, db)
    assert.equal((await rows(p.id)).length, 2, 'twice is still once')
  })

  test('removeFor takes the resources off every channel, in this shop only', async () => {
    const a = await fx.product()
    const b = await fx.product()
    const ch = await fx.channel()
    await publicationService.set(SHOP, 'product', a.id, [{ channelId: ch.id }], db)
    await publicationService.set(SHOP, 'product', b.id, [{ channelId: ch.id }], db)
    await publicationService.removeFor(OTHER_SHOP, 'product', [a.id], db)
    assert.equal((await rows(a.id)).length, 1, 'another shop cannot remove them')
    await publicationService.removeFor(SHOP, 'product', [a.id], db)
    assert.equal((await rows(a.id)).length, 0)
    assert.equal((await rows(b.id)).length, 1)
    await publicationService.removeFor(SHOP, 'product', [], db)
  })
})
