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
// An app's identity comes from its environment (its <NAME>_APP_KEY), not from a file
const APP_KEY = `snxk_${randomBytes(16).toString('hex')}`
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
    const open = () => openLocalStore({ appKey: APP_KEY, databaseUrl: target.url, schema })
    after(async () => {
      if (target.url.startsWith('pglite:')) return
      const store = await open()
      await store.db.execute(sql.raw(`DROP SCHEMA "${schema}" CASCADE`))
      await store.close()
    })

    test('keeps its data across restarts and takes its identity from the key it is given', async () => {
      const first = await open()
      assert.equal(first.appKey, APP_KEY)
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

describe('openLocalStore without its settings', () => {
  const saved = { key: process.env.SHOPNEX_APP_KEY, url: process.env.APP_DATABASE_URL, db: process.env.DATABASE_URL }
  after(() => {
    for (const [name, value] of [
      ['SHOPNEX_APP_KEY', saved.key],
      ['STRIPE_APP_KEY', undefined],
      ['APP_DATABASE_URL', saved.url],
      ['DATABASE_URL', saved.db],
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  test('refuses to start without the app key, and says how to make one', async () => {
    delete process.env.SHOPNEX_APP_KEY
    await assert.rejects(openLocalStore({ databaseUrl: 'pglite:memory' }), /SHOPNEX_APP_KEY is not set.*app-keygen/)
    await assert.rejects(openLocalStore({ appKey: 'not-a-key', databaseUrl: 'pglite:memory' }), /SHOPNEX_APP_KEY/)
  })

  test('an app takes its key from its own variable, and a shared SHOPNEX_APP_KEY is only the fallback', async () => {
    delete process.env.SHOPNEX_APP_KEY
    delete process.env.STRIPE_APP_KEY
    await assert.rejects(
      openLocalStore({ databaseUrl: 'pglite:memory', appKeyEnv: 'STRIPE_APP_KEY' }),
      /STRIPE_APP_KEY is not set/,
    )
    process.env.SHOPNEX_APP_KEY = `snxk_${randomBytes(8).toString('hex')}`
    process.env.STRIPE_APP_KEY = `snxk_${randomBytes(8).toString('hex')}`
    const own = await openLocalStore({ databaseUrl: 'pglite:memory', appKeyEnv: 'STRIPE_APP_KEY' })
    assert.equal(own.appKey, process.env.STRIPE_APP_KEY)
    await own.close()
    delete process.env.STRIPE_APP_KEY
    const shared = await openLocalStore({ databaseUrl: 'pglite:memory', appKeyEnv: 'STRIPE_APP_KEY' })
    assert.equal(shared.appKey, process.env.SHOPNEX_APP_KEY)
    await shared.close()
  })

  test("refuses to start without a database, and does not share the shop's embedded one", async () => {
    delete process.env.APP_DATABASE_URL
    delete process.env.DATABASE_URL
    await assert.rejects(openLocalStore({ appKey: APP_KEY }), /APP_DATABASE_URL is not set/)
    process.env.DATABASE_URL = 'pglite:/some/shop/data'
    await assert.rejects(openLocalStore({ appKey: APP_KEY }), /APP_DATABASE_URL is not set/)
  })
})
