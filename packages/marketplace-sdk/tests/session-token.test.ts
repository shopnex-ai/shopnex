// Unit tests for session tokens: an EdDSA JWT signed by a Shopnex instance and verified by an embedded app.
// Covers the happy path (sign → verify round trip) and the main failure modes (expired, tampered,
// wrong key, wrong typ, wrong audience) plus decoding of malformed input.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SESSION_TOKEN_TYP, decodeSessionToken, signSessionToken, verifySessionToken } from '../src/session-token'
import { generateKeyPair, importPublicKey, keyId, signer, signJwt, type KeyResolver } from '../src/keys'

const CLIENT_ID = 'app_client_123'
const ISSUER = 'https://shop.example.com'

const claims = {
  iss: ISSUER,
  aud: CLIENT_ID,
  sub: 'staff_1',
  shop_id: 'shop_1',
  sid: 'install_1',
} as const

/** A fresh key pair, its signer and a resolver that only knows this instance's key. */
async function makeKeys() {
  const pair = await generateKeyPair()
  const signingKey = await signer(pair.privateKey)
  const publicKey = await importPublicKey(pair.publicKey)
  const kid = await keyId(pair.publicKey)
  const resolve: KeyResolver = async (_iss, requestedKid) => (requestedKid === kid ? publicKey : null)
  return { pair, signer: signingKey, publicKey, kid, resolve }
}

describe('session tokens', () => {
  test('signSessionToken then verifySessionToken round trips', async () => {
    const keys = await makeKeys()
    const token = await signSessionToken(keys.signer, claims, 60)

    const verified = await verifySessionToken(token, { clientId: CLIENT_ID, keys: keys.resolve })

    assert.ok(verified)
    assert.equal(verified.iss, ISSUER)
    assert.equal(verified.aud, CLIENT_ID)
    assert.equal(verified.sub, 'staff_1')
    assert.equal(verified.shop_id, 'shop_1')
    assert.equal(verified.sid, 'install_1')
    assert.equal(typeof verified.jti, 'string')
    assert.ok(verified.exp > verified.iat)
  })

  test('signSessionToken sets the session token typ', async () => {
    const keys = await makeKeys()
    const token = await signSessionToken(keys.signer, claims, 60)
    const [, payload] = token.split('.')
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'))

    assert.equal(header.typ, SESSION_TOKEN_TYP)
    assert.ok(payload)
  })

  test('verifySessionToken rejects expired tokens', async () => {
    const keys = await makeKeys()
    // exp = now - 120s, well beyond the default 5s leeway
    const token = await signSessionToken(keys.signer, claims, -120)

    assert.equal(await verifySessionToken(token, { clientId: CLIENT_ID, keys: keys.resolve }), null)
  })

  test('verifySessionToken rejects tampered payloads', async () => {
    const keys = await makeKeys()
    const token = await signSessionToken(keys.signer, claims, 60)
    const [header, , signature] = token.split('.')

    const original = decodeSessionToken(token)
    assert.ok(original)
    const forgedPayload = Buffer.from(JSON.stringify({ ...original, sub: 'someone_else' })).toString('base64url')
    const forged = `${header}.${forgedPayload}.${signature}`

    assert.equal(await verifySessionToken(forged, { clientId: CLIENT_ID, keys: keys.resolve }), null)
  })

  test('verifySessionToken rejects tampered signatures', async () => {
    const keys = await makeKeys()
    const token = await signSessionToken(keys.signer, claims, 60)
    const [header, payload, signature] = token.split('.')
    const flipped = signature!.slice(0, -2) + (signature!.endsWith('AA') ? 'BB' : 'AA')

    const tampered = `${header}.${payload}.${flipped}`

    assert.equal(await verifySessionToken(tampered, { clientId: CLIENT_ID, keys: keys.resolve }), null)
  })

  test('verifySessionToken rejects a token signed by a different key', async () => {
    const signingKeys = await makeKeys()
    const otherKeys = await makeKeys()
    const token = await signSessionToken(signingKeys.signer, claims, 60)
    // Resolver returns another instance's public key, so the signature does not match.
    const resolveOther: KeyResolver = async () => otherKeys.publicKey

    assert.equal(await verifySessionToken(token, { clientId: CLIENT_ID, keys: resolveOther }), null)
  })

  test('verifySessionToken rejects a token with the wrong typ', async () => {
    const keys = await makeKeys()
    const now = Math.floor(Date.now() / 1000)
    const token = await signJwt(keys.signer, 'JWT', {
      ...claims,
      iat: now,
      nbf: now,
      exp: now + 60,
      jti: 'not-a-session-token',
    })

    assert.equal(await verifySessionToken(token, { clientId: CLIENT_ID, keys: keys.resolve }), null)
  })

  test('verifySessionToken rejects a token for a different audience', async () => {
    const keys = await makeKeys()
    const token = await signSessionToken(keys.signer, claims, 60)

    assert.equal(await verifySessionToken(token, { clientId: 'other_client', keys: keys.resolve }), null)
  })

  test('decodeSessionToken reads the claims of a valid token', async () => {
    const keys = await makeKeys()
    const token = await signSessionToken(keys.signer, claims, 60)

    const decoded = decodeSessionToken(token)

    assert.ok(decoded)
    assert.equal(decoded.sub, 'staff_1')
    assert.equal(decoded.aud, CLIENT_ID)
    assert.equal(decoded.shop_id, 'shop_1')
  })

  test('decodeSessionToken returns null for malformed input', () => {
    assert.equal(decodeSessionToken(''), null)
    assert.equal(decodeSessionToken('not-a-jwt'), null)
    assert.equal(decodeSessionToken('only.two'), null)
    assert.equal(decodeSessionToken('a.b.c.d'), null)
  })
})
