import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CLIENT_ASSERTION_TYPE,
  PRIVATE_KEY_PREFIX,
  JWKS_PATH,
  createClientAssertion,
  createJwksResolver,
  decodeJwt,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  keyId,
  publicKeyOf,
  sign,
  signer,
  signJwt,
  toJwk,
  verify,
  verifyClientAssertion,
  verifyJwt,
  type ClientAssertionClaims,
  type PublicJwk,
} from '../src/keys'

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** A minimal, currently-valid claim set; individual tests override what they need. */
function validClaims(overrides: Record<string, unknown> = {}) {
  const iat = nowSeconds()
  return { iss: 'https://instance.example.com', sub: 'user-1', iat, exp: iat + 60, ...overrides }
}

// --- key generation / import ---

test('generateKeyPair returns a prefixed private key and a raw public key', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  assert.ok(privateKey.startsWith(PRIVATE_KEY_PREFIX))
  // Raw Ed25519 public key is 32 bytes -> 43 base64url characters, charset [A-Za-z0-9_-]
  assert.match(publicKey, /^[A-Za-z0-9_-]+$/)
  assert.equal(publicKey.length, 43)
})

test('publicKeyOf recovers the public half from a private key string or CryptoKey', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  assert.equal(await publicKeyOf(privateKey), publicKey)
  assert.equal(await publicKeyOf(await importPrivateKey(privateKey)), publicKey)
})

test('importPrivateKey rejects keys that lack the Shopnex prefix', () => {
  assert.throws(() => importPrivateKey('not-a-shopnex-key'), /Not a Shopnex private key/)
})

test('importPublicKey returns a key usable for verification', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const signature = await sign(await importPrivateKey(privateKey), 'hello')
  assert.equal(await verify(await importPublicKey(publicKey), 'hello', signature), true)
})

test('keyId is a stable 16-char id that differs across keys', async () => {
  const a = await generateKeyPair()
  const b = await generateKeyPair()
  const kid = await keyId(a.publicKey)
  assert.equal(kid.length, 16)
  assert.match(kid, /^[A-Za-z0-9_-]+$/)
  assert.equal(await keyId(a.publicKey), kid) // deterministic
  assert.notEqual(await keyId(b.publicKey), kid) // sensitive to the key
})

test('toJwk exposes the public key as an Ed25519 signature JWK', async () => {
  const { publicKey } = await generateKeyPair()
  const jwk = await toJwk(publicKey)
  const expected: PublicJwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: publicKey,
    kid: await keyId(publicKey),
    alg: 'EdDSA',
    use: 'sig',
  }
  assert.deepEqual(jwk, expected)
})

// --- signatures ---

test('sign / verify round trip, and rejects altered messages', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const priv = await importPrivateKey(privateKey)
  const pub = await importPublicKey(publicKey)

  const signature = await sign(priv, 'the message')
  assert.equal(await verify(pub, 'the message', signature), true)
  assert.equal(await verify(pub, 'the message ', signature), false)
})

test('verify returns false for garbage signatures and for another key', async () => {
  const a = await generateKeyPair()
  const b = await generateKeyPair()
  const pubA = await importPublicKey(a.publicKey)
  const sigA = await sign(await importPrivateKey(a.privateKey), 'm')

  assert.equal(await verify(pubA, 'm', 'not-a-real-signature'), false)
  assert.equal(await verify(await importPublicKey(b.publicKey), 'm', sigA), false)
})

// --- JWTs ---

test('signJwt / verifyJwt round trip and carries the signer kid in the header', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const s = await signer(privateKey)
  const token = await signJwt(s, 'JWT', validClaims())

  const decoded = decodeJwt(token)
  assert.equal(decoded?.header.alg, 'EdDSA')
  assert.equal(decoded?.header.typ, 'JWT')
  assert.equal(decoded?.header.kid, s.kid)

  const verified = await verifyJwt<{ sub: string; iss: string; exp: number }>(
    token,
    'JWT',
    await importPublicKey(publicKey),
  )
  assert.equal(verified?.sub, 'user-1')
  assert.equal(verified?.iss, 'https://instance.example.com')
})

test('verifyJwt accepts a key-resolver function', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const s = await signer(privateKey)
  const token = await signJwt(s, 'JWT', validClaims())
  const pub = await importPublicKey(publicKey)

  const resolver = async (header: { kid?: string }) => (header.kid === s.kid ? pub : null)
  assert.ok(await verifyJwt(token, 'JWT', resolver as never))
  const miss = async () => null
  assert.equal(await verifyJwt(token, 'JWT', miss as never), null)
})

test('verifyJwt rejects the wrong typ, a bad signature and malformed tokens', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const s = await signer(privateKey)
  const pub = await importPublicKey(publicKey)
  const token = await signJwt(s, 'JWT', validClaims())

  assert.equal(await verifyJwt(token, 'OTHER', pub), null)

  const [header, payload, signature] = token.split('.')
  const tampered = `${header}.${payload}.${signature![0] === 'A' ? 'B' : 'A'}${signature!.slice(1)}`
  assert.equal(await verifyJwt(tampered, 'JWT', pub), null)

  for (const bad of ['', 'a.b', 'a.b.c.d', 'header.payload']) {
    assert.equal(await verifyJwt(bad, 'JWT', pub), null)
  }
})

test('verifyJwt enforces exp and nbf with a small leeway', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const pub = await importPublicKey(publicKey)
  const s = await signer(privateKey)

  const expired = await signJwt(s, 'JWT', validClaims({ exp: nowSeconds() - 60 }))
  assert.equal(await verifyJwt(expired, 'JWT', pub), null)

  const notYet = await signJwt(s, 'JWT', validClaims({ nbf: nowSeconds() + 60 }))
  assert.equal(await verifyJwt(notYet, 'JWT', pub), null)

  const noExp = await signJwt(s, 'JWT', validClaims({ exp: undefined }))
  assert.equal(await verifyJwt(noExp, 'JWT', pub), null)
})

test('decodeJwt reads header and claims without verifying', async () => {
  const { privateKey } = await generateKeyPair()
  const token = await signJwt(await signer(privateKey), 'JWT', { sub: 'abc' })
  const decoded = decodeJwt<{ sub: string }>(token)
  assert.equal(decoded?.header.typ, 'JWT')
  assert.equal(decoded?.claims.sub, 'abc')
})

test('decodeJwt returns null for malformed tokens', () => {
  assert.equal(decodeJwt(''), null)
  assert.equal(decodeJwt('only-one-part'), null)
  assert.equal(decodeJwt('a.b'), null) // not valid base64url JSON
  assert.equal(decodeJwt('not base64!.also not!.sig'), null)
})

// --- client assertions (RFC 7523) ---

test('createClientAssertion / verifyClientAssertion round trip', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const assertion = await createClientAssertion(privateKey, 'client-123', 'https://instance.example.com/some/path')

  const decoded = decodeJwt<ClientAssertionClaims>(assertion)
  assert.equal(decoded?.header.typ, 'JWT')
  assert.equal(decoded?.header.alg, 'EdDSA')
  assert.equal(decoded?.claims.iss, 'client-123')
  assert.equal(decoded?.claims.sub, 'client-123')
  assert.equal(decoded?.claims.aud, 'https://instance.example.com') // origin only
  assert.ok(decoded!.claims.exp - decoded!.claims.iat <= 300) // short-lived
  assert.ok(decoded?.claims.jti)

  assert.equal(
    await verifyClientAssertion(assertion, publicKey, {
      clientId: 'client-123',
      audience: 'https://instance.example.com',
    }),
    true,
  )
})

test('createClientAssertion accepts an imported private key', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const key = await importPrivateKey(privateKey)
  const assertion = await createClientAssertion(key, 'client-123', 'https://instance.example.com')
  assert.equal(
    await verifyClientAssertion(assertion, publicKey, {
      clientId: 'client-123',
      audience: 'https://instance.example.com',
    }),
    true,
  )
})

test('verifyClientAssertion rejects the wrong client, audience or key', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const other = await generateKeyPair()
  const assertion = await createClientAssertion(privateKey, 'client-123', 'https://a.example.com')

  assert.equal(
    await verifyClientAssertion(assertion, publicKey, { clientId: 'client-123', audience: 'https://a.example.com' }),
    true,
  )
  assert.equal(
    await verifyClientAssertion(assertion, publicKey, { clientId: 'someone-else', audience: 'https://a.example.com' }),
    false,
  )
  assert.equal(
    await verifyClientAssertion(assertion, publicKey, { clientId: 'client-123', audience: 'https://b.example.com' }),
    false,
  )
  assert.equal(
    await verifyClientAssertion(assertion, other.publicKey, {
      clientId: 'client-123',
      audience: 'https://a.example.com',
    }),
    false,
  )
})

test('CLIENT_ASSERTION_TYPE is the RFC 7523 JWT bearer type', () => {
  assert.equal(CLIENT_ASSERTION_TYPE, 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
})

// --- JWKS resolution ---

test('createJwksResolver fetches, caches and verifies keys from a JWKS endpoint', async () => {
  const { privateKey, publicKey } = await generateKeyPair()
  const s = await signer(privateKey)
  const token = await signJwt(s, 'JWT', validClaims())
  const jwk = await toJwk(publicKey)
  const iss = 'https://instance.example.com'

  let calls = 0
  const fakeFetch = (async (url: string) => {
    calls++
    assert.equal(url, iss + JWKS_PATH)
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  const resolver = createJwksResolver({ fetch: fakeFetch })
  const key = await resolver(iss, s.kid)
  assert.ok(key)
  assert.equal((await verifyJwt<{ sub: string; exp: number }>(token, 'JWT', key!))?.sub, 'user-1')

  // A known kid is served from cache, so no second fetch.
  await resolver(iss, s.kid)
  assert.equal(calls, 1)
})

test('createJwksResolver refuses insecure origins and unknown issuers', async () => {
  const resolver = createJwksResolver({
    fetch: (async () => {
      throw new Error('should not fetch')
    }) as unknown as typeof fetch,
  })
  assert.equal(await resolver('http://evil.example.com', 'kid'), null)
  assert.equal(await resolver('not a url', 'kid'), null)
})
