// withStorefrontUrl in multi-tenant mode reads the shop's domains. Called inside a transaction (queueing an email) it
// must read them on that transaction: a read on the shared handle waits for the transaction for ever on the embedded
// database, which has one connection, and the shop freezes.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: both are read when first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.TENANCY_MODE = 'multi'
process.env.ROOT_DOMAIN = 'shops.example.com'
process.env.SHOPNEX_SECRET ??= 'embedded-storefront-url-test-secret-0123456789'

const { db, schema, prepareDatabase } = await import('@shopnex/db')
const { withStorefrontUrl } = await import('../src')
const { eq } = await import('drizzle-orm')

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

let shop: typeof schema.shops.$inferSelect

before(async () => {
  await prepareDatabase()
  const [row] = await db.select().from(schema.shops).where(eq(schema.shops.id, 'default'))
  shop = row!
})

after(() => {
  setImmediate(() => process.exit())
})

describe('withStorefrontUrl on the embedded database, multi mode', () => {
  test('reads the domains on the transaction it is given', { timeout: 20_000 }, async () => {
    const result = await within(
      10_000,
      'withStorefrontUrl inside a transaction',
      db.transaction((tx) => withStorefrontUrl(shop, tx)),
    )
    assert.equal(result.id, shop.id)
  })

  test('works outside a transaction too', { timeout: 20_000 }, async () => {
    const result = await within(10_000, 'withStorefrontUrl', withStorefrontUrl(shop))
    assert.equal(result.id, shop.id)
  })

  test('without the transaction it is refused inside one, instead of freezing', { timeout: 20_000 }, async () => {
    await assert.rejects(
      within(
        10_000,
        'withStorefrontUrl on the shared handle inside a transaction',
        db.transaction(async () => withStorefrontUrl(shop)),
      ),
      (error: Error) => {
        assert.match(
          String((error.cause as Error | undefined)?.message ?? error.message),
          /shared database handle inside a transaction/,
        )
        return true
      },
    )
  })
})
