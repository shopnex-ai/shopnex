import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageError } from '../src/errors'
import { assertNode, atLeast } from '../src/node-version'

test('versions compare as numbers, not text', () => {
  assert.ok(atLeast('22.22.0', '22.22.0'))
  assert.ok(atLeast('v24.1.0', '22.22.0'))
  assert.ok(atLeast('22.100.0', '22.22.0'))
  assert.ok(!atLeast('22.21.9', '22.22.0'))
  assert.ok(!atLeast('20.19.0', '22.22.0'))
})

test('an old Node is a usage error that says what to install', () => {
  assert.throws(() => assertNode('20.0.0', '>=22.22.0'), UsageError)
  assert.doesNotThrow(() => assertNode('24.22.0', '>=22.22.0'))
})
