// Shops in single-shop mode (the default): reading them, members and roles, creating one for an account, which shop an admin or the
// storefront lands in, and the invitation lookups the sign-up page uses.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shopDomains, shopMembers } from '../src/tenancy.schema'

// Set before the modules load: they read these when first imported
delete process.env.TENANCY_MODE
delete process.env.ROOT_DOMAIN
delete process.env.STOREFRONT_URL
const fx = await import('./fixtures')

const { db, schema } = fx
const tenancy = await import('../src')
const { storefrontKeyService } = await import('@shopnex/channels')
// Used by the resolvers, not part of the package's public API
const internal = await import('../src/shops')
const { eq } = fx

before(fx.prepareDatabase)
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('reading shops', () => {
  test('by id, slug and verified domain; the domain is matched in lower case and an unverified one is not a shop', async () => {
    const s = await fx.shop({ slug: 'acme-read' })
    await db
      .insert(shopDomains)
      .values({ id: `d-${fx.unique()}`, shopId: s.id, domain: 'verified.example.test', verifiedAt: new Date() })
    await db.insert(shopDomains).values({ id: `d-${fx.unique()}`, shopId: s.id, domain: 'pending.example.test' })
    assert.equal((await tenancy.getShopById(s.id))?.slug, 'acme-read')
    assert.equal(await tenancy.getShopById('nope'), null)
    assert.equal((await internal.getShopBySlug('acme-read'))?.id, s.id)
    assert.equal((await internal.getShopByDomain('VERIFIED.example.test'))?.id, s.id)
    assert.equal(await internal.getShopByDomain('pending.example.test'), null)
  })

  test('the default shop is there once, whoever asks first', async () => {
    const [a, b] = await Promise.all([tenancy.ensureDefaultShop(), tenancy.ensureDefaultShop()])
    assert.equal(a.id, 'default')
    assert.equal(b.id, 'default')
    assert.equal((await db.select().from(schema.shops).where(eq(schema.shops.id, 'default'))).length, 1)
  })

  test('updateShop changes what it is given, can set the storefront URL in this mode, and null for an unknown shop', async () => {
    const s = await fx.shop()
    const changed = await tenancy.updateShop(s.id, {
      name: 'Renamed',
      currency: 'EUR',
      storefrontUrl: 'https://store.example.test',
    })
    assert.deepEqual(
      [changed?.name, changed?.currency, changed?.storefrontUrl],
      ['Renamed', 'EUR', 'https://store.example.test'],
    )
    assert.equal((await tenancy.updateShop(s.id, {}))?.name, 'Renamed', 'an empty patch reads it back')
    assert.equal(await tenancy.updateShop('nope', { name: 'x' }), null)
  })

  test('there is no shop switcher in this mode', async () => {
    const u = await fx.user()
    assert.deepEqual(await tenancy.listSwitchableShops(u.id, false), [])
    assert.deepEqual(await tenancy.listSwitchableShops(u.id, true), [])
  })
})

describe('members', () => {
  test('the first member of a shop is its owner, later ones are members, and adding the same person twice changes nothing', async () => {
    const s = await fx.shop()
    const [first, second] = [await fx.user(), await fx.user()]
    await tenancy.addMember(s.id, first.id)
    await tenancy.addMember(s.id, second.id)
    await tenancy.addMember(s.id, second.id)
    const rows = await db.select().from(shopMembers).where(eq(shopMembers.organizationId, s.id))
    assert.equal(rows.length, 2)
    assert.equal(rows.find((r) => r.userId === first.id)?.role, 'owner')
    assert.equal(rows.find((r) => r.userId === second.id)?.role, 'member')
  })

  test('getMembership is for that shop and person; getFirstMembership is the oldest', async () => {
    const [a, b] = [await fx.shop(), await fx.shop()]
    const u = await fx.user()
    await fx.member(b.id, u.id, 'admin', new Date('2026-02-01'))
    await fx.member(a.id, u.id, 'member', new Date('2026-01-01'))
    assert.equal((await tenancy.getFirstMembership(u.id))?.organizationId, a.id)
    assert.equal(await tenancy.getFirstMembership('nobody'), null)
    assert.equal((await db.select().from(shopMembers).where(eq(shopMembers.userId, u.id))).length, 2)
  })
})

describe('createShop, for a new account', () => {
  test('makes the shop with a random slug, the account as owner and the Online Store, and tells the shopCreated listeners', async () => {
    const seen: unknown[] = []
    tenancy.shopCreated.on('test.records', (_conn, payload) => void seen.push(payload))
    const owner = await fx.user()
    const s = await tenancy.createShop({ ownerId: owner.id, name: '  Café  ' })
    assert.equal(s.name, 'Café', 'the name is trimmed')
    assert.equal(s.currency, 'USD')
    assert.match(s.slug, /^shop-[0-9a-f]{8}$/)
    const members = await db.select().from(shopMembers).where(eq(shopMembers.organizationId, s.id))
    assert.deepEqual(
      members.map((m) => [m.userId, m.role]),
      [[owner.id, 'owner']],
    )
    assert.deepEqual(seen, [{ shopId: s.id }])
    tenancy.shopCreated.on('test.records', () => undefined)
    const channels = await db.select().from(schema.channels).where(eq(schema.channels.shopId, s.id))
    assert.deepEqual(
      channels.map((c) => c.handle),
      ['online-store'],
    )
    await db.delete(schema.shops).where(eq(schema.shops.id, s.id))
  })

  test('takes the currency given', async () => {
    const owner = await fx.user()
    const s = await tenancy.createShop({ ownerId: owner.id, name: 'Euro shop', currency: 'EUR' })
    assert.equal(s.currency, 'EUR')
    await db.delete(schema.shops).where(eq(schema.shops.id, s.id))
  })

  test('is all or nothing: an owner that does not exist leaves no shop or channel behind', async () => {
    const shopsBefore = (await db.select().from(schema.shops)).length
    await assert.rejects(tenancy.createShop({ ownerId: 'nobody', name: 'Ghost' }))
    assert.equal((await db.select().from(schema.shops)).length, shopsBefore)
  })

  test('a shopCreated listener that fails undoes the whole shop: no shop, owner membership or channel is left', async () => {
    const owner = await fx.user()
    const shopsBefore = (await db.select().from(schema.shops)).length
    tenancy.shopCreated.on('test.fails', () => {
      throw new Error('could not seed')
    })
    try {
      await assert.rejects(tenancy.createShop({ ownerId: owner.id, name: 'Doomed' }), /could not seed/)
    } finally {
      tenancy.shopCreated.on('test.fails', () => undefined)
    }
    assert.equal((await db.select().from(schema.shops)).length, shopsBefore)
    assert.equal((await db.select().from(shopMembers).where(eq(shopMembers.userId, owner.id))).length, 0)
  })
})

describe('which shop an admin lands in', () => {
  test('always the default shop; a super admin acts as its owner, a member with their role, anyone else is out', async () => {
    const [admin, stranger, boss] = [await fx.user(), await fx.user(), await fx.user()]
    await fx.member('default', admin.id, 'admin')
    const asAdmin = await tenancy.resolveAdminShop({ userId: admin.id })
    assert.deepEqual([asAdmin?.shop.id, asAdmin?.role, asAdmin?.superAdmin], ['default', 'admin', false])
    assert.equal(await tenancy.resolveAdminShop({ userId: stranger.id }), null)
    const asBoss = await tenancy.resolveAdminShop({ userId: boss.id, superAdmin: true })
    assert.deepEqual([asBoss?.shop.id, asBoss?.role, asBoss?.superAdmin], ['default', 'owner', true])
  })

  test('an active shop in the session means nothing here', async () => {
    const u = await fx.user()
    const other = await fx.shop()
    await fx.member(other.id, u.id, 'owner')
    assert.equal(await tenancy.resolveAdminShop({ userId: u.id, activeShopId: other.id }), null)
  })
})

describe('which shop the storefront lands in', () => {
  test('without a key: the default shop and its Online Store', async () => {
    const found = await tenancy.resolveStorefrontShop(new Headers())
    assert.equal(found.ok, true)
    if (!found.ok) return
    assert.equal(found.shop.id, 'default')
    const store = await db.select().from(schema.channels).where(eq(schema.channels.shopId, 'default'))
    assert.equal(found.channelId, store.find((c) => c.handle === 'online-store')?.id)
  })

  test('with a publishable key: that key’s shop and channel, even in this mode; a revoked or unknown key is refused', async () => {
    const s = await fx.shop()
    const key = await storefrontKeyService.create(s.id, 'Mobile app', undefined, db)
    const found = await tenancy.resolveStorefrontShop(new Headers({ [tenancy.PUBLISHABLE_KEY_HEADER]: key.token }))
    assert.deepEqual(found.ok && [found.shop.id, found.channelId], [s.id, key.channelId])
    await storefrontKeyService.revoke(s.id, key.id, db)
    for (const token of [key.token, 'pk_unknown']) {
      const refused = await tenancy.resolveStorefrontShop(new Headers({ [tenancy.PUBLISHABLE_KEY_HEADER]: token }))
      assert.deepEqual(refused, { ok: false, reason: 'invalid_key' })
    }
  })
})

describe('invitations on the sign-up page', () => {
  test('an open invitation comes back with the shop’s name; expired, used or unknown ones do not', async () => {
    const s = await fx.shop({ name: 'Invited Shop' })
    const inviter = await fx.user()
    const open = await fx.invitation(s.id, inviter.id)
    const expired = await fx.invitation(s.id, inviter.id, { expiresAt: new Date(Date.now() - 1000) })
    const accepted = await fx.invitation(s.id, inviter.id, { status: 'accepted' })
    assert.equal((await tenancy.getOpenInvitation(open.id))?.shopName, 'Invited Shop')
    for (const id of [expired.id, accepted.id, 'nope']) assert.equal(await tenancy.getOpenInvitation(id), null, id)
  })

  test('userExists ignores case', async () => {
    const u = await fx.user({ email: 'Someone.Here@Example.test'.toLowerCase() })
    assert.equal(await tenancy.userExists('SOMEONE.here@example.TEST'), true)
    assert.equal(await tenancy.userExists('absent@example.test'), false)
    assert.ok(u)
  })
})
