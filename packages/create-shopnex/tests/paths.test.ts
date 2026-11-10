import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { UsageError } from '../src/errors'
import { resolveShopDir } from '../src/paths'

test('the shop folder is the name, relative to where it runs; ~ works; empty is refused', () => {
  assert.equal(resolveShopDir('shop', '/work'), resolve('/work', 'shop'))
  assert.equal(resolveShopDir('~/shop'), join(homedir(), 'shop'))
  assert.throws(() => resolveShopDir('  '), UsageError)
})
