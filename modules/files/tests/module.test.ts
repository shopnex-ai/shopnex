// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder, and
// the statuses the Admin API answered with before they were declared in files.errors.ts (every code was a 400).
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ORPCError } from '@orpc/server'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { filesModule } = await import('../src/files.module')
const { FilesError } = await import('../src/files.errors')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('files manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 2)
    assert.deepEqual(new Set(Object.values(filesModule.tables)), exported)
  })

  test('the name is the folder, and the routes are the files and the storage settings', () => {
    assert.equal(filesModule.name, 'files')
    assert.deepEqual(Object.keys(filesModule.router).sort(), ['files', 'storage'])
    assert.deepEqual(Object.keys(filesModule.router.files).sort(), ['delete', 'list', 'upload'])
    assert.deepEqual(Object.keys(filesModule.router.storage).sort(), ['get', 'test', 'update'])
  })

  test('each error code answers 400, as it always did', () => {
    for (const code of ['FILE_TOO_LARGE', 'UNSUPPORTED_TYPE', 'STORAGE_FAILED', 'SECRET_REQUIRED'] as const) {
      const cause = new FilesError(code, `message of ${code}`)
      const mapped = filesModule.errors(cause)
      assert.ok(mapped instanceof ORPCError, code)
      assert.equal(mapped.code, 'BAD_REQUEST', code)
      assert.equal(mapped.message, `message of ${code}`)
      assert.deepEqual(mapped.data, { code })
      assert.equal(mapped.cause, cause)
    }
  })

  test('an error that is not this module is left alone', () => {
    assert.equal(filesModule.errors(new Error('boom')), undefined)
  })
})
