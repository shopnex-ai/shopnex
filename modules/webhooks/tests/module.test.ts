// The manifest must say what the module really has: every table its *.schema.ts files export and a name that is the folder.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { webhooksModule } = await import('../src/webhooks.module')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('webhooks manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 2)
    assert.deepEqual(new Set(Object.values(webhooksModule.tables)), exported)
  })

  test('the name is the folder', () => {
    assert.equal(webhooksModule.name, 'webhooks')
  })

  test('the routes are there, under the names they were mounted with', () => {
    assert.deepEqual(Object.keys(webhooksModule.router).sort(), [
      'create',
      'delete',
      'deliveries',
      'list',
      'redeliver',
      'rotateSecret',
      'sendTest',
      'update',
    ])
  })
})
