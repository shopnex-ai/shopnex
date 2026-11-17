// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder, and the
// statuses the Admin API answered with before the errors were declared in payments.errors.ts.
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

const { paymentsModule } = await import('../src/payments.module')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('payments manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 2)
    assert.deepEqual(new Set(Object.values(paymentsModule.tables)), exported)
  })

  test('the name is the folder', () => {
    assert.equal(paymentsModule.name, 'payments')
  })

  test('each error code answers with the status it always did', async () => {
    const { PaymentError } = await import('../src/payments.errors')
    const expected = {
      SESSION_NOT_FOUND: 'NOT_FOUND',
      SESSION_CLOSED: 'CONFLICT',
      NOT_A_PAYMENTS_APP: 'FORBIDDEN',
      INVALID_SESSION_URL: 'BAD_REQUEST',
      NOT_PAYABLE: 'CONFLICT',
      PROVIDER_UNAVAILABLE: 'BAD_GATEWAY',
    } as const
    for (const [code, status] of Object.entries(expected)) {
      const mapped = domainErrorMapper(new PaymentError(code as keyof typeof expected, `message of ${code}`))
      assert.ok(mapped instanceof ORPCError, code)
      assert.equal(mapped.code, status, code)
    }
  })

  test('the routes are there, under the names they were mounted with', () => {
    assert.deepEqual(Object.keys(paymentsModule.router).sort(), [
      'paymentApps',
      'paymentMethods',
      'paymentSessions',
      'paymentsApp',
    ])
    assert.equal(Object.keys(paymentsModule.router.paymentMethods).length, 4)
  })
})
