// core is the tables every module points at. The manifest must list exactly the tables its schema file exports, and the package must
// stay at the bottom of the graph: nothing of ours but the module kit, or @shopnex/db (which re-exports it and whose other tables
// point at it) could not depend on it without a cycle.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

const { coreModule } = await import('../src/core.module')
const root = fileURLToPath(new URL('..', import.meta.url))

describe('core manifest', () => {
  test('tables lists every table the schema files export', async () => {
    const exported = new Set<unknown>()
    for (const file of readdirSync(`${root}src`).filter((f) => f.endsWith('.schema.ts'))) {
      const schema = (await import(`${root}src/${file}`)) as Record<string, unknown>
      for (const value of Object.values(schema)) if (is(value, PgTable)) exported.add(value)
    }
    assert.equal(exported.size, 4)
    assert.deepEqual(new Set(Object.values(coreModule.tables)), exported)
    assert.deepEqual(Object.keys(coreModule.tables).sort(), ['apiTokens', 'apps', 'shops', 'user'])
  })

  test('the name is the folder, and it depends on no module', () => {
    assert.equal(coreModule.name, 'core')
    assert.deepEqual([...(coreModule.dependsOn ?? [])], [])
  })

  test('the package depends on the module kit and drizzle only, and its code imports no other @shopnex package', () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { dependencies: Record<string, string> }
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@shopnex/kit', 'drizzle-orm'])
    for (const file of readdirSync(`${root}src`)) {
      const imports = [...readFileSync(`${root}src/${file}`, 'utf8').matchAll(/from '(@shopnex\/[^']+)'/g)].map(
        (m) => m[1],
      )
      for (const spec of imports) assert.ok(spec === '@shopnex/kit', `${file} imports ${spec}`)
    }
  })

  test('the tables are the ones with the names the database has', () => {
    const names = Object.values(coreModule.tables).map(
      (t) => (t as unknown as { [k: symbol]: string })[Symbol.for('drizzle:Name')],
    )
    assert.deepEqual(names.sort(), ['api_tokens', 'apps', 'shops', 'user'])
  })
})
