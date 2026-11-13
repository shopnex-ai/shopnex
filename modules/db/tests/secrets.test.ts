import assert from 'node:assert/strict'
import test, { afterEach, describe } from 'node:test'
import { decryptSecret, encryptSecret, sessionSecret } from '../src/secrets'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

describe('sessionSecret', () => {
  test('is BETTER_AUTH_SECRET when set, so installs that already use it keep their sessions', () => {
    process.env.BETTER_AUTH_SECRET = 'old-session-secret'
    process.env.SHOPNEX_SECRET = 'shopnex'
    assert.equal(sessionSecret(), 'old-session-secret')
  })

  test('is derived from SHOPNEX_SECRET otherwise, and differs from it', () => {
    delete process.env.BETTER_AUTH_SECRET
    process.env.SHOPNEX_SECRET = 'shopnex'
    const secret = sessionSecret()
    assert.match(secret ?? '', /^[0-9a-f]{64}$/)
    assert.equal(sessionSecret(), secret)
    process.env.SHOPNEX_SECRET = 'another'
    assert.notEqual(sessionSecret(), secret)
  })

  test('an empty BETTER_AUTH_SECRET (an unset compose variable) counts as unset', () => {
    process.env.BETTER_AUTH_SECRET = ''
    process.env.SHOPNEX_SECRET = 'shopnex'
    assert.match(sessionSecret() ?? '', /^[0-9a-f]{64}$/)
  })

  test('is undefined when neither is set, so a build without secrets still loads', () => {
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.SHOPNEX_SECRET
    assert.equal(sessionSecret(), undefined)
  })

  test('is not the key stored secrets are encrypted with', () => {
    delete process.env.BETTER_AUTH_SECRET
    process.env.SHOPNEX_SECRET = 'shopnex'
    assert.equal(decryptSecret(encryptSecret('hello')), 'hello')
    assert.notEqual(sessionSecret(), 'shopnex')
  })
})
