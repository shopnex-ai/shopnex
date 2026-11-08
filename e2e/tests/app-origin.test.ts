// An app's URLs (session, rates, capabilities) must stay on its own origin, or it could point the server at someone
// else's, or at the internal network. The rule is one function shared by payments, carrier and AI apps (onAppOrigin);
// these cases decide what counts as the same origin. Pure: no database, no app.
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { httpOrigin, onAppOrigin } from '@shopnex/apps'
import { closeDb } from '../lib'

after(closeDb)

describe('httpOrigin', () => {
  test('is the scheme, host and port without the path', () => {
    assert.equal(httpOrigin('https://app.example.com/pay/session?x=1#top'), 'https://app.example.com')
    assert.equal(httpOrigin('http://localhost:3100/app'), 'http://localhost:3100')
  })

  test('ignores the default port', () => {
    assert.equal(httpOrigin('https://app.example.com:443/x'), 'https://app.example.com')
  })

  test('is the real host when the URL tries to hide it behind credentials', () => {
    assert.equal(httpOrigin('https://shop.example.com@evil.example/pay'), 'https://evil.example')
  })

  test('differs for a lookalike subdomain, so it cannot pass an origin check', () => {
    assert.notEqual(httpOrigin('https://app.example.com.evil.example/x'), httpOrigin('https://app.example.com/x'))
  })

  test('is null for other schemes and for text that is not a URL', () => {
    for (const value of ['ftp://app.example.com', 'javascript:alert(1)', 'data:text/html,hi', 'not a url', '']) {
      assert.equal(httpOrigin(value), null, value)
    }
  })
})

describe('onAppOrigin', () => {
  const app = 'https://app.example.com/app'

  test('URLs on the app’s origin pass, whatever their path', () => {
    const r = onAppOrigin(app, [
      'https://app.example.com/pay',
      'https://app.example.com/refund?x=1',
      'https://APP.example.com:443/',
    ])
    assert.equal(r.ok, true)
    assert.equal(r.appOrigin, 'https://app.example.com')
  })

  test('a different host, port or scheme is another origin', () => {
    for (const url of [
      'https://evil.example/pay',
      'https://app.example.com:8443/pay',
      'http://app.example.com/pay',
      'https://app.example.com.evil.example/pay',
      'https://app.example.com@evil.example/pay',
      'https://sub.app.example.com/pay',
    ]) {
      assert.equal(onAppOrigin(app, [url]).ok, false, url)
    }
  })

  test('one URL off the origin is enough to refuse the lot', () => {
    assert.equal(onAppOrigin(app, ['https://app.example.com/a', 'https://evil.example/b']).ok, false)
  })

  test('a URL that is not http(s) is refused, so is one that is not a URL', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', '//app.example.com/pay', '/pay', '']) {
      assert.equal(onAppOrigin(app, [url]).ok, false, url)
    }
  })

  test('an app whose own URL is not an http(s) URL has no origin, so nothing is on it', () => {
    for (const bad of ['ftp://app.example.com', 'nonsense', '']) {
      const r = onAppOrigin(bad, ['https://app.example.com/pay'])
      assert.equal(r.ok, false, bad)
      assert.equal(r.appOrigin, null)
    }
  })

  test('no URLs is fine (an AI app clearing its capabilities), even if the app’s own URL is odd', () => {
    assert.equal(onAppOrigin(app, []).ok, true)
    assert.equal(onAppOrigin('nonsense', []).ok, true)
  })

  test('a local app is on its own local origin', () => {
    assert.equal(onAppOrigin('http://localhost:4600/app', ['http://localhost:4600/session']).ok, true)
    assert.equal(onAppOrigin('http://localhost:4600/app', ['http://localhost:4601/session']).ok, false)
  })
})
