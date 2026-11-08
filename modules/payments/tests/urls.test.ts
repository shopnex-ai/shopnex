import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { PaymentError } from '../src/errors'
import { isHttpUrl } from '../src/sessions'

// What counts as a URL at all (the origin rule itself, shared by every kind of app, is tested in e2e/tests/app-origin.test.ts)
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
