import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDataTag } from '../src/core/catalog'

test('tags that hold data (namespace::key => value) are not offered as a filter', () => {
  assert.equal(isDataTag('allbirds::gender => unisex'), true)
  assert.equal(isDataTag('allbirds::carbon-score => undefined'), true)
  assert.equal(isDataTag('allbirds::complete'), true)
  assert.equal(isDataTag('size => large'), true)
})

test('ordinary tags are', () => {
  for (const tag of ['bfcm-mens', 'new arrivals', 'Summer 2026', 'a:b', 'fast=>furious', 'sale']) {
    assert.equal(isDataTag(tag), false, tag)
  }
})
