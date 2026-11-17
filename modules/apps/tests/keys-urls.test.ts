// The instance's own signing key (made once, published as JWKS, used to sign what apps verify) and how the server reaches an app
// behind an internal address (Docker).
import assert from 'node:assert/strict'
import { after, afterEach, before, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema } = fx
const keys = await import('../src/keys')
const { serverUrl } = await import('../src')
const { rememberInternalUrl } = await import('../src/internal-url')
const { importPublicKey, verify } = await import('@shopnex/marketplace-sdk/keys')

before(fx.prepareDatabase)
after(fx.cleanup)

describe('the instance key', () => {
  test('is made once and kept: the same signer on every call, one stored row, published in the JWKS', async () => {
    const [a, b] = await Promise.all([keys.instanceSigner(), keys.instanceSigner()])
    assert.equal(a.kid, b.kid)
    assert.equal((await db.select().from(schema.instanceKeys)).length, 1)
    const { keys: published } = await keys.jwks()
    assert.deepEqual(
      published.map((k) => k.kid),
      [a.kid],
    )
    assert.equal(published[0]?.kty, 'OKP')
    assert.ok(!JSON.stringify(published).includes('privateKey'))
  })

  test('what it signs verifies with the published key, and ownKey finds it by id (and nothing else)', async () => {
    const { signature, kid, instance } = await keys.instanceSignature('id.123.body')
    assert.equal(instance, fx.AUDIENCE)
    const key = await keys.ownKey(kid)
    assert.ok(key)
    assert.equal(await verify(key, 'id.123.body', signature), true)
    assert.equal(await verify(key, 'id.123.other', signature), false)
    assert.equal(await keys.ownKey('unknown-kid'), null)
    assert.equal(await keys.ownKey(undefined), null)
    const { keys: published } = await keys.jwks()
    assert.ok(await importPublicKey(published[0]!.x))
  })
})

describe('serverUrl, the address the server uses for an app', () => {
  const touched = ['ACME_APP_URL', 'ACME_APP_INTERNAL_URL', 'OTHER_APP_URL', 'OTHER_APP_INTERNAL_URL']
  afterEach(() => {
    for (const name of touched) delete process.env[name]
  })

  test('an app with no internal address is reached at its own', () => {
    assert.equal(serverUrl('https://app.example.test/hook'), 'https://app.example.test/hook')
    assert.equal(serverUrl('not a url'), 'not a url')
  })

  test('NAME_APP_URL with NAME_APP_INTERNAL_URL swaps the origin, keeping the path and query, and a trailing slash stays or goes with the input', () => {
    process.env.ACME_APP_URL = 'https://acme.example.test'
    process.env.ACME_APP_INTERNAL_URL = 'http://acme:4600'
    assert.equal(serverUrl('https://acme.example.test/shopnex/installed?x=1'), 'http://acme:4600/shopnex/installed?x=1')
    assert.equal(serverUrl('https://acme.example.test'), 'http://acme:4600')
    assert.equal(serverUrl('https://acme.example.test/'), 'http://acme:4600/')
    assert.equal(
      serverUrl('https://other.example.test/x'),
      'https://other.example.test/x',
      'another origin is left alone',
    )
  })

  test('only the app whose public URL is configured is swapped, and a configured name without an internal address does nothing', () => {
    process.env.OTHER_APP_URL = 'https://other.example.test'
    process.env.ACME_APP_URL = 'https://acme.example.test'
    process.env.ACME_APP_INTERNAL_URL = 'http://acme:4600'
    assert.equal(serverUrl('https://other.example.test/x'), 'https://other.example.test/x')
    assert.equal(serverUrl('https://acme.example.test/x'), 'http://acme:4600/x')
  })

  test('an address the server learned from a bundled app is used too', () => {
    rememberInternalUrl('https://learned.example.test', 'http://learned:4900')
    assert.equal(serverUrl('https://learned.example.test/a/b'), 'http://learned:4900/a/b')
  })
})
