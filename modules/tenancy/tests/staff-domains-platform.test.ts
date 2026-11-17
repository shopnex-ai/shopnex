// Who is on a shop's staff and who may change whom, a shop's domains (the database side), and the platform listings for super admins.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { shopDomains, shopInvitations, shopMembers } from '../src/tenancy.schema'
import { user } from '@shopnex/core/schema'

// Set before the modules load: they read these when first imported
delete process.env.TENANCY_MODE
delete process.env.ROOT_DOMAIN
process.env.APP_URL = 'http://admin.example.test:3000'
const fx = await import('./fixtures')

const { db, schema, eq } = fx
const { staffService, StaffError, platformService, domainService, DomainError } = await import('../src')

const refused = (Err: typeof StaffError | typeof DomainError, code: string) => (e: unknown) =>
  e instanceof Err && (e as { code: string }).code === code

let shopId = ''
let owner: typeof user.$inferSelect
let ownerActor: { userId: string; role: 'owner' | 'admin' | 'member'; superAdmin: boolean }
const actor = (userId: string, role: 'owner' | 'admin' | 'member', superAdmin = false) => ({ userId, role, superAdmin })

before(fx.prepareDatabase)
beforeEach(async () => {
  await fx.cleanup()
  shopId = (await fx.shop()).id
  owner = await fx.user({ name: 'Olive Owner', email: `owner-${fx.unique()}@example.test` })
  await fx.member(shopId, owner.id, 'owner')
  ownerActor = actor(owner.id, 'owner')
})
after(fx.cleanup)

describe('the staff list', () => {
  test('owners first, then admins, then members, each by name', async () => {
    const [zed, amy, bob] = [
      await fx.user({ name: 'Zed' }),
      await fx.user({ name: 'Amy' }),
      await fx.user({ name: 'Bob' }),
    ]
    await fx.member(shopId, zed.id, 'member')
    await fx.member(shopId, amy.id, 'member')
    await fx.member(shopId, bob.id, 'admin')
    const members = await staffService.listMembers(shopId)
    assert.deepEqual(
      members.map((m) => m.name),
      ['Olive Owner', 'Bob', 'Amy', 'Zed'],
    )
    assert.deepEqual(Object.keys(members[0]!).sort(), ['createdAt', 'email', 'id', 'name', 'role', 'userId'])
  })
})

describe('inviting', () => {
  test('lowercases and trims the address, remembers who invited, and expires in the days given', async () => {
    const before = Date.now()
    const inv = await staffService.invite(
      shopId,
      ownerActor,
      { email: '  New.Person@Example.TEST ', role: 'member' },
      3,
    )
    assert.equal(inv.email, 'new.person@example.test')
    assert.equal(inv.status, 'pending')
    assert.equal(inv.inviterId, owner.id)
    assert.match(inv.id, /^[A-Za-z0-9_-]{32}$/)
    const days = (inv.expiresAt.getTime() - before) / 86_400_000
    assert.ok(days > 2.99 && days < 3.01, `about 3 days, got ${days}`)
  })

  test('only an owner or a super admin can invite an admin', async () => {
    const admin = await fx.user()
    await fx.member(shopId, admin.id, 'admin')
    await assert.rejects(
      staffService.invite(shopId, actor(admin.id, 'admin'), { email: 'a@example.test', role: 'admin' }, 7),
      refused(StaffError, 'FORBIDDEN'),
    )
    await staffService.invite(shopId, actor(admin.id, 'admin'), { email: 'm@example.test', role: 'member' }, 7)
    await staffService.invite(shopId, ownerActor, { email: 'a@example.test', role: 'admin' }, 7)
    const boss = await fx.user()
    await staffService.invite(shopId, actor(boss.id, 'member', true), { email: 'b@example.test', role: 'admin' }, 7)
  })

  test('someone already on the staff cannot be invited, whatever the case of the address', async () => {
    const mate = await fx.user({ email: `mate-${fx.unique()}@example.test` })
    await fx.member(shopId, mate.id, 'member')
    await assert.rejects(
      staffService.invite(shopId, ownerActor, { email: mate.email.toUpperCase(), role: 'member' }, 7),
      refused(StaffError, 'ALREADY_MEMBER'),
    )
  })

  test('inviting again cancels the earlier open invitation to that address', async () => {
    const first = await staffService.invite(shopId, ownerActor, { email: 'again@example.test', role: 'member' }, 7)
    const second = await staffService.invite(shopId, ownerActor, { email: 'again@example.test', role: 'admin' }, 7)
    const rows = await db.select().from(shopInvitations).where(eq(shopInvitations.organizationId, shopId))
    assert.equal(rows.find((r) => r.id === first.id)?.status, 'canceled')
    assert.equal(rows.find((r) => r.id === second.id)?.status, 'pending')
  })

  test('the open invitations are the pending ones that have not expired, oldest first; cancelling takes one off', async () => {
    const a = await fx.invitation(shopId, owner.id, { createdAt: new Date('2026-01-01') })
    const b = await fx.invitation(shopId, owner.id, { createdAt: new Date('2026-01-02') })
    await fx.invitation(shopId, owner.id, { expiresAt: new Date(Date.now() - 1000) })
    await fx.invitation(shopId, owner.id, { status: 'accepted' })
    assert.deepEqual(
      (await staffService.listInvitations(shopId)).map((i) => i.id),
      [a.id, b.id],
    )
    assert.equal((await staffService.cancelInvitation(shopId, a.id))?.status, 'canceled')
    assert.equal(await staffService.cancelInvitation(shopId, a.id), null, 'not twice')
    assert.equal(await staffService.cancelInvitation((await fx.shop()).id, b.id), null, 'not from another shop')
    assert.deepEqual(
      (await staffService.listInvitations(shopId)).map((i) => i.id),
      [b.id],
    )
  })
})

describe('changing a member', () => {
  let admin: typeof user.$inferSelect
  let adminMember: typeof shopMembers.$inferSelect
  let plain: typeof shopMembers.$inferSelect
  let ownerMember: typeof shopMembers.$inferSelect

  beforeEach(async () => {
    admin = await fx.user()
    adminMember = await fx.member(shopId, admin.id, 'admin')
    plain = await fx.member(shopId, (await fx.user()).id, 'member')
    ownerMember = (await db.select().from(shopMembers).where(eq(shopMembers.userId, owner.id)))[0]!
  })

  test('an owner changes a member’s role', async () => {
    assert.equal((await staffService.updateRole(shopId, ownerActor, plain.id, 'admin')).role, 'admin')
  })

  test('nobody changes their own access or an owner’s', async () => {
    await assert.rejects(
      staffService.updateRole(shopId, actor(admin.id, 'admin'), adminMember.id, 'member'),
      refused(StaffError, 'FORBIDDEN'),
    )
    await assert.rejects(
      staffService.updateRole(shopId, actor(admin.id, 'admin'), ownerMember.id, 'member'),
      refused(StaffError, 'FORBIDDEN'),
    )
    await assert.rejects(
      staffService.removeMember(shopId, ownerActor, ownerMember.id),
      refused(StaffError, 'FORBIDDEN'),
    )
  })

  test('an admin cannot touch another admin or make one; an owner and a super admin can', async () => {
    const other = await fx.member(shopId, (await fx.user()).id, 'admin')
    const asAdmin = actor(admin.id, 'admin')
    await assert.rejects(staffService.updateRole(shopId, asAdmin, other.id, 'member'), refused(StaffError, 'FORBIDDEN'))
    await assert.rejects(staffService.updateRole(shopId, asAdmin, plain.id, 'admin'), refused(StaffError, 'FORBIDDEN'))
    await assert.rejects(staffService.removeMember(shopId, asAdmin, other.id), refused(StaffError, 'FORBIDDEN'))
    assert.equal((await staffService.updateRole(shopId, asAdmin, plain.id, 'member')).role, 'member')
    assert.equal((await staffService.updateRole(shopId, ownerActor, other.id, 'member')).role, 'member')
    assert.equal(
      (await staffService.updateRole(shopId, actor('boss', 'member', true), plain.id, 'admin')).role,
      'admin',
    )
  })

  test('removing takes the member off and returns them; one from another shop is not found', async () => {
    const removed = await staffService.removeMember(shopId, ownerActor, plain.id)
    assert.equal(removed.id, plain.id)
    assert.equal((await db.select().from(shopMembers).where(eq(shopMembers.id, plain.id))).length, 0)
    const other = await fx.shop()
    const theirs = await fx.member(other.id, (await fx.user()).id, 'member')
    await assert.rejects(staffService.removeMember(shopId, ownerActor, theirs.id), refused(StaffError, 'NOT_FOUND'))
    await assert.rejects(
      staffService.updateRole(shopId, ownerActor, 'nope', 'member'),
      refused(StaffError, 'NOT_FOUND'),
    )
  })
})

describe('domains', () => {
  test('a domain is stored normalized with a token to prove it, and listed oldest first', async () => {
    const a = await domainService.addDomain(shopId, ' HTTPS://Shop.Example.TEST/path ')
    await new Promise((r) => setTimeout(r, 5))
    const b = await domainService.addDomain(shopId, 'second.example.test')
    assert.equal(a.domain, 'shop.example.test')
    assert.equal(a.verifiedAt, null)
    assert.ok(a.verificationToken)
    assert.deepEqual(
      (await domainService.listDomains(shopId)).map((d) => d.id),
      [a.id, b.id],
    )
  })

  test('the admin’s own address, a repeat, another shop’s verified domain and a 21st domain are refused', async () => {
    await assert.rejects(domainService.addDomain(shopId, 'admin.example.test'), refused(DomainError, 'DOMAIN_TAKEN'))
    await domainService.addDomain(shopId, 'mine.example.test')
    await assert.rejects(domainService.addDomain(shopId, 'mine.example.test'), refused(DomainError, 'DOMAIN_TAKEN'))
    const other = await fx.shop()
    await db
      .insert(shopDomains)
      .values({ id: `d-${fx.unique()}`, shopId: other.id, domain: 'theirs.example.test', verifiedAt: new Date() })
    await assert.rejects(domainService.addDomain(shopId, 'theirs.example.test'), refused(DomainError, 'DOMAIN_TAKEN'))
    for (let i = 0; i < 19; i++) await domainService.addDomain(shopId, `d${i}.example.test`)
    await assert.rejects(
      domainService.addDomain(shopId, 'one-too-many.example.test'),
      refused(DomainError, 'INVALID_DOMAIN'),
    )
  })

  test('another shop’s domain that was never verified is handed over to whoever adds it', async () => {
    const other = await fx.shop()
    await domainService.addDomain(other.id, 'contested.example.test')
    const mine = await domainService.addDomain(shopId, 'contested.example.test')
    assert.equal(mine.shopId, shopId)
    assert.equal((await domainService.listDomains(other.id)).length, 0)
  })

  test('removing and verifying work on this shop’s domains only; one that is verified already says so without a lookup', async () => {
    const d = await domainService.addDomain(shopId, 'gone.example.test')
    const other = await fx.shop()
    await assert.rejects(domainService.removeDomain(other.id, d.id), refused(DomainError, 'DOMAIN_NOT_FOUND'))
    await assert.rejects(domainService.verifyDomain(other.id, d.id), refused(DomainError, 'DOMAIN_NOT_FOUND'))
    await domainService.removeDomain(shopId, d.id)
    await assert.rejects(domainService.removeDomain(shopId, d.id), refused(DomainError, 'DOMAIN_NOT_FOUND'))
    const [done] = await db
      .insert(shopDomains)
      .values({ id: `d-${fx.unique()}`, shopId, domain: 'done.example.test', verifiedAt: new Date() })
      .returning()
    const result = await domainService.verifyDomain(shopId, done!.id)
    assert.equal(result.verified, true)
  })
})

describe('the platform listings', () => {
  test('the overview counts shops and users, and how many are new within the week', async () => {
    const base = await platformService.overview()
    await fx.shop()
    await fx.user()
    const now = await platformService.overview()
    assert.equal(now.shops, base.shops + 1)
    assert.equal(now.users, base.users + 1)
    assert.equal(now.newShops, base.newShops + 1)
    assert.equal(now.recentDays, 7)
    const later = await platformService.overview(new Date(Date.now() + 30 * 86_400_000))
    assert.deepEqual([later.newShops, later.newUsers], [0, 0])
  })

  test('shops: newest first with member and order counts and the owner’s email; search is a plain substring, % and _ included', async () => {
    const owner2 = await fx.user({ email: `boss-${fx.unique()}@example.test` })
    const s = await fx.shop({ name: '100%_off Store', slug: `promo-${fx.unique()}` })
    await fx.member(s.id, owner2.id, 'owner')
    await fx.member(s.id, (await fx.user()).id, 'member')
    await fx.shop({ name: '100 percent' })
    const found = await platformService.listShops({ limit: 10, offset: 0, search: '100%_' })
    assert.deepEqual(
      found.items.map((i) => i.id),
      [s.id],
    )
    assert.equal(found.total, 1)
    assert.deepEqual(
      [found.items[0]!.members, found.items[0]!.orders, found.items[0]!.ownerEmail],
      [2, 0, owner2.email],
    )
    const all = await platformService.listShops({ limit: 1, offset: 0 })
    assert.equal(all.items.length, 1)
    assert.ok(all.total >= 3)
  })

  test('users: by name or email, with how many shops each is on', async () => {
    const u = await fx.user({ name: 'Findable Person', email: `findable-${fx.unique()}@example.test` })
    await fx.member(shopId, u.id, 'member')
    await fx.member((await fx.shop()).id, u.id, 'member')
    const byName = await platformService.listUsers({ limit: 10, offset: 0, search: 'findable per' })
    assert.deepEqual(
      byName.items.map((i) => [i.id, i.shops]),
      [[u.id, 2]],
    )
    const byEmail = await platformService.listUsers({ limit: 10, offset: 0, search: u.email.slice(0, 14) })
    assert.ok(byEmail.items.some((i) => i.id === u.id))
    assert.equal((await platformService.listUsers({ limit: 10, offset: 0, search: 'zzz-nobody-zzz' })).total, 0)
  })
})
