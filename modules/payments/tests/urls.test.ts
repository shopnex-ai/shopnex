import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { PaymentError } from '../src/errors'
import { origin } from '../src/methods'
import { isHttpUrl } from '../src/sessions'

// An app's session URLs must stay on its own origin; these two decide what counts as a URL at all
describe('origin', () => {
  test('is the scheme, host and port without the path', () => {
    assert.equal(origin('https://app.example.com/pay/session?x=1#top'), 'https://app.example.com')
    assert.equal(origin('http://localhost:3100/app'), 'http://localhost:3100')
  })

  test('ignores the default port', () => {
    assert.equal(origin('https://app.example.com:443/x'), 'https://app.example.com')
  })

  test('is the real host when the URL tries to hide it behind credentials', () => {
    assert.equal(origin('https://shop.example.com@evil.example/pay'), 'https://evil.example')
  })

  test('differs for a lookalike subdomain, so it cannot pass an origin check', () => {
    assert.notEqual(origin('https://app.example.com.evil.example/x'), origin('https://app.example.com/x'))
  })

  test('is null for other schemes and for text that is not a URL', () => {
    for (const value of ['ftp://app.example.com', 'javascript:alert(1)', 'data:text/html,hi', 'not a url', '']) {
      assert.equal(origin(value), null, value)
    }
  })
})

describe('isHttpUrl', () => {
  test('accepts http and https URLs', () => {
    assert.equal(isHttpUrl('https://app.example.com/pay/1'), true)
    assert.equal(isHttpUrl('http://127.0.0.1:3100/pay/1'), true)
  })

  test('rejects other schemes and malformed values', () => {
    for (const value of [
      'javascript:alert(1)',
      'ftp://example.com',
      'file:///etc/passwd',
      '/relative/path',
      'pay',
      '',
    ]) {
      assert.equal(isHttpUrl(value), false, value)
    }
  })

  test('rejects values that are not strings', () => {
    for (const value of [undefined, null, 42, {}, ['https://example.com']]) {
      assert.equal(isHttpUrl(value), false)
    }
  })
})

describe('PaymentError', () => {
  test('carries its code and name', () => {
    const e = new PaymentError('NOT_PAYABLE', 'Already paid')
    assert.ok(e instanceof Error)
    assert.equal(e.code, 'NOT_PAYABLE')
    assert.equal(e.name, 'PaymentError')
  })
})
