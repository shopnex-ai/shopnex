import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickApp, type AppDef } from '../src/apps'
import { UsageError } from '../src/errors'

const app = (name: string): AppDef => ({ name, label: name, hint: '', plan: () => ({}) as never })

test('one app: nothing is asked, even in a terminal', async () => {
  assert.equal((await pickApp(undefined, { interactive: true, list: [app('shop')] })).name, 'shop')
})

test('several apps without a terminal: the first one, no prompt', async () => {
  assert.equal((await pickApp(undefined, { interactive: false, list: [app('shop'), app('other')] })).name, 'shop')
})

test('--app picks by name, and an unknown name lists the available ones', async () => {
  const list = [app('shop'), app('other')]
  assert.equal((await pickApp('other', { interactive: false, list })).name, 'other')
  await assert.rejects(pickApp('nope', { interactive: false, list }), (error: Error) => {
    assert.ok(error instanceof UsageError)
    assert.match(error.message, /Available: shop, other/)
    return true
  })
})
