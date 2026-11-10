import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageError } from '../src/errors'
import { pickExtras } from '../src/extras'
import { parse } from '../src/args'
import { planFromBundle } from '../src/plan'

test('--with takes names comma separated or repeated, once each, and refuses unknown ones', () => {
  assert.deepEqual(pickExtras(undefined), [])
  assert.deepEqual(
    pickExtras(['stripe,cj']).map((e) => e.name),
    ['stripe', 'cj'],
  )
  assert.deepEqual(
    pickExtras(['cj', 'CJ', 'stripe']).map((e) => e.name),
    ['cj', 'stripe'],
  )
  assert.throws(() => pickExtras(['paypal']), UsageError)
  assert.deepEqual(parse(['--with', 'stripe', '--with', 'cj']).with, ['stripe', 'cj'])
  assert.deepEqual(parse([]).with, [])
})

test('the plan starts an app per extra, on its port, with its data in the shop folder, and tells the admin where it is', () => {
  const input = { root: '/r', shopDir: '/shop', dataDir: '/shop/data', port: 3000, storefrontPort: 4321, secret: 's' }
  assert.equal(planFromBundle({ ...input, extras: [] }).processes.length, 2)
  const plan = planFromBundle({ ...input, extras: pickExtras(['stripe', 'cj']) })
  assert.deepEqual(
    plan.processes.map((p) => p.name),
    ['admin', 'storefront', 'stripe', 'cj'],
  )
  const [admin, , stripe, cj] = plan.processes
  assert.equal(admin?.env.STRIPE_APP_URL, 'http://localhost:4600')
  assert.equal(admin?.env.CJ_DROPSHIPPING_APP_URL, 'http://localhost:4700')
  assert.equal(stripe?.env.PORT, '4600')
  assert.equal(stripe?.env.HOST, '127.0.0.1')
  assert.equal(stripe?.env.SHOPNEX_INTERNAL_URL, 'http://localhost:3000')
  assert.match(stripe?.env.DATA_DIR ?? '', /shop[\\/]apps[\\/]stripe$/)
  assert.match(cj?.env.DATA_DIR ?? '', /shop[\\/]apps[\\/]cj-dropshipping$/)
  assert.equal(stripe?.readyUrl, 'http://127.0.0.1:4600/shopnex/app.js')
})

test('shippo is an extra on port 4900', () => {
  const [shippo] = pickExtras(['shippo'])
  assert.deepEqual([shippo?.port, shippo?.urlEnv, shippo?.dir], [4900, 'SHIPPO_APP_URL', 'shippo'])
})
