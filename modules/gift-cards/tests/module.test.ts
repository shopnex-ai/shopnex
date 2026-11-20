// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder,
// and the statuses the Admin API answers with.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ORPCError } from '@orpc/server'
import { domainErrorMapper } from '@shopnex/rpc'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { giftCardsModule } = await import('../src/gift-cards.module')
const { GiftCardError } = await import('../src/gift-cards.errors')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('gift-cards manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 2)
    assert.deepEqual(new Set(Object.values(giftCardsModule.tables)), exported)
  })

  test('the name is the folder, and the routes are the gift cards', () => {
    assert.equal(giftCardsModule.name, 'gift-cards')
    assert.deepEqual(Object.keys(giftCardsModule.router), ['giftCards'])
    assert.deepEqual(Object.keys(giftCardsModule.router.giftCards).sort(), [
      'adjust',
      'disable',
      'enable',
      'get',
      'issue',
      'list',
    ])
  })

  test('each error code answers with its status', () => {
    const expected = {
      GIFT_CARD_NOT_FOUND: 'NOT_FOUND',
      INVALID_GIFT_CARD: 'BAD_REQUEST',
      GIFT_CARD_UNAVAILABLE: 'BAD_REQUEST',
      INSUFFICIENT_BALANCE: 'CONFLICT',
    } as const
    for (const [code, status] of Object.entries(expected)) {
      const cause = new GiftCardError(code as keyof typeof expected, `message of ${code}`)
      const mapped = domainErrorMapper(cause)
      assert.ok(mapped instanceof ORPCError, code)
      assert.equal(mapped.code, status, code)
      assert.deepEqual(mapped.data, { code })
    }
  })
})
