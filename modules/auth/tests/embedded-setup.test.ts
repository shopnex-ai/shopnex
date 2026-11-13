// First-run setup on the embedded database (PGlite), which is what `npx create-shopnex` starts on: the setup wizard
// creates the first account as platform super admin and owner of the default shop. Runs the real flow on an in-memory
// database and fails instead of hanging if anything blocks.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: they read these when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'embedded-setup-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, schema, prepareDatabase } = await import('@shopnex/db')
const { SUPER_ADMIN_ROLE } = await import('../src/roles')
const { SetupError, completeSetup, isSetupComplete } = await import('../src/setup')
const { eq } = await import('drizzle-orm')

/** Fails the test, instead of hanging it, when `work` doesn't finish: on the embedded database that is the bug */
async function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const frozen = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms: the database is blocked`)), ms)
  })
  try {
    return await Promise.race([work, frozen])
  } finally {
    clearTimeout(timer)
  }
}

before(async () => {
  await prepareDatabase()
})

after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('first-run setup on the embedded database', () => {
  test('a fresh install is not set up', { timeout: 20_000 }, async () => {
    assert.equal(await within(5_000, 'checking the setup', isSetupComplete()), false)
  })

  test('creates the super admin and makes them the owner of the default shop', { timeout: 40_000 }, async () => {
    const user = await within(
      20_000,
      'completing the setup',
      completeSetup({ email: 'Owner@Example.com', password: 'correct-horse-battery' }),
    )
    assert.equal(user.email, 'owner@example.com')

    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, user.id))
    assert.equal(row?.role, SUPER_ADMIN_ROLE)
    assert.equal(row?.name, 'Owner', 'the name is the part of the email before the @, as it was typed')

    const members = await db.select().from(schema.shopMembers).where(eq(schema.shopMembers.userId, user.id))
    assert.equal(members.length, 1)
    assert.equal(members[0]?.role, 'owner')
    assert.equal(members[0]?.organizationId, 'default')
  })

  test('seeds the default menu of the default shop once', { timeout: 20_000 }, async () => {
    const menus = await within(
      5_000,
      'reading the menus',
      db.select().from(schema.menus).where(eq(schema.menus.shopId, 'default')),
    )
    assert.ok(menus.length > 0, 'the shop has its default menu')
  })

  test('is complete afterwards, and a second setup is refused', { timeout: 40_000 }, async () => {
    assert.equal(await isSetupComplete(), true)
    await assert.rejects(
      within(
        20_000,
        'a second setup',
        completeSetup({ email: 'second@example.com', password: 'correct-horse-battery' }),
      ),
      (error: unknown) => error instanceof SetupError && /already complete/.test(error.message),
    )
    const users = await db.select().from(schema.user)
    assert.equal(users.length, 1, 'no second account was created')
  })
})
