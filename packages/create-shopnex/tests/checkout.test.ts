import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planFromBundle, planFromCheckout } from '../src/checkout'

test('the plan starts the admin on the embedded database and the storefront pointed at it', () => {
  const plan = planFromCheckout({ root: '/repo', dataDir: '/data/shop', port: 3100, storefrontPort: 4400 })
  const [admin, storefront] = plan.processes
  assert.ok(admin && storefront)
  assert.equal(admin.env.DATABASE_URL, 'pglite:/data/shop')
  assert.equal(admin.env.APP_URL, 'http://localhost:3100')
  assert.equal(admin.env.BETTER_AUTH_URL, 'http://localhost:3100')
  assert.ok(admin.args.includes('--strictPort'), 'a taken port must fail, not move to another one')
  assert.equal(admin.cwd, '/repo/apps/admin-ui')
  assert.equal(storefront.env.SHOPNEX_URL, 'http://localhost:3100')
  assert.ok(storefront.args.includes('--ignore-lock'), 'Astro must stay in the foreground')
  assert.equal(storefront.args[storefront.args.indexOf('--port') + 1], '4400')
  assert.equal(plan.storefrontUrl, 'http://localhost:4400')
  assert.deepEqual(
    plan.ports.map((p) => p.port),
    [3100, 4400],
  )
})

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
  assert.deepEqual([storefront.cwd, storefront.args], ['/app/0.14.0/storefront', ['dist/server/entry.mjs']])
  assert.equal(storefront.env.HOST, '127.0.0.1')
  assert.equal(storefront.env.PORT, '4400')
  assert.equal(storefront.env.SHOPNEX_URL, 'http://localhost:3100')
})
