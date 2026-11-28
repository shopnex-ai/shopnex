// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder,
// and the operations the Admin API has always had for themes.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { themeModule } = await import('../src/theme.module')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('theme manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 2)
    assert.deepEqual(new Set(Object.values(themeModule.tables)), exported)
  })

  test('the name is the folder, and the routes are the ones themes always had', () => {
    assert.equal(themeModule.name, 'theme')
    assert.deepEqual(Object.keys(themeModule.router).sort(), [
      'add',
      'addFromStore',
      'delete',
      'deleteFile',
      'discardCode',
      'discardDraft',
      'duplicate',
      'ensure',
      'files',
      'get',
      'list',
      'previewToken',
      'publish',
      'publishCode',
      'rename',
      'saveDraft',
      'saveFile',
      'store',
    ])
  })
})
