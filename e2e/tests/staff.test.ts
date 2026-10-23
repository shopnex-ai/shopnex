// Shop staff end to end: invitations, role changes and removal through the admin API, and who may do what
// (owner > admin > member; nobody edits themselves; owners are untouchable; super admins manage any shop).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { Fixtures, PASSWORD, SHOP, authCall, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()

type Account = Awaited<ReturnType<Fixtures['account']>>
let owner: Account
let admin: Account
let member: Account
let superadmin: Account
let otherShop: string

before(async () => {
  await requireApp()
  await fx.init()
  otherShop = (await fx.shop()).id
  ;[owner, admin, member, superadmin] = await Promise.all([
    fx.account('owner'),
    fx.account('admin'),
    fx.account('member'),
    fx.account('superadmin'),
  ])
})

after(async () => {
  await fx.cleanup()
  await closeDb()
})

const list = async (as: Account = owner) => ok(await call('GET', '/admin/staff', undefined, as.headers))
const invite = (as: Account, email: string, role: string) =>
  call('POST', '/admin/staff/invitations', { email, role }, as.headers)
const setRole = (as: Account, memberId: string, role: string) =>
  call('PATCH', `/admin/staff/members/${memberId}`, { role }, as.headers)
const remove = (as: Account, memberId: string) =>
  call('DELETE', `/admin/staff/members/${memberId}`, undefined, as.headers)
const roleOf = async (userId: string) => (await list()).members.find((m: any) => m.userId === userId)?.role

describe('staff list', () => {
  test('members come owners first, then admins, then staff; invitations are listed separately', async () => {
    const email = fx.mail('listed')
    ok(await invite(owner, email, 'member'))
    const { members, invitations } = await list()
    const roles: string[] = members.map((m: any) => m.role)
    assert.deepEqual(
      roles,
      [...roles].sort((x, y) => ['owner', 'admin', 'member'].indexOf(x) - ['owner', 'admin', 'member'].indexOf(y)),
    )
    for (const [a, role] of [
      [owner, 'owner'],
      [admin, 'admin'],
      [member, 'member'],
    ] as const) {
      assert.equal(members.find((m: any) => m.userId === a.id)?.role, role)
    }
    assert.ok(invitations.some((i: any) => i.email === email))
  })

  test('another shop has its own staff', async () => {
    const theirs = await fx.account('member', otherShop)
    assert.equal(
      (await list()).members.some((m: any) => m.userId === theirs.id),
      false,
    )
  })
})

describe('invitations', () => {
  test('invite → sign up → accept: the invitee becomes staff with the invited role', async () => {
    const email = fx.mail('invitee')
    const invitation = ok(await invite(owner, email, 'admin'))
    assert.equal(invitation.status, 'pending')
    assert.equal(invitation.role, 'admin')
    assert.ok(invitation.id.length >= 32, 'the id is the secret in the invite link: long and random')
    assert.ok((await list()).invitations.some((i: any) => i.id === invitation.id))

    const signUp = await fx.signUp(email)
    assert.equal(signUp.status, 200, JSON.stringify(signUp.body))
    const accepted = await authCall('/organization/accept-invitation', { invitationId: invitation.id }, signUp.cookie)
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body))

    assert.equal(await roleOf(signUp.body.user.id), 'admin')
    assert.equal(
      (await list()).invitations.some((i: any) => i.id === invitation.id),
      false,
      'no longer pending',
    )
    const joined = { headers: { cookie: signUp.cookie! } }
    ok(await call('GET', '/admin/staff', undefined, joined.headers))
  })

  test('input is validated: bad email, owner role, unknown role', async () => {
    assert.equal((await invite(owner, 'not-an-email', 'member')).status, 400)
    assert.equal((await invite(owner, fx.mail('x'), 'owner')).status, 400)
    assert.equal((await invite(owner, fx.mail('x'), 'superadmin')).status, 400)
  })

  test('owners invite admins, admins invite only staff, members invite nobody', async () => {
    ok(await invite(owner, fx.mail('a1'), 'admin'))
    assert.equal((await invite(admin, fx.mail('a2'), 'admin')).status, 403)
    ok(await invite(admin, fx.mail('m1'), 'member'))
    assert.equal((await invite(member, fx.mail('m2'), 'member')).status, 403)
  })

  test('inviting someone already in the shop is a conflict, whatever the case', async () => {
    assert.equal((await invite(owner, member.email, 'member')).status, 409)
    assert.equal((await invite(owner, member.email.toUpperCase(), 'member')).status, 409)
  })

  test('inviting an email again replaces its open invitation', async () => {
    const email = fx.mail('again')
    const first = ok(await invite(owner, email, 'member'))
    const second = ok(await invite(owner, email.toUpperCase(), 'admin'))
    assert.notEqual(first.id, second.id)
    const open = (await list()).invitations.filter((i: any) => i.email === email)
    assert.deepEqual(
      open.map((i: any) => [i.id, i.role]),
      [[second.id, 'admin']],
    )
    // The old link is dead
    assert.equal((await call('POST', `/admin/staff/invitations/${first.id}/cancel`, {}, owner.headers)).status, 404)
  })

  test('cancelling: gone from the list, the link stops working, sign-up is closed again', async () => {
    const email = fx.mail('cancel')
    const invitation = ok(await invite(admin, email, 'member'))
    ok(await call('POST', `/admin/staff/invitations/${invitation.id}/cancel`, {}, admin.headers))
    assert.equal(
      (await list()).invitations.some((i: any) => i.id === invitation.id),
      false,
    )
    assert.equal((await authCall('/sign-up/email', { name: 'X', email, password: PASSWORD })).status, 403)
    assert.equal(
      (await call('POST', `/admin/staff/invitations/${invitation.id}/cancel`, {}, owner.headers)).status,
      404,
    )
  })

  test("members cannot cancel; another shop's invitation is not found", async () => {
    const mine = ok(await invite(owner, fx.mail('keep'), 'member'))
    assert.equal((await call('POST', `/admin/staff/invitations/${mine.id}/cancel`, {}, member.headers)).status, 403)
    const theirs = await fx.invitation(otherShop, fx.mail('theirs'), 'member')
    assert.equal((await call('POST', `/admin/staff/invitations/${theirs}/cancel`, {}, owner.headers)).status, 404)
    const [row] = await db.select().from(schema.shopInvitations).where(eq(schema.shopInvitations.id, theirs))
    assert.equal(row?.status, 'pending')
  })

  test('an expired invitation is not listed', async () => {
    const email = fx.mail('stale')
    await fx.invitation(SHOP, email, 'member', -1000)
    assert.equal(
      (await list()).invitations.some((i: any) => i.email === email),
      false,
    )
  })
})

describe('roles', () => {
  test('owners make staff admins and back', async () => {
    const m = await fx.account('member')
    ok(await setRole(owner, m.memberId, 'admin'))
    assert.equal(await roleOf(m.id), 'admin')
    ok(await setRole(owner, m.memberId, 'member'))
    assert.equal(await roleOf(m.id), 'member')
  })

  test('admins manage staff but cannot make admins or touch them', async () => {
    const staff = await fx.account('member')
    const peer = await fx.account('admin')
    assert.equal((await setRole(admin, staff.memberId, 'admin')).status, 403)
    assert.equal((await setRole(admin, peer.memberId, 'member')).status, 403)
    assert.equal((await remove(admin, peer.memberId)).status, 403)
    assert.equal(await roleOf(peer.id), 'admin')
    ok(await setRole(admin, staff.memberId, 'member'))
  })

  test('members manage nobody', async () => {
    const other = await fx.account('member')
    assert.equal((await setRole(member, other.memberId, 'admin')).status, 403)
    assert.equal((await remove(member, other.memberId)).status, 403)
  })

  test("nobody edits themselves and owners can't be changed, not even by other owners or super admins", async () => {
    assert.equal((await setRole(admin, admin.memberId, 'member')).status, 403)
    assert.equal((await remove(admin, admin.memberId)).status, 403)
    assert.equal((await setRole(owner, owner.memberId, 'member')).status, 403)
    assert.equal((await remove(owner, owner.memberId)).status, 403)
    assert.equal((await setRole(superadmin, owner.memberId, 'member')).status, 403)
    assert.equal((await remove(superadmin, owner.memberId)).status, 403)
    assert.equal(await roleOf(owner.id), 'owner')
    assert.equal(await roleOf(admin.id), 'admin')
  })

  test('owner is not a role you can hand out; unknown members are not found', async () => {
    const m = await fx.account('member')
    assert.equal((await setRole(owner, m.memberId, 'owner')).status, 400)
    assert.equal((await setRole(owner, m.memberId, 'superadmin')).status, 400)
    assert.equal((await setRole(owner, 'no-such-member', 'admin')).status, 404)
    assert.equal((await remove(owner, 'no-such-member')).status, 404)
  })

  test("a member of another shop can't be reached by id", async () => {
    const theirs = await fx.account('member', otherShop)
    assert.equal((await setRole(owner, theirs.memberId, 'admin')).status, 404)
    assert.equal((await remove(owner, theirs.memberId)).status, 404)
    const [row] = await db.select().from(schema.shopMembers).where(eq(schema.shopMembers.id, theirs.memberId))
    assert.equal(row?.role, 'member')
    // …and the other shop's owner has no say in this one
    const theirOwner = await fx.account('owner', otherShop)
    assert.equal((await setRole(theirOwner, member.memberId, 'member')).status, 403)
  })
})

describe('removing staff', () => {
  test('removed staff lose the shop at once but keep their account', async () => {
    const m = await fx.account('member')
    ok(await call('GET', '/admin/shop', undefined, m.headers))
    ok(await remove(owner, m.memberId))
    assert.equal(await roleOf(m.id), undefined)
    assert.equal((await call('GET', '/admin/shop', undefined, m.headers)).status, 403)
    const again = await authCall('/sign-in/email', { email: m.email, password: PASSWORD })
    assert.equal(again.status, 200, 'the account itself is still there')
  })

  test('a demoted admin loses settings access at once', async () => {
    const a = await fx.account('admin')
    ok(await call('GET', '/admin/staff', undefined, a.headers))
    ok(await setRole(owner, a.memberId, 'member'))
    assert.equal((await call('GET', '/admin/staff', undefined, a.headers)).status, 403)
    ok(await call('GET', '/admin/shop', undefined, a.headers))
  })
})

describe('super admins', () => {
  test('manage staff without being members of the shop', async () => {
    assert.equal(await roleOf(superadmin.id), undefined)
    const email = fx.mail('byadmin')
    ok(await invite(superadmin, email, 'admin'))
    const m = await fx.account('member')
    ok(await setRole(superadmin, m.memberId, 'admin'))
    assert.equal(await roleOf(m.id), 'admin')
    ok(await remove(superadmin, m.memberId))
  })
})
