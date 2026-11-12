// Sign-up on the embedded database (PGlite, one connection). Better Auth runs a sign-up in its own transaction
// (runWithTransaction), and our hook then makes the new account its own shop. A query on the shared handle inside a
// transaction waits for it for ever on this database, so this runs the real sign-up on an in-memory PGlite, with open
// sign-up on (every account gets a shop), and fails instead of hanging if anything blocks.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: they read these when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.TENANCY_MODE = 'multi'
process.env.OPEN_SIGNUP = 'true'
process.env.SHOPNEX_SECRET ??= 'embedded-signup-test-secret-0123456789'
process.env.APP_URL = 'http://localhost:3000'

const { db, schema, prepareDatabase } = await import('@shopnex/db')
const { auth } = await import('../src')
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

describe('open sign-up on the embedded database', () => {
  test('creates the account and its own shop, with the account as owner', { timeout: 40_000 }, async () => {
    const { user } = await within(
      20_000,
      'signing up',
      auth.api.signUpEmail({ body: { name: 'Ada', email: 'ada@example.com', password: 'correct-horse-battery' } }),
    )
    const members = await within(
      5_000,
      'reading the members',
      db.select().from(schema.shopMembers).where(eq(schema.shopMembers.userId, user.id)),
    )
    assert.equal(members.length, 1, 'the new account owns one shop')
    assert.equal(members[0]!.role, 'owner')
    const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, members[0]!.organizationId))
    assert.ok(shop, 'the shop exists')
  })

  test('a second account gets a shop of its own', { timeout: 40_000 }, async () => {
    const { user } = await within(
      20_000,
      'signing up the second account',
      auth.api.signUpEmail({ body: { name: 'Bob', email: 'bob@example.com', password: 'correct-horse-battery' } }),
    )
    const members = await db.select().from(schema.shopMembers).where(eq(schema.shopMembers.userId, user.id))
    assert.equal(members.length, 1)
    const all = await db.select().from(schema.shops)
    assert.ok(all.length >= 2)
  })
})
