import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createShopnexApp } from '@shopnex/app'
import { generateKeyPair, signer, toJwk, verifyClientAssertion } from '@shopnex/marketplace-sdk/keys'
import { signSessionToken, verifySessionToken } from '@shopnex/marketplace-sdk/session-token'
import { createReferenceCodec } from 'refmint/codec'
import { createOrderInquiryApp, orderReferences } from '../src/app'

const FIRST = '00000000-0000-4000-8000-000000000001'
const SECOND = '00000000-0000-4000-8000-000000000002'
const OTHER = '00000000-0000-4000-8000-000000000003'
const MISSING = '00000000-0000-4000-8000-000000000004'
const records = [
  { id: FIRST, orderNumber: 1001, shopId: 'a', email: 'synthetic@example.test' },
  { id: SECOND, orderNumber: 1002, shopId: 'a', email: 'synthetic@example.test' },
  { id: OTHER, orderNumber: 1001, shopId: 'b', email: 'synthetic@example.test' },
]

// Real SDK signing, verification, token exchange and AdminClient over loopback HTTP.
// The order API below is a fixture, not a substitute for Shopnex database e2e tests.
async function fixture() {
  const instanceKeys = await generateKeyPair()
  const appKeys = await generateKeyPair()
  const instanceSigner = await signer(instanceKeys.privateKey)
  const clientId = 'order-inquiry-test'
  const remote = new Hono()
  let instance = ''
  let orderReads = 0
  let failure = 0
  const orderRequests: string[] = []

  remote.get('/api/v1/oauth/jwks', async (c) => c.json({ keys: [await toJwk(instanceKeys.publicKey)] }))
  remote.post('/api/v1/oauth/token', async (c) => {
    const body = await c.req.json()
    const valid = await verifyClientAssertion(body.client_assertion, appKeys.publicKey, {
      clientId,
      audience: instance,
    })
    assert.equal(valid, true)
    assert.equal(body.grant_type, 'urn:ietf:params:oauth:grant-type:token-exchange')
    const claims = await verifySessionToken(body.subject_token, {
      clientId,
      keys: async () =>
        crypto.subtle.importKey('jwk', await toJwk(instanceKeys.publicKey), 'Ed25519', false, ['verify']),
    })
    assert.ok(claims)
    return c.json({ access_token: `fixture-${claims.shop_id}`, expires_in: 3600, installation_id: claims.sid })
  })
  remote.get('/api/v1/admin/shop', (c) => {
    const id = c.req.header('authorization')?.replace('Bearer fixture-', '')
    assert.ok(id === 'a' || id === 'b')
    return c.json({ id, name: `Fixture ${id}`, currency: 'USD' })
  })
  remote.get('/api/v1/admin/orders/:id', (c) => {
    orderReads++
    orderRequests.push(c.req.url)
    if (failure) return new Response('private upstream detail', { status: failure })
    const shopId = c.req.header('authorization')?.replace('Bearer fixture-', '')
    const order = records.find((row) => row.id === c.req.param('id') && row.shopId === shopId)
    return order ? c.json(order) : c.json({ message: 'Not found' }, 404)
  })
  const server = serve({ fetch: remote.fetch, hostname: '127.0.0.1', port: 0 })
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  instance = `http://127.0.0.1:${address.port}`
  const sdk = createShopnexApp({ clientId, appKey: appKeys.privateKey })
  const app = createOrderInquiryApp(sdk)
  const token = (shopId = 'a', ttl = 60, aud = clientId) =>
    signSessionToken(
      instanceSigner,
      {
        iss: instance,
        aud,
        sub: 'fixture-staff',
        shop_id: shopId,
        sid: `install-${shopId}`,
      },
      ttl,
    )
  async function post(path: string, body: unknown, auth?: string) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth ?? (await token())}` },
      body: JSON.stringify(body),
    })
  }
  return {
    app,
    instance,
    token,
    post,
    reads: () => orderReads,
    requests: orderRequests,
    failWith: (status: number) => {
      failure = status
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

let f: Awaited<ReturnType<typeof fixture>>
before(async () => {
  f = await fixture()
})
after(async () => {
  await f?.close()
})

test('SDK authenticated issue → formatted code → current-shop order lookup', async () => {
  const created = await f.post('/api/reference', { orderLink: `${f.instance}/admin/orders/${FIRST}` })
  assert.equal(created.status, 200)
  const result = await created.json()
  assert.equal(result.orderNumber, 1001)
  assert.equal(result.reference, orderReferences.format(orderReferences.encode(FIRST)))
  assert.equal(result.email, undefined)
  const found = await f.post('/api/lookup', { reference: ` \t${result.reference.toUpperCase()}\r\n` })
  assert.equal(found.status, 200)
  assert.deepEqual(await found.json(), { orderNumber: 1001, redirect: `${f.instance}/admin/orders/${FIRST}` })
  assert.equal(found.headers.get('cache-control'), 'no-store')
})

test('every single-character payload/checksum substitution is rejected before order reads', async () => {
  const reference = orderReferences.encode(FIRST)
  const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
  const before = f.reads()
  let checked = 0
  for (let pos = reference.lastIndexOf('1') + 1; pos < reference.length; pos++) {
    for (const replacement of alphabet) {
      if (replacement === reference[pos]) continue
      const typo = reference.slice(0, pos) + replacement + reference.slice(pos + 1)
      const response = await f.post('/api/lookup', { reference: typo })
      assert.equal(response.status, 400, typo)
      checked++
    }
  }
  assert.equal(checked, 1054)
  assert.equal(f.reads(), before)
})

test('wrong namespace, wrong kind, mixed case and Unicode are rejected without order reads', async () => {
  const before = f.reads()
  const canonical = orderReferences.encode(FIRST)
  for (const reference of [
    createReferenceCodec({ prefix: 'ticket', kind: 'uuid', version: 1 }).encode(FIRST),
    createReferenceCodec({ prefix: 'order', kind: 'uint64', version: 1 }).encode(1001n),
    canonical[0]!.toUpperCase() + canonical.slice(1),
    canonical.replace('order', 'оrder'), // Cyrillic o
    canonical + '\u00a0', // Non-ASCII whitespace is not presentation normalization.
    '',
  ]) {
    assert.equal((await f.post('/api/lookup', { reference })).status, 400)
  }
  assert.equal(f.reads(), before)
})

test('valid unknown UUID and another shop order stay not found', async () => {
  for (const id of [MISSING, OTHER]) {
    const response = await f.post('/api/lookup', {
      reference: orderReferences.encode(id),
      shopId: 'b',
      instance: 'https://untrusted.test',
    })
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Order not found in this shop.' })
  }
  assert.equal((await f.post('/api/reference', { orderLink: `${f.instance}/admin/orders/${OTHER}` })).status, 404)
  const own = await f.post('/api/lookup', { reference: orderReferences.encode(OTHER) }, await f.token('b'))
  assert.equal(own.status, 200)
  assert.equal((await own.json()).orderNumber, 1001)
  assert.ok(f.requests.every((url) => new URL(url).origin === f.instance))
})

test('missing, expired, tampered and wrong-audience sessions do not read orders', async () => {
  const before = f.reads()
  const body = { reference: orderReferences.encode(FIRST) }
  const unsigned = await f.app.request('/api/lookup', { method: 'POST', body: JSON.stringify(body) })
  assert.equal(unsigned.status, 401)
  const signed = await f.token()
  const parts = signed.split('.')
  parts[2] = (parts[2]![0] === 'a' ? 'b' : 'a') + parts[2]!.slice(1)
  for (const token of [await f.token('a', -60), await f.token('a', 60, 'another-app'), parts.join('.')]) {
    assert.equal((await f.post('/api/lookup', body, token)).status, 401)
  }
  assert.equal(f.reads(), before)
})

test('invalid JSON, unexpected types and oversized input fail without order reads', async () => {
  const before = f.reads()
  for (const body of [null, [], { reference: 123 }, {}, { reference: 'a'.repeat(501) }]) {
    assert.equal((await f.post('/api/lookup', body)).status, 400)
  }
  const malformed = await f.app.request('/api/lookup', {
    method: 'POST',
    headers: { authorization: `Bearer ${await f.token()}` },
    body: '{',
  })
  assert.equal(malformed.status, 400)
  assert.equal((await f.post('/api/lookup', { reference: 'a'.repeat(3000) })).status, 413)
  assert.equal(f.reads(), before)
})

test('reference creation accepts only this instance order links', async () => {
  const before = f.reads()
  for (const orderLink of [
    `https://untrusted.test/admin/orders/${FIRST}`,
    `${f.instance}/admin/orders/../../shop`,
    `${f.instance}/admin/orders/${FIRST}?shopId=b`,
    `${f.instance}/admin/orders/${FIRST}#fragment`,
    `${f.instance}/admin/orders/not-a-uuid`,
    FIRST,
  ])
    assert.equal((await f.post('/api/reference', { orderLink })).status, 400)
  assert.equal(f.reads(), before)
})

test('revoked/read-denied access and upstream errors are preserved without leaking details', async () => {
  try {
    for (const [upstream, expected] of [
      [401, 401],
      [403, 403],
      [503, 502],
    ]) {
      f.failWith(upstream!)
      const response = await f.post('/api/lookup', { reference: orderReferences.encode(FIRST) })
      assert.equal(response.status, expected)
      assert.ok(!(await response.text()).includes('private upstream detail'))
    }
  } finally {
    f.failWith(0)
  }
})

test('page uses SDK forms and exposes neither session tokens nor customer records', async () => {
  assert.equal((await f.app.request('/')).status, 401)
  const token = await f.token()
  const page = await f.app.request('/', { headers: { authorization: `Bearer ${token}` } })
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.ok(html.includes('data-shopnex-action="/api/reference"'))
  assert.ok(html.includes('data-shopnex-action="/api/lookup"'))
  assert.ok(!html.includes(token))
  assert.ok(!html.includes('synthetic@example.test'))
  assert.equal(page.headers.get('content-security-policy'), `frame-ancestors ${f.instance}`)
})

test('comparison keeps the costs and checksum limits visible', () => {
  // Synthetic existing numbers can both exist: a numeric typo need not mean "not found".
  assert.equal(records.find((order) => order.shopId === 'a' && order.orderNumber === 1002)?.id, SECOND)
  assert.equal(FIRST.length, 36)
  assert.equal('#1001'.length, 5)
  assert.equal(orderReferences.encode(FIRST).length, 41)
  assert.equal(orderReferences.format(orderReferences.encode(FIRST)).length, 49)
  // A different, correctly checksummed order is still valid. Always confirm the record.
  assert.equal(orderReferences.diagnose(orderReferences.encode(SECOND)).ok, true)
})
