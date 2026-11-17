import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { defineHook } from '../src'

type Conn = { name: string }
const conn: Conn = { name: 'tx' }
let n = 0
const fresh = () => defineHook<{ shopId: string }, Conn>(`test.hook.${++n}`)

describe('defineHook', () => {
  test('runs every listener, in the order they were added, with the caller’s connection and the payload', async () => {
    const hook = fresh()
    const seen: string[] = []
    hook.on('a', (c, p) => void seen.push(`a:${c.name}:${p.shopId}`))
    hook.on('b', async (c, p) => {
      await Promise.resolve()
      seen.push(`b:${c.name}:${p.shopId}`)
    })
    await hook.run(conn, { shopId: 's1' })
    assert.deepEqual(seen, ['a:tx:s1', 'b:tx:s1'])
  })

  test('a listener added again under the same id replaces the first, so a module loaded twice does not run twice', async () => {
    const hook = fresh()
    const calls: string[] = []
    hook.on('payments', () => void calls.push('old'))
    hook.on('payments', () => void calls.push('new'))
    await hook.run(conn, { shopId: 's' })
    assert.deepEqual(calls, ['new'])
    assert.deepEqual(hook.listeners, ['payments'])
  })

  test('the first listener that throws stops the rest, and the error reaches the caller (its transaction rolls back)', async () => {
    const hook = fresh()
    const calls: string[] = []
    hook.on('a', () => void calls.push('a'))
    hook.on('boom', () => {
      throw new Error('cleanup failed')
    })
    hook.on('c', () => void calls.push('c'))
    await assert.rejects(hook.run(conn, { shopId: 's' }), /cleanup failed/)
    assert.deepEqual(calls, ['a'])
  })

  test('with no listener, running does nothing', async () => {
    await fresh().run(conn, { shopId: 's' })
  })

  test('two copies of the package see the same listeners: the hook is found by its name', async () => {
    const owner = defineHook<{ shopId: string }, Conn>('test.shared.hook')
    const otherCopy = defineHook<{ shopId: string }, Conn>('test.shared.hook')
    const calls: string[] = []
    otherCopy.on('payments', (_c, p) => void calls.push(p.shopId))
    await owner.run(conn, { shopId: 's9' })
    assert.deepEqual(calls, ['s9'])
    assert.deepEqual(owner.listeners, ['payments'])
  })
})
