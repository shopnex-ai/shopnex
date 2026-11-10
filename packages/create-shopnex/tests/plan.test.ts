import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planFromBundle } from '../src/plan'

test('the packaged build runs in production mode, on this machine only, with its own secret and migrations', () => {
  const plan = planFromBundle({
    root: '/app/0.14.0',
    dataDir: '/data/shop',
    port: 3100,
    storefrontPort: 4400,
    secret: 's3cret',
  })
  const [admin, storefront] = plan.processes
  assert.ok(admin && storefront)
  assert.deepEqual([admin.cwd, admin.args], ['/app/0.14.0/admin', ['server.mjs']])
  assert.equal(admin.command, process.execPath)
  assert.equal(admin.env.NODE_ENV, 'production')
  assert.equal(admin.env.HOST, '127.0.0.1', 'a fresh install lets whoever reaches it create the owner')
  assert.equal(admin.env.PORT, '3100')
  assert.equal(admin.env.DATABASE_URL, 'pglite:/data/shop')
  assert.equal(admin.env.SHOPNEX_MIGRATIONS_DIR, '/app/0.14.0/migrations')
  assert.equal(admin.env.SHOPNEX_SECRET, 's3cret')
  assert.equal(admin.env.STOREFRONT_URL, 'http://localhost:4400', 'Themes and the theme editor need the storefront')
  assert.deepEqual([storefront.cwd, storefront.args], ['/app/0.14.0/storefront', ['dist/server/entry.mjs']])
  assert.equal(storefront.env.HOST, '127.0.0.1')
  assert.equal(storefront.env.PORT, '4400')
  assert.equal(storefront.env.SHOPNEX_URL, 'http://localhost:3100')
})
