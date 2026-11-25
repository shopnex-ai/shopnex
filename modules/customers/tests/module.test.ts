// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder, and the route
// groups it was mounted with.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { customersModule } = await import('../src/customers.module')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('customers manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 3)
    assert.deepEqual(new Set(Object.values(customersModule.tables)), exported)
  })

  test('the name is the folder, and the route groups are the ones it was mounted with', () => {
    assert.equal(customersModule.name, 'customers')
    assert.deepEqual(Object.keys(customersModule.router), ['customers'])
    assert.deepEqual(Object.keys(customersModule.router.customers), ['deleteMany', 'list', 'get', 'create', 'update'])
  })
})
