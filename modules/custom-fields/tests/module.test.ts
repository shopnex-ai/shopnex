// The manifest must say what the module really has: every table its *.schema.ts files export (drizzle-kit and the
// privacy test find tables by those files, the manifest is what the rest of the code reads), and a name and
// dependencies that match the folder (`pnpm modules:check` compares dependsOn with package.json and the imports).
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ORPCError } from '@orpc/server'
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

  // The statuses the Admin API answered with before they were declared in custom-fields.errors.ts
  test('each error code answers with the status it always did', async () => {
    const { CustomFieldError } = await import('../src/custom-fields.errors')
    const expected = { FIELD_NOT_FOUND: 'NOT_FOUND', KEY_TAKEN: 'CONFLICT', INVALID_VALUE: 'BAD_REQUEST' } as const
    for (const [code, status] of Object.entries(expected)) {
      const cause = new CustomFieldError(code as keyof typeof expected, `message of ${code}`)
      const mapped = customFieldsModule.errors(cause)
      assert.ok(mapped instanceof ORPCError, code)
      assert.equal(mapped.code, status, code)
      assert.equal(mapped.message, `message of ${code}`)
      assert.deepEqual(mapped.data, { code })
      assert.equal(mapped.cause, cause)
    }
  })

  test('an error that is not this module is left alone', () => {
    assert.equal(customFieldsModule.errors(new Error('boom')), undefined)
    assert.equal(customFieldsModule.errors('text'), undefined)
  })

  test('the routes and the error mapper are there', () => {
    assert.equal(typeof customFieldsModule.errors, 'function')
    assert.ok(Object.keys(customFieldsModule.router).length >= 4)
  })
})
