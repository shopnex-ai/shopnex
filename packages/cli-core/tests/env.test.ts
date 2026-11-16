import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadShopEnv, redactUrl, switchDatabaseUrl } from '../src/env'

const shop = () => join(mkdtempSync(join(tmpdir(), 'create-shopnex-env-')), 'shop')

test('the first run makes the .env with the embedded database and a secret, and every run reads the same one', () => {
  const dir = shop()
  const first = loadShopEnv(dir, { write: true })
  assert.match(first.secret, /^[0-9a-f]{64}$/)
  assert.equal(first.databaseUrl, `pglite:${join(dir, '.pglite')}`, 'a relative path is relative to the shop folder')
  assert.equal(existsSync(join(dir, '.pglite')), false, 'the data folder belongs to the database')
  assert.match(readFileSync(join(dir, '.env'), 'utf8'), /^DATABASE_URL=pglite:\.\/\.pglite$/m)
  if (process.platform !== 'win32')
    assert.equal(statSync(join(dir, '.env')).mode & 0o077, 0, 'readable by the owner only')
  assert.deepEqual(loadShopEnv(dir, { write: true }), first)
})

test('DATABASE_URL in the .env is used as it is (PostgreSQL), and the other settings are passed on', () => {
  const dir = shop()
  loadShopEnv(dir, { write: true })
  writeFileSync(
    join(dir, '.env'),
    'DATABASE_URL=postgres://u:pw@localhost:5432/shop\nSHOPNEX_SECRET=abc\nSMTP_HOST="mail.example.com"\n',
  )
  const env = loadShopEnv(dir, { write: true })
  assert.equal(env.databaseUrl, 'postgres://u:pw@localhost:5432/shop')
  assert.equal(env.secret, 'abc')
  assert.deepEqual(env.rest, { SMTP_HOST: 'mail.example.com' })
})

test('a .env without a secret or database gets them added, and nothing else is touched', () => {
  const dir = shop()
  loadShopEnv(dir, { write: true })
  writeFileSync(join(dir, '.env'), 'SMTP_HOST=mail.example.com')
  const env = loadShopEnv(dir, { write: true })
  const text = readFileSync(join(dir, '.env'), 'utf8')
  assert.match(text, /^SMTP_HOST=mail\.example\.com$/m)
  assert.match(text, /^DATABASE_URL=pglite:\.\/\.pglite$/m)
  assert.ok(text.includes(`SHOPNEX_SECRET=${env.secret}`))
  assert.equal(loadShopEnv(dir, { write: true }).secret, env.secret)
})

test('a dry run writes nothing', () => {
  const dir = shop()
  const env = loadShopEnv(dir, { write: false })
  assert.equal(env.secret, '')
  assert.equal(existsSync(dir), false)
})

test('the password of a connection string is not shown', () => {
  assert.equal(redactUrl('postgres://u:pw@db:5432/shop'), 'postgres://u:***@db:5432/shop')
  assert.equal(redactUrl('pglite:/a/b'), 'pglite:/a/b')
})

test('switching the database keeps the old line as a comment and everything else as it was', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopnex-env-'))
  const file = join(dir, '.env')
  writeFileSync(
    file,
    '# my shop\n# DATABASE_URL=postgres://example\nDATABASE_URL=pglite:./.pglite\nSHOPNEX_SECRET=abc\n',
  )
  switchDatabaseUrl(file, 'postgres://u:p@db.example.com:5432/shop', new Date('2026-11-16T10:00:00Z'))
  assert.equal(
    readFileSync(file, 'utf8'),
    '# my shop\n# DATABASE_URL=postgres://example\n# DATABASE_URL=pglite:./.pglite   (before shopnex migrate-db, 2026-11-16)\nDATABASE_URL=postgres://u:p@db.example.com:5432/shop\nSHOPNEX_SECRET=abc\n',
  )
  assert.equal(loadShopEnv(dir, { write: false }).databaseUrl, 'postgres://u:p@db.example.com:5432/shop')
})

test('switching adds the line when there is none, and a password in the old line is not copied into the comment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopnex-env-'))
  const file = join(dir, '.env')
  writeFileSync(file, 'SHOPNEX_SECRET=abc')
  switchDatabaseUrl(file, 'postgres://db/shop')
  assert.equal(readFileSync(file, 'utf8'), 'SHOPNEX_SECRET=abc\nDATABASE_URL=postgres://db/shop\n')

  writeFileSync(file, 'DATABASE_URL=postgres://u:secret@old/shop\n')
  switchDatabaseUrl(file, 'postgres://new/shop')
  assert.doesNotMatch(readFileSync(file, 'utf8'), /secret/)
})

test('an address the .env cannot hold is refused instead of being written wrongly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopnex-env-'))
  const file = join(dir, '.env')
  writeFileSync(file, 'DATABASE_URL=pglite:./.pglite\n')
  assert.throws(() => switchDatabaseUrl(file, 'postgres://u:pa ss@db/shop'), /percent-encode/)
  assert.equal(readFileSync(file, 'utf8'), 'DATABASE_URL=pglite:./.pglite\n')
})
