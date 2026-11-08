// Every Admin API route refuses a caller who has not proved who they are. Saleor shipped the opposite: a permission
// helper that waved unauthenticated requests through on some mutations (CVE-2026-48744), letting an anonymous caller
// change a channel's order settings. This reads the live OpenAPI spec and calls every /admin operation with nothing,
// then with credentials that look right but aren't; each must answer 401. A route added without authentication fails
// here the day it is added.
//
// Requests carry a valid-shaped but empty body, so a route that wrongly let the caller in would mostly be turned away
// by validation rather than change anything.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { API, Fixtures, SHOP, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()

// Admin routes that are public on purpose, as "METHOD /path": none today (first-run setup is a server function of the
// admin app, not part of this API). Add a route here only with a reason, and it must still exist in the spec.
const PUBLIC: Record<string, string> = {}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type Spec = { paths: Record<string, Partial<Record<(typeof METHODS)[number], unknown>>> }

let adminRoutes: { method: string; path: string }[]
let publishable: Record<string, string>

before(async () => {
  await requireApp()
  await fx.init()
  const spec = (await (await fetch(`${API}/openapi.json`)).json()) as Spec
  adminRoutes = Object.entries(spec.paths)
    .filter(([path]) => path.startsWith('/admin'))
    .flatMap(([path, ops]) => METHODS.filter((m) => m in ops).map((m) => ({ method: m.toUpperCase(), path })))
  publishable = { 'x-shopnex-key': (await fx.storefrontKey(SHOP)).token }
})

after(async () => {
  await fx.cleanup()
  await closeDb()
})

const filled = (path: string) => path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000')
const hasBody = (method: string) => method !== 'GET'

/** Calls every admin route with these headers and returns those that did not answer 401, as "METHOD path → status" */
async function notRefused(headers: Record<string, string>) {
  const wrong: string[] = []
  for (const { method, path } of adminRoutes) {
    if (`${method} ${path}` in PUBLIC) continue
    const r = await call(method, filled(path), hasBody(method) ? {} : undefined, headers)
    if (r.status !== 401) wrong.push(`${method} ${path} → ${r.status}`)
  }
  return wrong
}

describe('the Admin API refuses callers who have not proved who they are', () => {
  test('the sweep sees the whole API, and the public list has not rotted', () => {
    assert.ok(adminRoutes.length > 100, `the spec lists only ${adminRoutes.length} admin operations: is it reachable?`)
    const all = adminRoutes.map((r) => `${r.method} ${r.path}`)
    assert.deepEqual(
      Object.keys(PUBLIC).filter((r) => !all.includes(r)),
      [],
      'PUBLIC lists routes that no longer exist',
    )
  })

  test('a control: a real token is let in, so a 401 means "not you", not "the server is down"', async () => {
    const token = await fx.token(['read_products'])
    ok(await call('GET', '/admin/products', undefined, token))
  })

  test('no credentials at all', async () => {
    assert.deepEqual(await notRefused({}), [], 'admin routes that answered someone with no credentials')
  })

  test('a token that looks right but was never issued', async () => {
    const forged = { authorization: `Bearer sk_${'A'.repeat(43)}` }
    assert.deepEqual(await notRefused(forged), [], 'admin routes that accepted a forged token')
  })

  test('a storefront publishable key is not an admin credential, as a header or as a bearer', async () => {
    assert.deepEqual(await notRefused(publishable), [], 'admin routes that accepted a publishable key')
    const bearer = { authorization: `Bearer ${publishable['x-shopnex-key']}` }
    assert.deepEqual(await notRefused(bearer), [], 'admin routes that accepted a publishable key as a bearer token')
  })

  test('a session cookie that was never issued', async () => {
    const cookie = { cookie: 'better-auth.session_token=not-a-real-session.signature' }
    assert.deepEqual(await notRefused(cookie), [], 'admin routes that accepted a made-up session')
  })
})
