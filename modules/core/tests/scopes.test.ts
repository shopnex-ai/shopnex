// What an API token's scopes allow: write includes read, and a scope list is kept minimal and in the canonical order.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { API_SCOPES } from '../src/core.schema'
import { hasScope, normalizeScopes } from '../src/scopes'

describe('scopes', () => {
  test('write access includes read access of the same resource, and not the other way round', () => {
    assert.equal(hasScope(['write_orders'], 'read_orders'), true)
    assert.equal(hasScope(['read_orders'], 'write_orders'), false)
    assert.equal(hasScope(['read_orders'], 'read_orders'), true)
    assert.equal(hasScope(['write_products'], 'read_orders'), false)
    assert.equal(hasScope([], 'read_orders'), false)
  })

  test('normalizing drops a read scope that a write scope already covers, keeps the canonical order and drops repeats', () => {
    const normalized = normalizeScopes(['write_orders', 'read_orders', 'read_products', 'read_products'])
    assert.deepEqual(
      normalized.filter((s) => s.endsWith('_orders')),
      ['write_orders'],
    )
    assert.deepEqual(
      normalized.filter((s) => s.endsWith('_products')),
      ['read_products'],
    )
    assert.deepEqual(
      normalized,
      API_SCOPES.filter((s) => normalized.includes(s)),
      'in the order of API_SCOPES',
    )
  })
})
