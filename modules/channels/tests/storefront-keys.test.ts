// Publishable keys: made for a channel, public, revocable, and how a key finds its shop and channel.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, SHOP, OTHER_SHOP } = fx
const { storefrontKeyService, ChannelError } = await import('../src')

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('storefront keys', () => {
  test('a key is pk_ and random, reads the Online Store unless a channel is named, and lists newest first', async () => {
    const key = await storefrontKeyService.create(SHOP, 'Web', undefined, db)
    assert.match(key.token, /^pk_[A-Za-z0-9_-]{32}$/)
    const store = (await db.select().from(schema.channels).where(fx.eq(schema.channels.shopId, SHOP))).find(
      (c) => c.handle === 'online-store',
    )
    assert.equal(key.channelId, store?.id)
    const [channel] = await db.insert(schema.channels).values({ shopId: SHOP, handle: 'app', name: 'App' }).returning()
    await new Promise((r) => setTimeout(r, 5))
    const second = await storefrontKeyService.create(SHOP, 'App', channel!.id, db)
    assert.equal(second.channelId, channel!.id)
    assert.deepEqual(
      (await storefrontKeyService.list(SHOP, db)).map((k) => k.id),
      [second.id, key.id],
    )
  })

  test('a channel that is not the shop’s is refused, and no key is made', async () => {
    const [theirs] = await db
      .insert(schema.channels)
      .values({ shopId: OTHER_SHOP, handle: 'theirs', name: 'Theirs' })
      .returning()
    await assert.rejects(
      storefrontKeyService.create(SHOP, 'Sneaky', theirs!.id, db),
      (e: unknown) => e instanceof ChannelError && e.code === 'CHANNEL_NOT_FOUND',
    )
    assert.equal((await storefrontKeyService.list(SHOP, db)).length, 0)
  })

  test('revoking stamps the key once, in its own shop only; a revoked key no longer finds a shop', async () => {
    const key = await storefrontKeyService.create(SHOP, 'Web', undefined, db)
    assert.equal((await storefrontKeyService.shopByKey(key.token, db))?.shop.id, SHOP)
    assert.equal(await storefrontKeyService.shopByKey('pk_unknown', db), null)
    assert.equal(await storefrontKeyService.revoke(OTHER_SHOP, key.id, db), null)
    assert.ok((await storefrontKeyService.revoke(SHOP, key.id, db))?.revokedAt)
    assert.equal(await storefrontKeyService.revoke(SHOP, key.id, db), null)
    assert.equal(await storefrontKeyService.shopByKey(key.token, db), null)
  })
})
