import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planFromCheckout } from '../src/checkout'

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
