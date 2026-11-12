// The draft queries on a real in-memory database (PGlite): saving, merging, discarding and publishing.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'

const { db, prepareDatabase } = await import('@shopnex/db')
const { DraftConflictError, discard, get, patch, publish } = await import('../src/drafts')

const SHOP = 'default'
const TYPE = 'theme'

before(async () => {
  await prepareDatabase()
})

after(() => {
  // The embedded database keeps the process alive
  setImmediate(() => process.exit())
})

describe('drafts on the database', () => {
  test('an entity with no draft has an empty one at rev 0', async () => {
    assert.deepEqual(await get(SHOP, TYPE, 'a', db), { changes: {}, rev: 0 })
  })

  test('saving creates the draft at rev 1, and each save after it bumps the rev and merges key by key', async () => {
    assert.equal(await patch(SHOP, TYPE, 'b', { title: 'One' }, db), 1)
    assert.equal(await patch(SHOP, TYPE, 'b', { vendor: 'Acme' }, db), 2)
    assert.equal(await patch(SHOP, TYPE, 'b', { title: 'Two' }, db), 3)
    assert.deepEqual(await get(SHOP, TYPE, 'b', db), { changes: { title: 'Two', vendor: 'Acme' }, rev: 3 })
  })

  test('discarding empties the draft and returns the new rev; with no draft it returns 0', async () => {
    await patch(SHOP, TYPE, 'c', { title: 'x' }, db)
    assert.equal(await discard(SHOP, TYPE, 'c', db), 2)
    assert.deepEqual(await get(SHOP, TYPE, 'c', db), { changes: {}, rev: 2 })
    assert.equal(await discard(SHOP, TYPE, 'nothing', db), 0)
  })

  test('publishing applies the changes in a transaction, clears the draft and bumps the rev', async () => {
    await patch(SHOP, TYPE, 'd', { title: 'New' }, db)
    const applied: unknown[] = []
    const result = await publish(SHOP, TYPE, 'd', async (_tx, changes) => (applied.push(changes), 'done'), {}, db)
    assert.deepEqual(result, { published: true, rev: 2, value: 'done' })
    assert.deepEqual(applied, [{ title: 'New' }])
    assert.deepEqual(await get(SHOP, TYPE, 'd', db), { changes: {}, rev: 2 })
  })

  test('there is nothing to publish without a draft or with an empty one, and apply is not called', async () => {
    let calls = 0
    const apply = async () => void calls++
    assert.deepEqual(await publish(SHOP, TYPE, 'none', apply, {}, db), { published: false, rev: 0 })
    await patch(SHOP, TYPE, 'e', { title: 'x' }, db)
    await discard(SHOP, TYPE, 'e', db)
    assert.deepEqual(await publish(SHOP, TYPE, 'e', apply, {}, db), { published: false, rev: 2 })
    assert.equal(calls, 0)
  })

  test('a stale tab cannot publish: a different rev than the draft has throws a conflict', async () => {
    await patch(SHOP, TYPE, 'f', { title: 'x' }, db)
    await assert.rejects(
      publish(SHOP, TYPE, 'f', async () => 'never', { expectedRev: 5 }, db),
      (error: unknown) => error instanceof DraftConflictError && error.rev === 1,
    )
    assert.deepEqual((await get(SHOP, TYPE, 'f', db)).changes, { title: 'x' })
  })

  test('a failing apply keeps the draft', async () => {
    await patch(SHOP, TYPE, 'g', { title: 'x' }, db)
    await assert.rejects(
      publish(SHOP, TYPE, 'g', async () => Promise.reject(new Error('boom')), {}, db),
      /boom/,
    )
    assert.deepEqual(await get(SHOP, TYPE, 'g', db), { changes: { title: 'x' }, rev: 1 })
  })

  test('drafts of different entities are separate', async () => {
    await patch(SHOP, TYPE, 'h', { title: 'h' }, db)
    await patch(SHOP, TYPE, 'i', { title: 'i' }, db)
    assert.deepEqual((await get(SHOP, TYPE, 'h', db)).changes, { title: 'h' })
    assert.deepEqual((await get(SHOP, 'page', 'h', db)).changes, {})
  })
})
