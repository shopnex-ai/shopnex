// Sales channels: the Online Store that exists from first use, handles, what cannot be deleted, and which channel a request means.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { storefrontKeys } from '../src/channels.schema'

const { db, schema, SHOP, OTHER_SHOP } = fx
const { channelService, DEFAULT_CHANNEL_HANDLE, ChannelError } = await import('../src')
const { isForeignKeyViolation } = await import('../src/channels')

const refused = (code: string) => (e: unknown) => e instanceof ChannelError && e.code === code

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('telling a foreign key violation from other errors', () => {
  const violation = (constraint: string) => Object.assign(new Error('violates'), { code: '23503', constraint })
  test('the one the orders table raises, bare or wrapped by the driver, and nothing else', () => {
    assert.equal(isForeignKeyViolation(violation('orders_channel_id_channels_id_fk'), 'orders_'), true)
    assert.equal(
      isForeignKeyViolation(new Error('wrapped', { cause: violation('orders_channel_id_channels_id_fk') }), 'orders_'),
      true,
    )
    assert.equal(
      isForeignKeyViolation(violation('carts_channel_id_channels_id_fk'), 'orders_'),
      false,
      'another table’s constraint',
    )
    assert.equal(
      isForeignKeyViolation(Object.assign(new Error('x'), { code: '23505', constraint: 'orders_x' }), 'orders_'),
      false,
    )
    assert.equal(isForeignKeyViolation(new Error('plain'), 'orders_'), false)
    assert.equal(isForeignKeyViolation(undefined, 'orders_'), false)
  })
})

describe('the Online Store', () => {
  test('is made on first use, with auto-publish on, and is the same one every time', async () => {
    assert.equal(DEFAULT_CHANNEL_HANDLE, 'online-store')
    const first = await channelService.getDefault(SHOP, db)
    assert.equal(first.handle, 'online-store')
    assert.equal(first.name, 'Online Store')
    assert.equal(first.type, 'online_store')
    assert.equal(first.autoPublish, true)
    const again = await channelService.getDefault(SHOP, db)
    assert.equal(again.id, first.id)
    assert.equal((await db.select().from(schema.channels)).filter((c) => c.shopId === SHOP).length, 1)
  })

  test('concurrent first uses still make one', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => channelService.getDefault(SHOP, db)))
    assert.equal(new Set(ids.map((c) => c.id)).size, 1)
  })

  test('each shop has its own', async () => {
    const mine = await channelService.getDefault(SHOP, db)
    const theirs = await channelService.getDefault(OTHER_SHOP, db)
    assert.notEqual(mine.id, theirs.id)
    assert.equal(theirs.shopId, OTHER_SHOP)
  })
})

describe('list and read', () => {
  test('the Online Store comes first, then the others oldest first', async () => {
    const a = await fx.channel({ handle: 'aaa-first', createdAt: new Date('2026-01-01') })
    const b = await fx.channel({ handle: 'bbb-second', createdAt: new Date('2026-01-02') })
    const store = await channelService.getDefault(SHOP, db)
    assert.deepEqual(
      (await channelService.list(SHOP, db)).map((c) => c.id),
      [store.id, a.id, b.id],
    )
  })

  test('getById is scoped to the shop', async () => {
    const mine = await fx.channel()
    assert.equal((await channelService.getById(SHOP, mine.id, db))?.id, mine.id)
    assert.equal(await channelService.getById(OTHER_SHOP, mine.id, db), null)
    assert.equal(await channelService.getById(SHOP, '00000000-0000-4000-8000-000000000000', db), null)
  })

  test('resolve: none means the Online Store; one that is not the shop’s is refused', async () => {
    const store = await channelService.getDefault(SHOP, db)
    assert.equal((await channelService.resolve(SHOP, undefined, db)).id, store.id)
    const mine = await fx.channel()
    assert.equal((await channelService.resolve(SHOP, mine.id, db)).id, mine.id)
    await assert.rejects(channelService.resolve(OTHER_SHOP, mine.id, db), refused('CHANNEL_NOT_FOUND'))
  })
})

describe('create and update', () => {
  test('the handle comes from the name: accents dropped, other characters become one hyphen, trimmed', async () => {
    const c = await channelService.create(SHOP, { name: '  Café — Ünïcode & Co!!  ' }, db)
    assert.equal(c.handle, 'cafe-unicode-co')
    assert.equal(c.name, '  Café — Ünïcode & Co!!  ')
    assert.equal((await channelService.create(SHOP, { name: '!!!' }, db)).handle, 'channel')
  })

  test('a channel is headless and does not auto-publish unless said otherwise', async () => {
    const plain = await channelService.create(SHOP, { name: 'Mobile app' }, db)
    assert.equal(plain.type, 'headless')
    assert.equal(plain.autoPublish, false)
    const custom = await channelService.create(
      SHOP,
      { name: 'POS', handle: 'pos', type: 'online_store', autoPublish: true },
      db,
    )
    assert.deepEqual([custom.handle, custom.type, custom.autoPublish], ['pos', 'online_store', true])
  })

  test('a handle is used once per shop, and online-store is never free to take', async () => {
    await channelService.create(SHOP, { name: 'App', handle: 'app' }, db)
    await assert.rejects(channelService.create(SHOP, { name: 'Another', handle: 'app' }, db), refused('HANDLE_TAKEN'))
    await assert.rejects(channelService.create(SHOP, { name: 'Online Store' }, db), refused('HANDLE_TAKEN'))
    await assert.rejects(
      channelService.create(OTHER_SHOP, { name: 'x', handle: 'online-store' }, db),
      refused('HANDLE_TAKEN'),
    )
    await channelService.create(OTHER_SHOP, { name: 'App', handle: 'app' }, db)
  })

  test('update changes the name and auto-publish only, within the shop', async () => {
    const c = await fx.channel({ handle: 'keep-handle' })
    const changed = await channelService.update(SHOP, c.id, { name: 'Renamed', autoPublish: true }, db)
    assert.deepEqual([changed?.name, changed?.autoPublish, changed?.handle], ['Renamed', true, 'keep-handle'])
    assert.equal((await channelService.update(SHOP, c.id, {}, db))?.name, 'Renamed', 'an empty patch reads it back')
    assert.equal(await channelService.update(OTHER_SHOP, c.id, { name: 'No' }, db), null)
    assert.equal((await channelService.getById(SHOP, c.id, db))?.name, 'Renamed')
  })
})

describe('remove', () => {
  test('the Online Store cannot be deleted', async () => {
    const store = await channelService.getDefault(SHOP, db)
    await assert.rejects(channelService.remove(SHOP, store.id, db), refused('CHANNEL_PROTECTED'))
    assert.ok(await channelService.getById(SHOP, store.id, db))
  })

  test('a channel with an order or with an active storefront key cannot be deleted', async () => {
    const withOrder = await fx.channel()
    await fx.orderOn(withOrder.id)
    await assert.rejects(channelService.remove(SHOP, withOrder.id, db), refused('CHANNEL_IN_USE'))
    const withKey = await fx.channel()
    await fx.storefrontKey(withKey.id)
    await assert.rejects(channelService.remove(SHOP, withKey.id, db), refused('CHANNEL_IN_USE'))
    assert.ok(await channelService.getById(SHOP, withOrder.id, db))
    assert.ok(await channelService.getById(SHOP, withKey.id, db))
  })

  test('an unused channel goes, with its revoked keys; it is returned', async () => {
    const c = await fx.channel()
    await fx.storefrontKey(c.id, true)
    const removed = await channelService.remove(SHOP, c.id, db)
    assert.equal(removed?.id, c.id)
    assert.equal(await channelService.getById(SHOP, c.id, db), null)
    const keys = await db.select().from(storefrontKeys).where(fx.eq(storefrontKeys.channelId, c.id))
    assert.equal(keys.length, 0)
  })

  test('works inside a transaction the caller opened', async () => {
    const c = await fx.channel()
    await db.transaction(async (tx) => {
      await channelService.remove(SHOP, c.id, tx)
    })
    assert.equal(await channelService.getById(SHOP, c.id, db), null)
  })

  test('another shop’s channel, or one that does not exist, is null and left alone', async () => {
    const c = await fx.channel()
    assert.equal(await channelService.remove(OTHER_SHOP, c.id, db), null)
    assert.equal(await channelService.remove(SHOP, '00000000-0000-4000-8000-000000000000', db), null)
    assert.ok(await channelService.getById(SHOP, c.id, db))
  })
})
