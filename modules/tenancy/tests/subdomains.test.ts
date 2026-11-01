import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { isSubdomainSlug, isUnderRoot, parseRootDomain, subdomainSlug, subdomainUrl } from '../src/subdomains'

const root = parseRootDomain('shopnex.app')!

describe('parseRootDomain', () => {
  test('reads a bare host, a URL or a host with a port', () => {
    assert.deepEqual(root, { host: 'shopnex.app', port: '', protocol: 'https' })
    assert.deepEqual(parseRootDomain(' HTTP://Shopnex.app/ '), { host: 'shopnex.app', port: '', protocol: 'http' })
    assert.deepEqual(parseRootDomain('localhost:4321', 'http://localhost:3000'), {
      host: 'localhost',
      port: '4321',
      protocol: 'http',
    })
  })

  test('the written protocol beats the app URL', () => {
    assert.equal(parseRootDomain('https://shopnex.app', 'http://localhost:3000')?.protocol, 'https')
    assert.equal(parseRootDomain('shopnex.app', 'https://admin.shopnex.app')?.protocol, 'https')
  })

  test('unset or invalid is null', () => {
    for (const bad of [undefined, '', '  ', 'a..b', 'bad host.com', '-x.com', 'shopnex.app:port']) {
      assert.equal(parseRootDomain(bad), null, String(bad))
    }
  })
})

describe('subdomainSlug', () => {
  test('a single label under the root is the slug', () => {
    assert.equal(subdomainSlug('acme.shopnex.app', root), 'acme')
    assert.equal(subdomainSlug('ACME-2.Shopnex.app', root), 'acme-2')
  })

  test('the root, deeper hosts, reserved labels and other hosts are not shops', () => {
    for (const host of [
      'shopnex.app',
      'a.b.shopnex.app',
      'www.shopnex.app',
      'admin.shopnex.app',
      'acme.example.com',
      'acmeshopnex.app',
    ]) {
      assert.equal(subdomainSlug(host, root), null, host)
    }
  })
})

test('isSubdomainSlug rejects what is not a hostname label', () => {
  assert.ok(isSubdomainSlug('acme'))
  for (const bad of ['', 'Acme', 'my_shop', '-acme', 'acme-', 'a.b', 'admin', 'default', 'a'.repeat(64)]) {
    assert.equal(isSubdomainSlug(bad), false, bad)
  }
})

test('isUnderRoot covers the root and everything below it', () => {
  assert.ok(isUnderRoot('shopnex.app', root))
  assert.ok(isUnderRoot('x.y.shopnex.app', root))
  assert.equal(isUnderRoot('notshopnex.app', root), false)
})

test('subdomainUrl keeps the protocol and port', () => {
  assert.equal(subdomainUrl('acme', root), 'https://acme.shopnex.app')
  assert.equal(subdomainUrl('acme', parseRootDomain('http://localhost:4321')!), 'http://acme.localhost:4321')
})
