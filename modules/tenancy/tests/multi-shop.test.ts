// Multi-shop mode (TENANCY_MODE=multi, a root domain): which shop a host or an admin lands in, the shop switcher, and what a shop
// can no longer set itself. The mode is read when the package loads, so this runs in its own process.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shopDomains } from '../src/tenancy.schema'
import { shops } from '@shopnex/core/schema'

// Set before the modules load: they read these when first imported
process.env.TENANCY_MODE = 'multi'
process.env.ROOT_DOMAIN = 'shops.example.test'
process.env.APP_URL = 'https://admin.example.test'
delete process.env.STOREFRONT_URL
const fx = await import('./fixtures')

const { db, schema, eq } = fx
const tenancy = await import('../src')
const { storefrontKeyService } = await import('@shopnex/channels')

const hostHeaders = (host: string, extra: Record<string, string> = {}) => new Headers({ host, ...extra })

before(fx.prepareDatabase)
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('the mode', () => {
  test('is multi, with the root domain parsed', () => {
    assert.equal(tenancy.isMultiTenant, true)
    assert.equal(tenancy.TENANCY_MODE, 'multi')
    assert.equal(tenancy.ROOT_DOMAIN?.host, 'shops.example.test')
  })
})

describe('which shop a storefront host means', () => {
  test('<slug>.<root domain> is the shop with that slug, with or without a port, and its Online Store', async () => {
    const s = await fx.shop({ slug: 'acme' })
    for (const host of ['acme.shops.example.test', 'ACME.shops.example.test:4321']) {
      const found = await tenancy.resolveStorefrontShop(hostHeaders(host))
      assert.equal(found.ok && found.shop.id, s.id, host)
    }
    const channel = (await db.select().from(schema.channels).where(eq(schema.channels.shopId, s.id)))[0]
    const found = await tenancy.resolveStorefrontShop(hostHeaders('acme.shops.example.test'))
    assert.equal(found.ok && found.channelId, channel?.id)
  })

  test('x-forwarded-host wins over host (behind a proxy)', async () => {
    const s = await fx.shop({ slug: 'proxied' })
    const found = await tenancy.resolveStorefrontShop(
      hostHeaders('internal.local', { 'x-forwarded-host': 'proxied.shops.example.test' }),
    )
    assert.equal(found.ok && found.shop.id, s.id)
  })

  test('a verified custom domain is the shop; one that was never verified is not', async () => {
    const s = await fx.shop()
    await db
      .insert(shopDomains)
      .values({ id: `d-${fx.unique()}`, shopId: s.id, domain: 'www.mine.example.test', verifiedAt: new Date() })
    await db.insert(shopDomains).values({ id: `d-${fx.unique()}`, shopId: s.id, domain: 'pending.mine.example.test' })
    const found = await tenancy.resolveStorefrontShop(hostHeaders('www.mine.example.test'))
    assert.equal(found.ok && found.shop.id, s.id)
    assert.deepEqual(await tenancy.resolveStorefrontShop(hostHeaders('pending.mine.example.test')), {
      ok: false,
      reason: 'shop_not_found',
    })
  })

  test('an unknown host or slug is no shop; a publishable key beats the host', async () => {
    assert.deepEqual(await tenancy.resolveStorefrontShop(hostHeaders('nobody.shops.example.test')), {
      ok: false,
      reason: 'shop_not_found',
    })
    assert.deepEqual(await tenancy.resolveStorefrontShop(hostHeaders('random.example.org')), {
      ok: false,
      reason: 'shop_not_found',
    })
    const keyed = await fx.shop()
    const key = await storefrontKeyService.create(keyed.id, 'Web', undefined, db)
    const found = await tenancy.resolveStorefrontShop(
      hostHeaders('nobody.shops.example.test', { [tenancy.PUBLISHABLE_KEY_HEADER]: key.token }),
    )
    assert.equal(found.ok && found.shop.id, keyed.id)
  })
})

describe('the storefront URL of a shop', () => {
  test('is derived: the first verified domain, else <slug>.<root domain>; the saved column is ignored and cannot be set', async () => {
    const s = await fx.shop({ slug: 'derived', storefrontUrl: 'https://ignored.example.test' })
    assert.equal((await tenancy.updateShop(s.id, {}))?.storefrontUrl, 'https://derived.shops.example.test')
    const changed = await tenancy.updateShop(s.id, { name: 'Renamed', storefrontUrl: 'https://sneaky.example.test' })
    assert.equal(changed?.name, 'Renamed')
    assert.equal(changed?.storefrontUrl, 'https://derived.shops.example.test')
    const [stored] = await db.select({ url: shops.storefrontUrl }).from(shops).where(eq(shops.id, s.id))
    assert.equal(stored?.url, 'https://ignored.example.test', 'what was sent is not saved either')
    await db
      .insert(shopDomains)
      .values({ id: `d-${fx.unique()}`, shopId: s.id, domain: 'shop.example.org', verifiedAt: new Date() })
    assert.equal((await tenancy.getShopById(s.id))?.storefrontUrl, 'https://shop.example.org')
  })
})

describe('which shop an admin lands in', () => {
  test('the shop in the session; else the oldest membership; a super admin with neither gets the oldest shop', async () => {
    const [u, boss] = [await fx.user(), await fx.user()]
    const [older, newer] = [await fx.shop({ name: 'Older' }), await fx.shop({ name: 'Newer' })]
    await fx.member(older.id, u.id, 'admin', new Date('2026-01-01'))
    await fx.member(newer.id, u.id, 'member', new Date('2026-02-01'))
    const active = await tenancy.resolveAdminShop({ userId: u.id, activeShopId: newer.id })
    assert.deepEqual([active?.shop.id, active?.role, active?.superAdmin], [newer.id, 'member', false])
    const first = await tenancy.resolveAdminShop({ userId: u.id })
    assert.deepEqual([first?.shop.id, first?.role], [older.id, 'admin'])
    const asBoss = await tenancy.resolveAdminShop({ userId: boss.id, superAdmin: true })
    assert.deepEqual([asBoss?.role, asBoss?.superAdmin], ['owner', true])
    assert.ok(asBoss?.shop.id)
  })

  test('someone with no membership, or an active shop they are not in, gets nothing', async () => {
    const [u, stranger] = [await fx.user(), await fx.user()]
    const s = await fx.shop()
    await fx.member(s.id, u.id, 'owner')
    assert.equal(await tenancy.resolveAdminShop({ userId: stranger.id }), null)
    assert.equal(await tenancy.resolveAdminShop({ userId: stranger.id, activeShopId: s.id }), null)
    assert.equal(await tenancy.resolveAdminShop({ userId: u.id, activeShopId: 'gone' }), null)
  })

  test('a super admin can act in a shop they are not in, as its owner', async () => {
    const boss = await fx.user()
    const s = await fx.shop()
    const found = await tenancy.resolveAdminShop({ userId: boss.id, activeShopId: s.id, superAdmin: true })
    assert.deepEqual([found?.shop.id, found?.role, found?.superAdmin], [s.id, 'owner', true])
  })
})

describe('the shop switcher', () => {
  test('a member sees the shops they are on, by name; a super admin sees every shop, at most 100', async () => {
    const u = await fx.user()
    const [b, a, c] = [
      await fx.shop({ name: 'bbb switch' }),
      await fx.shop({ name: 'aaa switch' }),
      await fx.shop({ name: 'ccc switch' }),
    ]
    await fx.member(b.id, u.id)
    await fx.member(a.id, u.id)
    assert.deepEqual(
      (await tenancy.listSwitchableShops(u.id, false)).map((s) => s.id),
      [a.id, b.id],
    )
    const all = await tenancy.listSwitchableShops(u.id, true)
    assert.ok(all.length <= 100 && all.some((s) => s.id === c.id))
    assert.deepEqual(await tenancy.listSwitchableShops((await fx.user()).id, false), [])
  })
})

describe('domains under the root', () => {
  test('addresses under the root domain are assigned automatically and cannot be added', async () => {
    const s = await fx.shop()
    await assert.rejects(
      tenancy.domainService.addDomain(s.id, 'mine.shops.example.test'),
      (e: unknown) => e instanceof tenancy.DomainError && e.code === 'INVALID_DOMAIN',
    )
    await assert.rejects(
      tenancy.domainService.addDomain(s.id, 'shops.example.test'),
      (e: unknown) => e instanceof tenancy.DomainError && e.code === 'INVALID_DOMAIN',
    )
    assert.ok(await tenancy.domainService.addDomain(s.id, 'shops.example.org'))
  })
})
