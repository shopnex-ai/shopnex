// The admin shop switcher: which shops a user may switch to and who may make one active. Needs
// TENANCY_MODE=multi in the test process (single mode has nothing to switch), otherwise it is skipped.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { isMultiTenant, listSwitchableShops, setActiveShop } from '@shopnex/tenancy'
import { Fixtures, closeDb, requireApp } from '../lib'

const fx = new Fixtures()

type Account = Awaited<ReturnType<Fixtures['account']>>
let user: Account
let stranger: Account
let mine: { id: string; name: string }
let alsoMine: { id: string; name: string }
let notMine: { id: string; name: string }

const sessionOf = async (userId: string) =>
  (await db.select().from(schema.session).where(eq(schema.session.userId, userId)))[0]!
const join = (shopId: string, userId: string) =>
  db.insert(schema.shopMembers).values({ id: randomUUID(), organizationId: shopId, userId, role: 'owner' })

before(async () => {
  if (!isMultiTenant) return
  await requireApp()
  await fx.init()
  ;[mine, alsoMine, notMine] = [await fx.shop(), await fx.shop(), await fx.shop()]
  ;[user, stranger] = await Promise.all([fx.account('outsider'), fx.account('outsider')])
  await Promise.all([join(mine.id, user.id), join(alsoMine.id, user.id)])
})

after(async () => {
  if (!isMultiTenant) return
  await fx.cleanup()
  await closeDb()
})

describe('shop switcher', { skip: !isMultiTenant && 'needs TENANCY_MODE=multi' }, () => {
  test('lists the shops the user belongs to, and nothing else', async () => {
    const shops = await listSwitchableShops(user.id, false)
    assert.deepEqual(shops.map((s) => s.id).sort(), [mine.id, alsoMine.id].sort())
    assert.deepEqual(await listSwitchableShops(stranger.id, false), [])
  })

  test('a super admin sees every shop', async () => {
    const ids = (await listSwitchableShops(stranger.id, true)).map((s) => s.id)
    for (const shop of [mine, alsoMine, notMine]) assert.ok(ids.includes(shop.id))
  })

  test('a member can make one of their shops active', async () => {
    const session = await sessionOf(user.id)
    assert.equal(
      await setActiveShop({ sessionId: session.id, userId: user.id, superAdmin: false, shopId: alsoMine.id }),
      true,
    )
    assert.equal((await sessionOf(user.id)).activeOrganizationId, alsoMine.id)
  })

  test('a non-member cannot, and the session is left alone', async () => {
    const session = await sessionOf(user.id)
    const before = session.activeOrganizationId
    assert.equal(
      await setActiveShop({ sessionId: session.id, userId: user.id, superAdmin: false, shopId: notMine.id }),
      false,
    )
    assert.equal((await sessionOf(user.id)).activeOrganizationId, before)
  })

  test('a super admin can enter a shop they are not a member of', async () => {
    const session = await sessionOf(stranger.id)
    assert.equal(
      await setActiveShop({ sessionId: session.id, userId: stranger.id, superAdmin: true, shopId: notMine.id }),
      true,
    )
    assert.equal((await sessionOf(stranger.id)).activeOrganizationId, notMine.id)
  })

  test("cannot change another user's session", async () => {
    const theirs = await sessionOf(stranger.id)
    await setActiveShop({ sessionId: theirs.id, userId: user.id, superAdmin: false, shopId: mine.id })
    assert.notEqual((await sessionOf(stranger.id)).activeOrganizationId, mine.id)
  })

  test('unknown shop id', async () => {
    const session = await sessionOf(stranger.id)
    assert.equal(
      await setActiveShop({ sessionId: session.id, userId: stranger.id, superAdmin: true, shopId: 'nope' }),
      false,
    )
  })
})
