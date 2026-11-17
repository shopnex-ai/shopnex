// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder, and the
// route groups it was mounted with.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { contentModule } = await import('../src/content.module')
const { shopCreated } = await import('@shopnex/tenancy')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('content manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 2)
    assert.deepEqual(new Set(Object.values(contentModule.tables)), exported)
  })

  test('the name is the folder, and the route groups are the ones it was mounted with', () => {
    assert.equal(contentModule.name, 'content')
    assert.deepEqual(Object.keys(contentModule.router).sort(), ['menus', 'pages'])
  })

  test('loading the module makes it listen to shopCreated', () => {
    assert.ok(shopCreated.listeners.includes('content.menus'))
  })
})
