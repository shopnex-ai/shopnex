// The manifest must say what the module really has, errors answer with the right status, and the theme setting ids the
// importer writes must exist in the theme it writes them to.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ORPCError } from '@orpc/server'
import { domainErrorMapper } from '@shopnex/rpc'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { storeImportModule } = await import('../src/store-import.module')
const { StoreImportError } = await import('../src/store-import.errors')
const { STOREPLATE_SETTINGS } = await import('../src/brand')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('store-import manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 1)
    assert.deepEqual(new Set(Object.values(storeImportModule.tables)), exported)
  })

  test('the name is the folder, and the routes are the store import', () => {
    assert.equal(storeImportModule.name, 'store-import')
    assert.deepEqual(Object.keys(storeImportModule.router), ['storeImport'])
    assert.deepEqual(Object.keys(storeImportModule.router.storeImport).sort(), ['get', 'overview', 'start'])
  })

  test('each error code answers with its status', () => {
    const expected = {
      INVALID_STORE_ADDRESS: 'BAD_REQUEST',
      STORE_NOT_READABLE: 'BAD_REQUEST',
      IMPORT_RUNNING: 'CONFLICT',
      IMPORT_LIMIT: 'TOO_MANY_REQUESTS',
      CURRENCY_MISMATCH: 'CONFLICT',
    } as const
    for (const [code, status] of Object.entries(expected)) {
      const mapped = domainErrorMapper(new StoreImportError(code as keyof typeof expected, `message of ${code}`))
      assert.ok(mapped instanceof ORPCError, code)
      assert.equal(mapped.code, status, code)
    }
  })
})

describe('the Storeplate settings the importer writes', () => {
  const theme = JSON.parse(
    readFileSync(new URL('../../../templates/storefront/themes/storeplate/theme.json', import.meta.url), 'utf8'),
  ) as { settings: { id: string }[] }
  const ids = new Set(theme.settings.map((s) => s.id))

  test('exist in its theme.json', () => {
    for (const id of Object.values(STOREPLATE_SETTINGS)) assert.ok(ids.has(id), `${id} is not a Storeplate setting`)
  })

  test('include a link setting for every network the importer reads', () => {
    for (const network of ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'pinterest']) {
      assert.ok(ids.has(`${network}_url`), `${network}_url`)
    }
  })
})
