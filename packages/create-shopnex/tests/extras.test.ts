import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadAppKeys } from '../src/app-keys'
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
  const input = {
    root: '/r',
    shopDir: '/shop',
    databaseUrl: 'pglite:/shop/data',
    env: {},
    port: 3000,
    storefrontPort: 4321,
    secret: 's',
  }
  assert.equal(planFromBundle({ ...input, extras: [] }).processes.length, 2)
  const plan = planFromBundle({
    ...input,
    extras: pickExtras(['stripe', 'cj']),
    appKeys: { stripe: 'snxk_stripe', cj: 'snxk_cj' },
  })
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
  // Each app has its own identity; only CJ has tables of its own, in an embedded database in the shop folder
  assert.equal(stripe?.env.STRIPE_APP_KEY, 'snxk_stripe')
  assert.equal(cj?.env.CJ_DROPSHIPPING_APP_KEY, 'snxk_cj')
  assert.equal(stripe?.env.APP_DATABASE_URL, undefined)
  assert.match(cj?.env.APP_DATABASE_URL ?? '', /^pglite:.*shop[\\/]apps[\\/]cj-dropshipping[\\/]pglite$/)
  assert.equal(stripe?.env.DATA_DIR, undefined)
  assert.equal(stripe?.readyUrl, 'http://127.0.0.1:4600/shopnex/app.js')
})

test('shippo is an extra on port 4900', () => {
  const [shippo] = pickExtras(['shippo'])
  assert.deepEqual([shippo?.port, shippo?.urlEnv, shippo?.dir], [4900, 'SHIPPO_APP_URL', 'shippo'])
})

test('with a PostgreSQL shop the app with tables of its own shares its server, in a schema of its own', () => {
  const plan = planFromBundle({
    root: '/r',
    shopDir: '/shop',
    databaseUrl: 'postgres://u:p@db:5432/shopnex',
    env: {},
    port: 3000,
    storefrontPort: 4321,
    secret: 's',
    extras: pickExtras(['cj']),
    appKeys: { cj: 'snxk_cj' },
  })
  assert.equal(plan.processes.at(-1)?.env.APP_DATABASE_URL, 'postgres://u:p@db:5432/shopnex')
})

test('an app key is made once, kept in the shop folder, and a dry run makes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'create-shopnex-keys-'))
  try {
    const list = pickExtras(['stripe', 'cj'])
    assert.deepEqual(loadAppKeys(dir, list, { write: false }), { stripe: '', cj: '' })
    assert.equal(existsSync(join(dir, 'apps', 'stripe', 'app-key')), false)

    const first = loadAppKeys(dir, list, { write: true })
    assert.match(first.stripe ?? '', /^snxk_[A-Za-z0-9_-]+$/)
    assert.notEqual(first.stripe, first.cj)
    assert.deepEqual(loadAppKeys(dir, list, { write: true }), first)
    assert.equal(readFileSync(join(dir, 'apps', 'cj-dropshipping', 'app-key'), 'utf8').trim(), first.cj)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
