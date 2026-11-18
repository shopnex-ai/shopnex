// The manifest must say what the module really has: every table its *.schema.ts files export, a name that is the folder, the route
// groups it was mounted with, and the listener it registers on orders' hook.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { emailModule } = await import('../src/email.module')
const { orderEvent } = await import('@shopnex/orders')
const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

describe('email manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${srcDir}${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 5)
    assert.deepEqual(new Set(Object.values(emailModule.tables)), exported)
  })

  test('the name is the folder, and the route groups are the ones it was mounted with', () => {
    assert.equal(emailModule.name, 'email')
    assert.deepEqual(Object.keys(emailModule.router).sort(), ['email', 'notifications'])
  })

  test('loading the module makes it listen to orderEvent', () => {
    assert.deepEqual([...orderEvent.listeners], ['email.notifications'])
  })
})
