// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder, and the
// statuses the Admin API answered with before the errors were declared in ai.errors.ts.
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

const { aiModule } = await import('../src/ai.module')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('ai manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 3)
    assert.deepEqual(new Set(Object.values(aiModule.tables)), exported)
  })

  test('the name is the folder', () => {
    assert.equal(aiModule.name, 'ai')
  })

  test('each error code answers with the status it always did', async () => {
    const { AiError } = await import('../src/ai.errors')
    const expected = {
      NOT_AN_AI_APP: 'FORBIDDEN',
      INVALID_PROVIDER_URL: 'BAD_REQUEST',
      CAPABILITY_UNAVAILABLE: 'BAD_REQUEST',
      SUBJECT_NOT_FOUND: 'NOT_FOUND',
      SUBJECT_REQUIRED: 'BAD_REQUEST',
      GENERATION_NOT_FOUND: 'NOT_FOUND',
      PROVIDER_FAILED: 'BAD_GATEWAY',
      KEY_REQUIRED: 'BAD_REQUEST',
      INVALID_PROVIDER_KEY: 'BAD_REQUEST',
    } as const
    for (const [code, status] of Object.entries(expected)) {
      const mapped = domainErrorMapper(new AiError(code as keyof typeof expected, `message of ${code}`))
      assert.ok(mapped instanceof ORPCError, code)
      assert.equal(mapped.code, status, code)
    }
  })

  test('the routes are there, under the names they were mounted with', () => {
    assert.deepEqual(Object.keys(aiModule.router).sort(), ['ai', 'aiApp', 'aiSettings'])
    assert.deepEqual(Object.keys(aiModule.router.ai).sort(), ['capabilities', 'feedback', 'run'])
    assert.deepEqual(Object.keys(aiModule.router.aiSettings).sort(), ['get', 'turnOff', 'update'])
  })
})
