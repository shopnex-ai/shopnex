// Products the app ships are marked fulfilledBy it, so other carrier apps leave them alone
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ShopContext } from '@shopnex/app'
import { CLIENT_ID, markFulfilled } from '../src/import'

type P = { id: string; fulfilledBy: string | null; variants: { sku: string | null }[] }

function shopWith(items: P[]) {
  const patched: { path: string; body: unknown }[] = []
  const shop = {
    admin: {
      get: async () => ({ items, total: items.length }),
      patch: async (path: string, body: unknown) => void patched.push({ path, body }),
    },
  } as unknown as ShopContext
  return { shop, patched }
}

describe('markFulfilled', () => {
  test('marks the products with one of the SKUs, once', async () => {
    const { shop, patched } = shopWith([
      { id: 'a', fulfilledBy: null, variants: [{ sku: 'CJ-1' }, { sku: 'CJ-2' }] },
      { id: 'b', fulfilledBy: null, variants: [{ sku: 'MUG' }] },
      { id: 'c', fulfilledBy: CLIENT_ID, variants: [{ sku: 'CJ-3' }] },
      { id: 'd', fulfilledBy: null, variants: [{ sku: null }] },
    ])
    const changed = await markFulfilled(shop, new Set(['CJ-1', 'CJ-3']))
    assert.equal(changed, 1)
    assert.deepEqual(patched, [{ path: '/products/a', body: { fulfilledBy: CLIENT_ID } }])
  })

  test('nothing to mark, nothing changed', async () => {
    const { shop, patched } = shopWith([{ id: 'b', fulfilledBy: null, variants: [{ sku: 'MUG' }] }])
    assert.equal(await markFulfilled(shop, new Set(['CJ-1'])), 0)
    assert.equal(patched.length, 0)
  })
})
