import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { DomainError, challengeHost, normalizeDomain } from '../src/domains'

describe('normalizeDomain', () => {
  test('lowercases and strips what people paste', () => {
    assert.equal(normalizeDomain('  Shop.Acme.COM '), 'shop.acme.com')
    assert.equal(normalizeDomain('https://shop.acme.com/'), 'shop.acme.com')
    assert.equal(normalizeDomain('http://shop.acme.com/products?x=1'), 'shop.acme.com')
    assert.equal(normalizeDomain('shop.acme.com.'), 'shop.acme.com')
  })

  test('accepts hyphens, digits and punycode labels', () => {
    assert.equal(normalizeDomain('my-shop2.example.co.uk'), 'my-shop2.example.co.uk')
    assert.equal(normalizeDomain('xn--bcher-kva.example'), 'xn--bcher-kva.example')
  })

  test('rejects what is not a public hostname', () => {
    for (const bad of [
      '',
      'localhost',
      '127.0.0.1',
      '10.0.0.1',
      'shop.acme.com:3000',
      '-bad.example.com',
      'bad-.example.com',
      'sp ace.example.com',
      'a..example.com',
      `${'a'.repeat(64)}.example.com`,
      `${'a.'.repeat(130)}com`,
    ]) {
      assert.throws(
        () => normalizeDomain(bad),
        (error) => error instanceof DomainError && error.code === 'INVALID_DOMAIN',
        bad,
      )
    }
  })
})

test('the verification record lives under _shopnex-challenge', () => {
  assert.equal(challengeHost('shop.acme.com'), '_shopnex-challenge.shop.acme.com')
})
