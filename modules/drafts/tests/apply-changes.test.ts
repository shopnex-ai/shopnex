import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { applyChanges } from '../src/drafts'

describe('applyChanges', () => {
  test('sets changed keys and keeps the others', () => {
    assert.deepEqual(applyChanges({ title: 'Old', vendor: 'Acme' }, { title: 'New' }), { title: 'New', vendor: 'Acme' })
  })

  test('adds keys the live data does not have', () => {
    assert.deepEqual(applyChanges({ title: 'Old' }, { handle: 'old' }), { title: 'Old', handle: 'old' })
  })

  test('a key set to null is removed', () => {
    assert.deepEqual(applyChanges({ title: 'Old', vendor: 'Acme' }, { vendor: null }), { title: 'Old' })
  })

  test('removing a key that is not there changes nothing', () => {
    assert.deepEqual(applyChanges({ title: 'Old' }, { vendor: null }), { title: 'Old' })
  })

  test('does not change the live data', () => {
    const live = { title: 'Old', vendor: 'Acme' }
    applyChanges(live, { title: 'New', vendor: null })
    assert.deepEqual(live, { title: 'Old', vendor: 'Acme' })
  })

  test('keeps the live keys in their order, then the new ones', () => {
    const merged = applyChanges({ b: 1, a: 2 }, { c: 3, a: 9 })
    assert.deepEqual(Object.keys(merged), ['b', 'a', 'c'])
  })

  test('a key named __proto__ is data, not the object’s prototype', () => {
    const merged = applyChanges({}, JSON.parse('{"__proto__": 1}') as Record<string, number>)
    assert.equal(Object.getPrototypeOf(merged), Object.prototype)
    assert.equal(Object.keys(merged).length, 1)
  })
})
