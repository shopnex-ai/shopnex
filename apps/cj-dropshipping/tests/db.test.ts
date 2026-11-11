// The app's tables on the embedded database, created by the committed migration
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { ShopContext } from '@shopnex/app'
import { openLocalStore, type LocalStore } from '@shopnex/app/store'
import { openTables, type Tables } from '../src/db'
import { migrationsFolder } from '../src/migrations'
import { SCHEMA } from '../src/schema'

const dir = mkdtempSync(join(tmpdir(), 'cj-db-'))
const shop = (shopId: string) => ({ instance: 'https://a.example', shopId }) as ShopContext
let store: LocalStore
let tables: Tables

before(async () => {
  store = await openLocalStore({ appKey: 'snxk_test', databaseUrl: 'pglite:memory', schema: SCHEMA })
  await store.migrate(migrationsFolder())
  await store.migrate(migrationsFolder()) // applying twice is a no-op
  tables = openTables(store.db)
})
after(async () => {
  await store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('variants and availability', () => {
  test('a variant is found by SKU, per shop, and re-saving replaces it', async () => {
    await tables.saveVariant(shop('s1'), 'SKU-1', 'p1', 'v1')
    await tables.saveVariant(shop('s1'), 'SKU-1', 'p1', 'v2')
    assert.deepEqual(await tables.findVariant(shop('s1'), 'SKU-1'), { pid: 'p1', vid: 'v2' })
    assert.equal(await tables.findVariant(shop('s2'), 'SKU-1'), undefined)
    await tables.saveVariant(shop('s1'), 'SKU-2', 'p1', 'v3')
    assert.deepEqual((await tables.linkedSkus(shop('s1'))).get('p1')?.sort(), ['SKU-1', 'SKU-2'])
  })

  test('availability is remembered with when it was checked', async () => {
    await tables.setAvailable(shop('s1'), 'p1', false)
    const known = (await tables.availability(shop('s1'))).get('p1')
    assert.equal(known?.available, false)
    assert.ok(typeof known?.checkedAt === 'number' && known.checkedAt > 1_000_000_000_000)
    await tables.setAvailable(shop('s1'), 'p1', true)
    assert.equal((await tables.availability(shop('s1'))).get('p1')?.available, true)
  })
})

describe('forwarded orders', () => {
  test('an order is claimed once; a failed one can be taken again', async () => {
    const s = shop('s1')
    assert.equal(await tables.claimOrder(s, 'o1', 1001), true)
    assert.equal(await tables.claimOrder(s, 'o1', 1001), false)
    await tables.setOrder(s, 'o1', 'failed', { error: 'CJ is down' })
    assert.equal(await tables.claimOrder(s, 'o1', 1001), true)
    assert.equal((await tables.orders(s))[0].error, null)
  })

  test('keeps the CJ id and tracking number when a later update has none', async () => {
    const s = shop('s1')
    await tables.setOrder(s, 'o1', 'created', { cjOrderId: 'cj-9' })
    assert.deepEqual(await tables.awaitingTracking(s), [{ order_id: 'o1', cj_order_id: 'cj-9' }])
    assert.deepEqual(await tables.shopsAwaitingTracking(), [{ instance: s.instance, shop_id: 's1' }])
    await tables.setOrder(s, 'o1', 'fulfilled', { trackingNumber: 'TRK1' })
    const [order] = await tables.orders(s)
    assert.deepEqual(
      { status: order.status, cjOrderId: order.cjOrderId, trackingNumber: order.trackingNumber },
      { status: 'fulfilled', cjOrderId: 'cj-9', trackingNumber: 'TRK1' },
    )
    assert.deepEqual(await tables.awaitingTracking(s), [])
  })

  test('lists newest first and drops an order', async () => {
    const s = shop('s3')
    await tables.claimOrder(s, 'a', 1)
    await tables.claimOrder(s, 'b', 2)
    assert.deepEqual(
      (await tables.orders(s)).map((o) => o.orderNumber),
      [2, 1],
    )
    await tables.dropOrder(s, 'b')
    assert.deepEqual(
      (await tables.orders(s)).map((o) => o.orderId),
      ['a'],
    )
  })
})
