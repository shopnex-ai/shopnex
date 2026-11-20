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

const { languagesModule } = await import('../src/languages.module')
const { LanguageError } = await import('../src/languages.errors')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('languages manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 2)
    assert.deepEqual(new Set(Object.values(languagesModule.tables)), exported)
  })

  test('the name is the folder, and the routes are the languages and their translations', () => {
    assert.equal(languagesModule.name, 'languages')
    assert.deepEqual(Object.keys(languagesModule.router).sort(), ['list', 'publish', 'translations', 'unpublish'])
    assert.deepEqual(Object.keys(languagesModule.router.translations).sort(), ['list', 'set'])
  })

  test('each error code answers with its status', () => {
    const expected = {
      LANGUAGE_NOT_PUBLISHED: 'BAD_REQUEST',
      INVALID_FIELD: 'BAD_REQUEST',
      TOO_MANY_LANGUAGES: 'BAD_REQUEST',
    } as const
    for (const [code, status] of Object.entries(expected)) {
      const cause = new LanguageError(code as keyof typeof expected, `message of ${code}`)
      const mapped = domainErrorMapper(cause)
      assert.ok(mapped instanceof ORPCError, code)
      assert.equal(mapped.code, status, code)
      assert.deepEqual(mapped.data, { code })
    }
  })
})
