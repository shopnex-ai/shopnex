// The database an app opens for tables of its own (a schema of its own in Postgres, or the embedded PGlite): the
// schema is created, its data survives a restart, and migrations are recorded in it.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import { openAppDatabase } from '@shopnex/app/store'

const dir = mkdtempSync(join(tmpdir(), 'app-database-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const postgres = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '') ? process.env.DATABASE_URL : undefined
const targets = [
  { name: 'embedded (PGlite)', url: `pglite:${join(dir, 'pglite')}` },
  ...(postgres ? [{ name: 'Postgres', url: postgres }] : []),
]

for (const target of targets) {
  describe(`openAppDatabase on ${target.name}`, () => {
    // A schema per run: the shared database is left as it was found
    const schema = `app_test_${randomBytes(4).toString('hex')}`
    const open = () => openAppDatabase({ databaseUrl: target.url, schema })
    after(async () => {
      if (target.url.startsWith('pglite:')) return
      const database = await open()
      await database.db.execute(sql.raw(`DROP SCHEMA "${schema}" CASCADE`))
      await database.close()
    })

    test('creates its schema and keeps its tables across restarts', async () => {
      const first = await open()
      await first.db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${schema}".notes (id int PRIMARY KEY, body text)`))
      await first.db.execute(sql.raw(`INSERT INTO "${schema}".notes VALUES (1, 'kept') ON CONFLICT DO NOTHING`))
      await first.close()

      const second = await open()
      const rows = await second.db.execute(sql.raw(`SELECT body FROM "${schema}".notes`))
      assert.match(JSON.stringify(rows), /kept/)
      await second.close()
    })
  })
}

describe('openAppDatabase without its settings', () => {
  const saved = { url: process.env.APP_DATABASE_URL, db: process.env.DATABASE_URL }
  after(() => {
    for (const [name, value] of [
      ['APP_DATABASE_URL', saved.url],
      ['DATABASE_URL', saved.db],
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  test("refuses to start without a database, and does not share the shop's embedded one", async () => {
    delete process.env.APP_DATABASE_URL
    delete process.env.DATABASE_URL
    await assert.rejects(openAppDatabase(), /APP_DATABASE_URL is not set/)
    process.env.DATABASE_URL = 'pglite:/some/shop/data'
    await assert.rejects(openAppDatabase(), /APP_DATABASE_URL is not set/)
  })

  test('refuses a schema name that is not plain', async () => {
    await assert.rejects(openAppDatabase({ databaseUrl: 'pglite:memory', schema: 'a"; drop' }), /Invalid schema name/)
  })
})
