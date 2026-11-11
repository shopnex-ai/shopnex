// The store apps use for their own data (a schema of their own in Postgres, or the embedded PGlite): the identity
// survives a restart, shops stay apart, and secrets are sealed in the database.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import { openLocalStore } from '@shopnex/app/store'

const dir = mkdtempSync(join(tmpdir(), 'local-store-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const postgres = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '') ? process.env.DATABASE_URL : undefined
const targets = [
  { name: 'embedded (PGlite)', url: `pglite:${join(dir, 'pglite')}` },
  ...(postgres ? [{ name: 'Postgres', url: postgres }] : []),
]

for (const target of targets) {
  describe(`openLocalStore on ${target.name}`, () => {
    // A schema per run: the shared database is left as it was found
    const schema = `app_test_${randomBytes(4).toString('hex')}`
    const open = () => openLocalStore({ dir, databaseUrl: target.url, schema })
    after(async () => {
      if (target.url.startsWith('pglite:')) return
      const store = await open()
      await store.db.execute(sql.raw(`DROP SCHEMA "${schema}" CASCADE`))
      await store.close()
    })

    test('keeps its identity and data across restarts', async () => {
      const first = await open()
      assert.match(first.appKey, /^snxk_/)
      await first.dataFor('https://a.example', 's1').set('config', { mode: 'test' })
      await first.close()

      const second = await open()
      assert.equal(second.appKey, first.appKey)
      assert.deepEqual(await second.dataFor('https://a.example', 's1').get('config'), { mode: 'test' })
      await second.close()
    })

    test('keeps shops and instances apart; overwrite and delete work', async () => {
      const store = await open()
      const a = store.dataFor('https://a.example', 's1')
      const b = store.dataFor('https://a.example', 's2')
      const c = store.dataFor('https://b.example', 's1')
      await a.set('k', 1)
      await a.set('k', 2)
      assert.equal(await a.get('k'), 2)
      assert.equal(await b.get('k'), null)
      assert.equal(await c.get('k'), null)
      await a.delete('k')
      assert.equal(await a.get('k'), null)
      await store.close()
    })

    test('secrets are sealed in the database and read back', async () => {
      const store = await open()
      const data = store.dataFor('https://a.example', 's1')
      await data.setSecret('stripe_secret_key', 'sk_test_plain')
      assert.equal(await data.getSecret('stripe_secret_key'), 'sk_test_plain')
      const rows = await store.db.execute(sql.raw(`SELECT value FROM "${schema}".kv`))
      assert.ok(!JSON.stringify(rows).includes('sk_test_plain'))
      await store.close()
    })
  })
}
