// API tokens (what is stored, how one is recognised, revoking, the hook other modules listen to) and storefront publishable keys.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'

// Set before the modules load: they read these when first imported
delete process.env.TENANCY_MODE
const fx = await import('./fixtures')

const { db, schema, eq } = fx
const tenancy = await import('../src')
// Used by the resolvers, not part of the package's public API
const { getShopByStorefrontKey } = await import('../src/keys')
const { ChannelError } = await import('@shopnex/channels')

let SHOP = ''

before(async () => {
  await fx.prepareDatabase()
})
beforeEach(async () => {
  await fx.cleanup()
  SHOP = (await fx.shop()).id
})
after(fx.cleanup)

describe('scopes', () => {
  test('write access includes read access of the same resource, and not the other way round', () => {
    assert.equal(tenancy.hasScope(['write_orders'], 'read_orders'), true)
    assert.equal(tenancy.hasScope(['read_orders'], 'write_orders'), false)
    assert.equal(tenancy.hasScope(['read_orders'], 'read_orders'), true)
    assert.equal(tenancy.hasScope(['write_products'], 'read_orders'), false)
    assert.equal(tenancy.hasScope([], 'read_orders'), false)
  })

  test('normalizing drops a read scope that a write scope already covers, keeps the canonical order and drops repeats', () => {
    const normalized = tenancy.normalizeScopes(['write_orders', 'read_orders', 'read_products', 'read_products'])
    assert.deepEqual(
      normalized.filter((s) => s.endsWith('_orders')),
      ['write_orders'],
    )
    assert.deepEqual(
      normalized.filter((s) => s.endsWith('_products')),
      ['read_products'],
    )
    assert.deepEqual(
      normalized,
      tenancy.API_SCOPES.filter((s) => normalized.includes(s)),
      'in the order of API_SCOPES',
    )
  })
})

describe('minting and creating', () => {
  test('a token is sk_ and 32 random bytes, kept as a 64-character hash and a short prefix to recognise it', () => {
    const a = tenancy.mintToken()
    assert.match(a.token, /^sk_[A-Za-z0-9_-]{43}$/)
    assert.match(a.tokenHash, /^[0-9a-f]{64}$/)
    assert.notEqual(a.tokenHash, a.token)
    assert.notEqual(a.tokenHash, tenancy.mintToken().tokenHash)
    assert.equal(a.tokenPrefix, a.token.slice(0, 9))
    assert.notEqual(a.token, tenancy.mintToken().token)
  })

  test('createApiToken shows the token once, stores only its hash, and normalizes the scopes', async () => {
    const creator = await fx.user()
    const made = await tenancy.createApiToken(SHOP, {
      name: 'Importer',
      scopes: ['write_orders', 'read_orders'],
      createdById: creator.id,
    })
    assert.match(made.token, /^sk_/)
    assert.ok(!('tokenHash' in made))
    assert.deepEqual(made.scopes, ['write_orders'])
    assert.equal(made.createdById, creator.id)
    const [stored] = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, made.id))
    assert.match(stored?.tokenHash ?? '', /^[0-9a-f]{64}$/)
    assert.ok(![stored?.tokenHash, stored?.tokenPrefix].includes(made.token))
    // The stored value is derived from the token that was shown: that token finds this row
    assert.equal((await tenancy.resolveApiToken(made.token))?.token.id, made.id)
  })

  test('listApiTokens: this shop’s hand-made tokens, newest first, never the hash, never an app’s', async () => {
    const other = await fx.shop()
    const first = await tenancy.createApiToken(SHOP, { name: 'One', scopes: [], createdById: null })
    await new Promise((r) => setTimeout(r, 5))
    const second = await tenancy.createApiToken(SHOP, { name: 'Two', scopes: [], createdById: null })
    await tenancy.createApiToken(other.id, { name: 'Elsewhere', scopes: [], createdById: null })
    const [app] = await db
      .insert(schema.apps)
      .values({
        name: 'An app',
        appUrl: 'http://127.0.0.1:1',
        redirectUrls: [],
        scopes: [],
        clientId: `tk-${fx.unique()}`,
      })
      .returning()
    const appToken = tenancy.mintToken()
    await db.insert(schema.apiTokens).values({
      shopId: SHOP,
      name: 'App token',
      scopes: [],
      appId: app!.id,
      ...{ tokenHash: appToken.tokenHash, tokenPrefix: appToken.tokenPrefix },
    })
    const listed = await tenancy.listApiTokens(SHOP)
    assert.deepEqual(
      listed.map((t) => t.id),
      [second.id, first.id],
    )
    for (const t of listed) assert.ok(!('tokenHash' in t))
    await db.delete(schema.apps).where(eq(schema.apps.id, app!.id))
  })
})

describe('recognising a token', () => {
  test('a live token gives its shop and its row, and notes that it was used', async () => {
    const made = await tenancy.createApiToken(SHOP, { name: 'Live', scopes: ['read_products'], createdById: null })
    const found = await tenancy.resolveApiToken(made.token)
    assert.equal(found?.shop.id, SHOP)
    assert.equal(found?.token.id, made.id)
    let used: Date | null = null
    for (let i = 0; i < 20 && !used; i++) {
      await new Promise((r) => setTimeout(r, 25))
      used = (await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, made.id)))[0]!.lastUsedAt
    }
    assert.ok(used, 'lastUsedAt is written, without the request waiting for it')
  })

  test('nothing else is a token: wrong prefix, unknown, or revoked', async () => {
    const made = await tenancy.createApiToken(SHOP, { name: 'Soon gone', scopes: [], createdById: null })
    assert.equal(await tenancy.resolveApiToken('pk_looks-like-a-key'), null)
    assert.equal(await tenancy.resolveApiToken('sk_never-issued'), null)
    assert.equal(await tenancy.resolveApiToken(''), null)
    await tenancy.revokeApiToken(SHOP, made.id)
    assert.equal(await tenancy.resolveApiToken(made.token), null)
  })
})

describe('revoking', () => {
  test('stamps it revoked and answers the token without its hash; the second time and another shop get null', async () => {
    const made = await tenancy.createApiToken(SHOP, { name: 'Revoke me', scopes: [], createdById: null })
    const other = await fx.shop()
    assert.equal(await tenancy.revokeApiToken(other.id, made.id), null)
    const revoked = await tenancy.revokeApiToken(SHOP, made.id)
    assert.ok(revoked?.revokedAt)
    assert.ok(!('tokenHash' in revoked!))
    assert.equal(await tenancy.revokeApiToken(SHOP, made.id), null)
  })

  test('a token made by an app is not revoked by hand; the app’s uninstall revokes it by id', async () => {
    const [app] = await db
      .insert(schema.apps)
      .values({
        name: 'An app',
        appUrl: 'http://127.0.0.1:1',
        redirectUrls: [],
        scopes: [],
        clientId: `tk-${fx.unique()}`,
      })
      .returning()
    const t = tenancy.mintToken()
    const [row] = await db
      .insert(schema.apiTokens)
      .values({
        shopId: SHOP,
        name: 'App token',
        scopes: [],
        appId: app!.id,
        tokenHash: t.tokenHash,
        tokenPrefix: t.tokenPrefix,
      })
      .returning()
    assert.equal(await tenancy.revokeApiToken(SHOP, row!.id), null)
    assert.ok(await tenancy.revokeTokenById(SHOP, row!.id))
    await db.delete(schema.apps).where(eq(schema.apps.id, app!.id))
  })

  test('tells the listeners of apiTokenRevoked inside the revoking transaction, and a listener that fails undoes the revoke', async () => {
    const seen: unknown[] = []
    tenancy.apiTokenRevoked.on('test.records', (_conn, payload) => void seen.push(payload))
    const ok = await tenancy.createApiToken(SHOP, { name: 'Heard', scopes: [], createdById: null })
    await tenancy.revokeApiToken(SHOP, ok.id)
    assert.deepEqual(seen, [{ shopId: SHOP, tokenId: ok.id }])

    const kept = await tenancy.createApiToken(SHOP, { name: 'Kept', scopes: [], createdById: null })
    tenancy.apiTokenRevoked.on('test.fails', () => {
      throw new Error('cleanup failed')
    })
    try {
      await assert.rejects(tenancy.revokeApiToken(SHOP, kept.id), /cleanup failed/)
    } finally {
      tenancy.apiTokenRevoked.on('test.fails', () => undefined)
      tenancy.apiTokenRevoked.on('test.records', () => undefined)
    }
    assert.ok(await tenancy.resolveApiToken(kept.token), 'still a live token')
  })
})

describe('storefront keys', () => {
  test('a key is pk_ and random, reads the Online Store unless a channel is named, and lists newest first', async () => {
    const key = await tenancy.createStorefrontKey(SHOP, 'Web')
    assert.match(key.token, /^pk_[A-Za-z0-9_-]{32}$/)
    const store = (await db.select().from(schema.channels).where(eq(schema.channels.shopId, SHOP))).find(
      (c) => c.handle === 'online-store',
    )
    assert.equal(key.channelId, store?.id)
    const [channel] = await db.insert(schema.channels).values({ shopId: SHOP, handle: 'app', name: 'App' }).returning()
    await new Promise((r) => setTimeout(r, 5))
    const second = await tenancy.createStorefrontKey(SHOP, 'App', channel!.id)
    assert.equal(second.channelId, channel!.id)
    assert.deepEqual(
      (await tenancy.listStorefrontKeys(SHOP)).map((k) => k.id),
      [second.id, key.id],
    )
  })

  test('a channel that is not the shop’s is refused, and no key is made', async () => {
    const other = await fx.shop()
    const [theirs] = await db
      .insert(schema.channels)
      .values({ shopId: other.id, handle: 'theirs', name: 'Theirs' })
      .returning()
    await assert.rejects(
      tenancy.createStorefrontKey(SHOP, 'Sneaky', theirs!.id),
      (e: unknown) => e instanceof ChannelError && e.code === 'CHANNEL_NOT_FOUND',
    )
    assert.equal((await tenancy.listStorefrontKeys(SHOP)).length, 0)
  })

  test('revoking stamps the key once, in its own shop only; a revoked key no longer finds a shop', async () => {
    const key = await tenancy.createStorefrontKey(SHOP, 'Web')
    assert.equal((await getShopByStorefrontKey(key.token))?.shop.id, SHOP)
    assert.equal(await getShopByStorefrontKey('pk_unknown'), null)
    const other = await fx.shop()
    assert.equal(await tenancy.revokeStorefrontKey(other.id, key.id), null)
    assert.ok((await tenancy.revokeStorefrontKey(SHOP, key.id))?.revokedAt)
    assert.equal(await tenancy.revokeStorefrontKey(SHOP, key.id), null)
    assert.equal(await getShopByStorefrontKey(key.token), null)
  })
})
