// Who may create an account when sign-up is by invitation (the default): a pending, unexpired invitation for that address, or
// server code that says so (setup, scripts). Open sign-up is another process's configuration: see open-signup-limits.test.ts.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'

// Set before the modules load: they read these when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'sign-up-policy-test-secret-0123456789'
delete process.env.TENANCY_MODE
delete process.env.OPEN_SIGNUP

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
const { shopInvitations } = await import('@shopnex/tenancy/schema')
requireEmbeddedDatabase()
const { assertSignUpAllowed, createShopForNewAccount, withSignUpAllowed } = await import('../src/sign-up-policy')
const { eq } = await import('drizzle-orm')
const { APIError } = await import('better-auth/api')

const SHOP = 'default'
let invitations = 0
const INVITER = 'sign-up-policy-inviter'
const forbidden = (e: unknown) =>
  e instanceof APIError && e.status === 'FORBIDDEN' && /by invitation only/.test(e.message)

const invite = (patch: Partial<typeof shopInvitations.$inferInsert> = {}) =>
  db.insert(shopInvitations).values({
    id: `inv-${String(++invitations)}`,
    organizationId: SHOP,
    email: 'invited@example.com',
    role: 'admin',
    status: 'pending',
    expiresAt: new Date(Date.now() + 3600_000),
    inviterId: INVITER,
    ...patch,
  })

before(async () => {
  await prepareDatabase()
  await db
    .insert(schema.user)
    .values({ id: INVITER, name: 'Inviter', email: 'inviter@example.com' })
    .onConflictDoNothing()
})
beforeEach(() => db.delete(shopInvitations).where(eq(shopInvitations.organizationId, SHOP)))
after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('assertSignUpAllowed, by invitation', () => {
  test('refuses an address nobody invited', async () => {
    await assert.rejects(assertSignUpAllowed('stranger@example.com'), forbidden)
  })

  test('lets in an address with a pending invitation, whatever the case', async () => {
    await invite({ email: 'Invited@Example.com' })
    await assertSignUpAllowed('invited@example.com')
    await assertSignUpAllowed('INVITED@EXAMPLE.COM')
  })

  test('an invitation that expired, was accepted or was cancelled is no invitation', async () => {
    await invite({ expiresAt: new Date(Date.now() - 1000) })
    await assert.rejects(assertSignUpAllowed('invited@example.com'), forbidden)
    await db.delete(shopInvitations).where(eq(shopInvitations.organizationId, SHOP))
    for (const status of ['accepted', 'canceled', 'rejected']) {
      await invite({ status })
      await assert.rejects(assertSignUpAllowed('invited@example.com'), forbidden, status)
      await db.delete(shopInvitations).where(eq(shopInvitations.organizationId, SHOP))
    }
  })

  test('an invitation is for that address only', async () => {
    await invite()
    await assert.rejects(assertSignUpAllowed('someone-else@example.com'), forbidden)
  })

  test('withSignUpAllowed lets any address in, only inside it', async () => {
    await withSignUpAllowed(() => assertSignUpAllowed('anyone@example.com'))
    await withSignUpAllowed(async () => {
      await Promise.resolve()
      await assertSignUpAllowed('anyone@example.com')
    })
    await assert.rejects(assertSignUpAllowed('anyone@example.com'), forbidden)
  })
})

describe('createShopForNewAccount, by invitation', () => {
  test('makes no shop: an invited person joins the shop that invited them', async () => {
    const before = await db.select().from(schema.shops)
    await createShopForNewAccount({ id: INVITER, email: 'invited@example.com' })
    assert.equal((await db.select().from(schema.shops)).length, before.length)
  })
})
