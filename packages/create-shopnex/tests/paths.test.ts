import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { databaseUrl, defaultDataDir, resolveDataDir } from '../src/paths'

test('the default data folder is ~/.shopnex/data, whichever folder it runs from', () => {
  assert.equal(defaultDataDir(), join(homedir(), '.shopnex', 'data'))
  assert.equal(resolveDataDir(undefined), defaultDataDir())
})

test('--data accepts ~ and relative paths', () => {
  assert.equal(resolveDataDir('~/shop'), join(homedir(), 'shop'))
  assert.equal(resolveDataDir('~'), homedir())
  assert.equal(resolveDataDir('shop-data'), resolve('shop-data'))
})

test('the server is told to use the embedded database in that folder', () => {
  assert.equal(databaseUrl('/data/shop'), 'pglite:/data/shop')
})
