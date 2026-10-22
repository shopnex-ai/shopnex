// Apps without shared secrets: an app's key pair (we only store the public half), the instance's published
// keys, managed install, the token exchange / client credentials grants, app data, uninstall, and webhook
// deliveries an app can check with the instance's key. Uses its own apps (deleted at the end).
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { inArray } from 'drizzle-orm'
import { appService, instanceUrl } from '@shopnex/apps'
import { db, schema } from '@shopnex/db'
import { createJwksResolver, generateKeyPair, verify } from '@shopnex/marketplace-sdk/keys'
import { verifySessionToken } from '@shopnex/marketplace-sdk/session-token'
import { Fixtures, SHOP, appToken, call, closeDb, oauthToken, ok, requireApp } from '../lib'

const fx = new Fixtures()
const keys = createJwksResolver({ allowHttp: true })

type Registered = Awaited<ReturnType<typeof appService.registerApp>>
let one: Registered
let other: Registered
let installationId: string
const apps: string[] = []

let server: Server
let hookUrl: string
const deliveries: { headers: Headers; body: string }[] = []

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

async function register(name: string) {
  const registered = await appService.registerApp(
    { name: `E2E ${name} ${Date.now()}`, appUrl: 'http://127.0.0.1:9/app', redirectUrls: [], scopes: ['read_orders'] },
    null,
  )
  apps.push(registered.app.id)
  return registered
}

const sessionToken = () => appService.createSessionToken({ shopId: SHOP, installationId, userId: 'e2e-staff' })

before(async () => {
  await requireApp()
  await fx.init()
  one = await register('apps')
  other = await register('other app')
  const installation = await appService.installManaged({
    appId: one.app.id,
    shopId: SHOP,
    userId: null as unknown as string,
    scopes: ['read_orders'],
  })
  installationId = installation.id
  await appService.installManaged({
    appId: other.app.id,
    shopId: SHOP,
    userId: null as unknown as string,
    scopes: ['read_orders'],
  })

  server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    deliveries.push({ headers: new Headers(req.headers as Record<string, string>), body })
    res.writeHead(204).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`
})

after(async () => {
  await fx.cleanup()
  // Installations, tokens, their webhooks and app data go with the apps
  if (apps.length) await db.delete(schema.apps).where(inArray(schema.apps.id, apps))
  server?.close()
  await closeDb()
})

describe('apps: keys', () => {
  test('the instance publishes its keys; session tokens check out against them', async () => {
    const jwks = ok(await call('GET', '/oauth/jwks'))
    assert.ok(jwks.keys.length > 0)
    assert.ok(jwks.keys.every((k: { kty: string; crv: string; x: string }) => k.kty === 'OKP' && k.crv === 'Ed25519'))
    const token = await sessionToken()
    const claims = await verifySessionToken(token, { clientId: one.app.clientId, keys })
    assert.equal(claims?.shop_id, SHOP)
    assert.equal(claims?.sid, installationId)
    assert.equal(claims?.iss, await instanceUrl())
    assert.equal(await verifySessionToken(token, { clientId: other.app.clientId, keys }), null, 'wrong audience')
  })

  test('the private key is never stored', async () => {
    const [row] = await db
      .select()
      .from(schema.apps)
      .where(inArray(schema.apps.id, [one.app.id]))
    assert.ok(row?.publicKey)
    assert.ok(!JSON.stringify(row).includes(one.privateKey.slice(5, 40)))
  })
})

describe('apps: tokens', () => {
  test('client credentials: a token for the installation, limited to its scopes', async () => {
    const token = await appToken(one.app.clientId, one.privateKey, { shop_id: SHOP })
    assert.equal(ok(await call('GET', '/admin/shop', undefined, bearer(token))).id, SHOP)
    ok(await call('GET', '/admin/orders?limit=1', undefined, bearer(token)))
    ok(await call('GET', '/admin/products?limit=1', undefined, bearer(token)), 403)
  })

  test('token exchange: a session token for this app only', async () => {
    const r = ok(await oauthToken(one.app.clientId, one.privateKey, { subject_token: await sessionToken() }))
    assert.equal(r.installation_id, installationId)
    assert.ok(r.expires_in > 0)
    ok(await call('GET', '/admin/shop', undefined, bearer(r.access_token)))
    // Another app can't use it, even with its own valid assertion
    const stolen = await oauthToken(other.app.clientId, other.privateKey, { subject_token: await sessionToken() })
    assert.equal(stolen.status, 400)
    assert.equal(stolen.body.data.error, 'invalid_grant')
  })

  test('assertions: wrong key or another audience is rejected', async () => {
    const { privateKey } = await generateKeyPair()
    const wrongKey = await oauthToken(one.app.clientId, privateKey, { shop_id: SHOP })
    assert.equal(wrongKey.status, 401)
    assert.equal(wrongKey.body.data.error, 'invalid_client')
    // An assertion made for another server (e.g. the marketplace) can't be replayed here
    const elsewhere = await oauthToken(one.app.clientId, one.privateKey, { shop_id: SHOP }, 'https://evil.example.com')
    assert.equal(elsewhere.status, 401)
  })

  test('a tampered access token is rejected', async () => {
    const token = await appToken(one.app.clientId, one.privateKey, { shop_id: SHOP })
    const [h, p, s] = token.split('.')
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString())
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, scope: 'write_products' })).toString('base64url')}.${s}`
    ok(await call('GET', '/admin/shop', undefined, bearer(forged)), 401)
  })
})

describe('apps: data', () => {
  test("an app's own storage, invisible to other apps and plain API tokens", async () => {
    const mine = bearer(await appToken(one.app.clientId, one.privateKey, { shop_id: SHOP }))
    const theirs = bearer(await appToken(other.app.clientId, other.privateKey, { shop_id: SHOP }))
    ok(await call('PUT', '/admin/app-data/settings', { value: { color: 'blue', n: 1 } }, mine))
    assert.deepEqual(ok(await call('GET', '/admin/app-data/settings', undefined, mine)).value, { color: 'blue', n: 1 })
    ok(await call('PUT', '/admin/app-data/settings', { value: { color: 'red' } }, mine))
    assert.deepEqual(
      ok(await call('GET', '/admin/app-data', undefined, mine)).map((d: { key: string }) => d.key),
      ['settings'],
    )
    ok(await call('GET', '/admin/app-data/settings', undefined, theirs), 404)
    ok(await call('GET', '/admin/app-data/settings', undefined, await fx.token(['read_orders'])), 403)
    ok(await call('DELETE', '/admin/app-data/settings', undefined, mine))
    ok(await call('GET', '/admin/app-data/settings', undefined, mine), 404)
  })
})

describe('apps: webhooks', () => {
  test("deliveries carry a signature apps check with the instance's keys", async () => {
    const token = bearer(await appToken(one.app.clientId, one.privateKey, { shop_id: SHOP }))
    const endpoint = ok(await call('POST', '/admin/webhooks', { url: hookUrl, topics: ['order.created'] }, token))
    ok(await call('POST', `/admin/webhooks/${endpoint.id}/test`, {}, token))
    const deadline = Date.now() + 20_000
    while (deliveries.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))
    const delivery = deliveries[0]
    assert.ok(delivery, 'no delivery within 20s (is the delivery worker running?)')
    const h = delivery.headers
    assert.equal(h.get('shopnex-instance'), await instanceUrl())
    const key = await keys(h.get('shopnex-instance')!, h.get('shopnex-key-id')!)
    assert.ok(key)
    const v1a = h
      .get('webhook-signature')!
      .split(' ')
      .find((s) => s.startsWith('v1a,'))!
    const message = `${h.get('webhook-id')}.${h.get('webhook-timestamp')}.${delivery.body}`
    assert.ok(await verify(key, message, v1a.slice(4)))
    assert.ok(!(await verify(key, message + ' ', v1a.slice(4))))
  })
})

describe('apps: uninstall', () => {
  test('revokes access tokens at once and stops new ones', async () => {
    const token = bearer(await appToken(one.app.clientId, one.privateKey, { shop_id: SHOP }))
    assert.ok(await appService.uninstall(SHOP, installationId))
    ok(await call('GET', '/admin/shop', undefined, token), 401)
    const r = await oauthToken(one.app.clientId, one.privateKey, { shop_id: SHOP })
    assert.equal(r.status, 400)
    assert.equal(r.body.data.error, 'invalid_grant')
    await assert.rejects(sessionToken(), /not installed/)
  })
})
