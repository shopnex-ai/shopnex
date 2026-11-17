// emit: what is queued, for whom, and that it is the caller's transaction that decides (outbox).
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, SHOP, OTHER_SHOP } = fx
const { emit } = await import('../src/emit')

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('emit', () => {
  test('queues one delivery per active endpoint subscribed to the topic, with the envelope as its body', async () => {
    const a = await fx.endpoint({ topics: ['order.created', 'order.paid'] })
    const b = await fx.endpoint({ topics: ['order.created'] })
    await emit(db, SHOP, 'order.created', () => ({ id: 'o1' }))

    for (const e of [a, b]) {
      const [d] = await fx.deliveriesOf(e.id)
      assert.equal(d!.topic, 'order.created')
      assert.equal(d!.status, 'pending')
      assert.equal(d!.attempts, 0)
      const body = JSON.parse(d!.body) as Record<string, unknown>
      assert.deepEqual(Object.keys(body), ['type', 'timestamp', 'shopId', 'data'])
      assert.equal(body.type, 'order.created')
      assert.equal(body.shopId, SHOP)
      assert.deepEqual(body.data, { id: 'o1' })
      assert.ok(!Number.isNaN(Date.parse(body.timestamp as string)))
    }
  })

  test('leaves out an endpoint that is off, subscribed to something else, or another shop’s', async () => {
    const off = await fx.endpoint({ active: false })
    const other = await fx.endpoint({ topics: ['product.created'] })
    const foreign = await fx.endpoint({ shopId: OTHER_SHOP })
    await emit(db, SHOP, 'order.created', () => ({}))
    for (const e of [off, other, foreign]) assert.equal((await fx.deliveriesOf(e.id)).length, 0)
  })

  test('the payload is only built when someone is subscribed', async () => {
    let built = 0
    await emit(db, SHOP, 'order.created', () => ++built)
    assert.equal(built, 0)
    const e = await fx.endpoint()
    await emit(db, SHOP, 'order.created', () => ++built)
    assert.equal(built, 1)
    assert.equal((await fx.deliveriesOf(e.id)).length, 1)
  })

  test('the deliveries are the caller’s transaction’s: rolled back with it, and the payload sees its writes', async () => {
    const e = await fx.endpoint()
    await assert.rejects(
      db.transaction(async (tx) => {
        await emit(tx, SHOP, 'order.created', () => ({ id: 'rolled-back' }))
        throw new Error('the change failed')
      }),
      /the change failed/,
    )
    assert.equal((await fx.deliveriesOf(e.id)).length, 0)

    await db.transaction((tx) => emit(tx, SHOP, 'order.created', () => ({ id: 'committed' })))
    assert.equal((await fx.deliveriesOf(e.id)).length, 1)
  })
})
