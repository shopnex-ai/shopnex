// The manifest must say what the module really has: every table its *.schema.ts files export and a name that is the folder.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

const { draftsModule } = await import('../src/drafts.module')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('drafts manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 1)
    assert.deepEqual(new Set(Object.values(draftsModule.tables)), exported)
  })

  test('the name is the folder', () => {
    assert.equal(draftsModule.name, 'drafts')
  })
})
