// API tokens (what is stored, how one is recognised, revoking, which takes the token's webhook subscriptions with it).
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { apiTokens, apps } from '@shopnex/core/schema'

// Set before the modules load: they read these when first imported
delete process.env.TENANCY_MODE
const fx = await import('./fixtures')

const { db, eq } = fx
const { inArray } = await import('drizzle-orm')
const { webhookDeliveries, webhookEndpoints } = await import('@shopnex/webhooks/schema')
const tenancy = await import('../src')

let SHOP = ''

before(async () => {
  await fx.prepareDatabase()
})
beforeEach(async () => {
  await fx.cleanup()
  SHOP = (await fx.shop()).id
})
after(fx.cleanup)

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
    const [stored] = await db.select().from(apiTokens).where(eq(apiTokens.id, made.id))
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
      .insert(apps)
      .values({
        name: 'An app',
        appUrl: 'http://127.0.0.1:1',
        redirectUrls: [],
        scopes: [],
        clientId: `tk-${fx.unique()}`,
      })
      .returning()
    const appToken = tenancy.mintToken()
    await db.insert(apiTokens).values({
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
    await db.delete(apps).where(eq(apps.id, app!.id))
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
      used = (await db.select().from(apiTokens).where(eq(apiTokens.id, made.id)))[0]!.lastUsedAt
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
      .insert(apps)
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
      .insert(apiTokens)
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
    await db.delete(apps).where(eq(apps.id, app!.id))
  })

  test('takes the subscriptions the token made with it, with their deliveries, and leaves other tokens’ and staff-made ones', async () => {
    const [gone, stays] = [
      await tenancy.createApiToken(SHOP, { name: 'Gone', scopes: [], createdById: null }),
      await tenancy.createApiToken(SHOP, { name: 'Stays', scopes: [], createdById: null }),
    ]
    const endpoint = async (apiTokenId: string | null) =>
      (
        await db
          .insert(webhookEndpoints)
          .values({
            shopId: SHOP,
            url: 'https://example.com/hook',
            topics: ['order.created'],
            secret: 'whsec_x',
            apiTokenId,
          })
          .returning()
      )[0]!
    const [mine, theirs, staffs] = [await endpoint(gone.id), await endpoint(stays.id), await endpoint(null)]
    await db.insert(webhookDeliveries).values({ shopId: SHOP, endpointId: mine.id, topic: 'order.created', body: '{}' })
    await tenancy.revokeApiToken(SHOP, gone.id)
    const left = (
      await db
        .select()
        .from(webhookEndpoints)
        .where(inArray(webhookEndpoints.id, [mine.id, theirs.id, staffs.id]))
    )
      .map((e) => e.id)
      .sort()
    assert.deepEqual(left, [theirs.id, staffs.id].sort())
    assert.equal((await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, mine.id))).length, 0)
    await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.id, [theirs.id, staffs.id]))
  })
})
