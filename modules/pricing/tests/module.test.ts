// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder,
// and the statuses the Admin API answered with before they were declared in pricing.errors.ts.
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

const { pricingModule } = await import('../src/pricing.module')
const { PricingError } = await import('../src/pricing.errors')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('pricing manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 2)
    assert.deepEqual(new Set(Object.values(pricingModule.tables)), exported)
  })

  test('the name is the folder, and the routes are the discounts and the tax rates', () => {
    assert.equal(pricingModule.name, 'pricing')
    assert.deepEqual(Object.keys(pricingModule.router).sort(), ['discounts', 'taxRates'])
    assert.deepEqual(Object.keys(pricingModule.router.discounts).sort(), [
      'create',
      'delete',
      'deleteMany',
      'get',
      'list',
      'update',
    ])
    assert.deepEqual(Object.keys(pricingModule.router.taxRates).sort(), ['create', 'delete', 'list', 'update'])
  })

  // The statuses of the old hand-written mapping in modules/api/src/orpc.ts
  test('each error code answers with the status it always did', () => {
    const expected = {
      DISCOUNT_NOT_FOUND: 'NOT_FOUND',
      TAX_RATE_NOT_FOUND: 'NOT_FOUND',
      CODE_TAKEN: 'CONFLICT',
      TAX_RATE_EXISTS: 'CONFLICT',
      INVALID_DISCOUNT: 'BAD_REQUEST',
    } as const
    for (const [code, status] of Object.entries(expected)) {
      const cause = new PricingError(code as keyof typeof expected, `message of ${code}`)
      const mapped = domainErrorMapper(cause)
      assert.ok(mapped instanceof ORPCError, code)
      assert.equal(mapped.code, status, code)
      assert.equal(mapped.message, `message of ${code}`)
      assert.deepEqual(mapped.data, { code })
      assert.equal(mapped.cause, cause)
    }
  })

  test('an error that is not this module is left alone', () => {
    assert.equal(domainErrorMapper(new Error('boom')), undefined)
  })
})
