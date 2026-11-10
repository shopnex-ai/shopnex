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

test('the secret is made once, kept next to the data folder, and the same on every run', async () => {
  const { ensureSecret } = await import('../src/paths')
  const { mkdtempSync, existsSync, statSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dataDir = join(mkdtempSync(join(tmpdir(), 'create-shopnex-secret-')), 'shop')
  const first = ensureSecret(dataDir)
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(ensureSecret(dataDir), first)
  assert.ok(existsSync(`${dataDir}.secret`))
  assert.equal(existsSync(dataDir), false, 'the data folder belongs to the database')
  if (process.platform !== 'win32')
    assert.equal(statSync(`${dataDir}.secret`).mode & 0o077, 0, 'readable by the owner only')
})
