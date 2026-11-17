// The manifest must say what the module really has: every table its *.schema.ts files export (drizzle-kit and the
// privacy test find tables by those files, the manifest is what the rest of the code reads), and a name and
// dependencies that match the folder (`pnpm modules:check` compares dependsOn with package.json and the imports).
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { customFieldsModule } = await import('../src/custom-fields.module')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('custom-fields manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.ok(exported.size > 0)
    assert.deepEqual(new Set(Object.values(customFieldsModule.tables)), exported)
  })

  test('the name is the folder', () => {
    assert.equal(customFieldsModule.name, 'custom-fields')
  })

  test('the routes and the error mapper are there', () => {
    assert.equal(typeof customFieldsModule.errors, 'function')
    assert.ok(Object.keys(customFieldsModule.router).length >= 4)
  })
})
