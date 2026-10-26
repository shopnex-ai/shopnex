// The SQLite store apps use for their own data: the identity survives a restart, shops stay apart, and secrets
// are sealed in the database.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { openLocalStore } from '@shopnex/app/store'

const dir = mkdtempSync(join(tmpdir(), 'local-store-'))
after(() => rmSync(dir, { recursive: true, force: true }))

describe('openLocalStore', () => {
  test('keeps its identity and data across restarts', async () => {
    const first = await openLocalStore({ dir })
    assert.match(first.appKey, /^snxk_/)
    await first.dataFor('https://a.example', 's1').set('config', { mode: 'test' })
    first.db.close()

    const second = await openLocalStore({ dir })
    assert.equal(second.appKey, first.appKey)
    assert.deepEqual(await second.dataFor('https://a.example', 's1').get('config'), { mode: 'test' })
    second.db.close()
  })

  test('keeps shops and instances apart; delete removes', async () => {
    const store = await openLocalStore({ dir })
    const a = store.dataFor('https://a.example', 's1')
    const b = store.dataFor('https://a.example', 's2')
    const c = store.dataFor('https://b.example', 's1')
    await a.set('k', 1)
    assert.equal(await b.get('k'), null)
    assert.equal(await c.get('k'), null)
    await a.delete('k')
    assert.equal(await a.get('k'), null)
    store.db.close()
  })

  test('secrets are sealed in the database and read back', async () => {
    const store = await openLocalStore({ dir })
    const data = store.dataFor('https://a.example', 's1')
    await data.setSecret('stripe_secret_key', 'sk_test_plain')
    assert.equal(await data.getSecret('stripe_secret_key'), 'sk_test_plain')
    const row = store.db.prepare('SELECT value FROM kv WHERE key = ?').get('stripe_secret_key') as { value: string }
    assert.ok(!row.value.includes('sk_test_plain'))
    store.db.close()
    assert.ok(!readFileSync(join(dir, 'app.db')).includes('sk_test_plain'))
  })
})
