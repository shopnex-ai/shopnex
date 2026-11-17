// Preview tokens let the editor's iframe show a draft: signed, bound to one shop and one copy, and short-lived.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
const { createPreviewToken, verifyPreviewToken } = await import('../src/preview')

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)

describe('preview tokens', () => {
  test('a token gives back the copy it was issued for, to the shop it was issued for', () => {
    const { token } = createPreviewToken('shop-1', 'copy-9', NOW)
    assert.equal(verifyPreviewToken(token, 'shop-1', NOW), 'copy-9')
  })

  test('it expires one hour after it was issued, exactly', () => {
    const { token, expiresAt } = createPreviewToken('shop-1', 'copy-9', NOW)
    assert.equal(expiresAt.getTime(), NOW + 60 * 60 * 1000)
    assert.equal(verifyPreviewToken(token, 'shop-1', NOW + 60 * 60 * 1000 - 1000), 'copy-9')
    assert.equal(verifyPreviewToken(token, 'shop-1', NOW + 60 * 60 * 1000), null)
    assert.equal(verifyPreviewToken(token, 'shop-1', NOW + 2 * 60 * 60 * 1000), null)
  })

  test('another shop cannot use it', () => {
    const { token } = createPreviewToken('shop-1', 'copy-9', NOW)
    assert.equal(verifyPreviewToken(token, 'shop-2', NOW), null)
  })

  test('a changed payload or a changed signature is refused', () => {
    const { token } = createPreviewToken('shop-1', 'copy-9', NOW)
    const [body, mac] = token.split('.') as [string, string]
    const forged = Buffer.from(JSON.stringify({ shop: 'shop-1', copy: 'copy-other', exp: 9_999_999_999 })).toString(
      'base64url',
    )
    assert.equal(verifyPreviewToken(`${forged}.${mac}`, 'shop-1', NOW), null)
    assert.equal(verifyPreviewToken(`${body}.${mac.slice(0, -2)}AA`, 'shop-1', NOW), null)
    assert.equal(verifyPreviewToken(`${body}.${'A'.repeat(mac.length)}`, 'shop-1', NOW), null)
  })

  test('something that is not a token is null, never an exception', () => {
    for (const bad of ['', 'x', '.', 'a.', '.b', 'not.a.token', 'e30.e30']) {
      assert.equal(verifyPreviewToken(bad, 'shop-1', NOW), null, bad)
    }
  })

  test('the signature depends on the secret: a token from another secret is refused', async () => {
    const { token } = createPreviewToken('shop-1', 'copy-9', NOW)
    const previous = process.env.SHOPNEX_SECRET
    process.env.SHOPNEX_SECRET = 'another-secret-another-secret-another-01'
    try {
      assert.equal(verifyPreviewToken(token, 'shop-1', NOW), null)
    } finally {
      process.env.SHOPNEX_SECRET = previous
    }
  })
})
