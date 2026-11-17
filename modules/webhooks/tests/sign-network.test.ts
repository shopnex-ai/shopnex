// What receivers verify (Standard Webhooks signing) and what keeps a merchant's URL away from the platform's own network.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import { assertPublicHost } from '../src/network'
import { generateSecret, sign, signedHeaders } from '../src/sign'

describe('signing', () => {
  test('a secret is whsec_ and 24 random bytes in base64, and no two are the same', () => {
    const a = generateSecret()
    assert.match(a, /^whsec_[A-Za-z0-9+/]{32}$/)
    assert.equal(Buffer.from(a.slice(6), 'base64').length, 24)
    assert.notEqual(a, generateSecret())
  })

  test('the signature is HMAC-SHA256 over "id.timestamp.body", keyed with the secret’s bytes, as v1,<base64>', () => {
    const secret = 'whsec_' + Buffer.from('0123456789abcdef').toString('base64')
    const expected =
      'v1,' + createHmac('sha256', Buffer.from('0123456789abcdef')).update('msg_1.1700000000.{"a":1}').digest('base64')
    assert.equal(sign(secret, 'msg_1', 1_700_000_000, '{"a":1}'), expected)
    assert.notEqual(sign(secret, 'msg_1', 1_700_000_000, '{"a":2}'), expected, 'the body is signed')
    assert.notEqual(sign(secret, 'msg_2', 1_700_000_000, '{"a":1}'), expected, 'the id is signed')
    assert.notEqual(sign(secret, 'msg_1', 1_700_000_001, '{"a":1}'), expected, 'the timestamp is signed')
  })

  test('headers carry the id, the timestamp in seconds and the signature of that timestamp', () => {
    const secret = generateSecret()
    const now = new Date('2026-03-01T10:00:00.900Z')
    const headers = signedHeaders(secret, 'del_1', '{"x":true}', now)
    const timestamp = Math.floor(now.getTime() / 1000)
    assert.equal(headers['webhook-id'], 'del_1')
    assert.equal(headers['webhook-timestamp'], String(timestamp))
    assert.equal(headers['webhook-signature'], sign(secret, 'del_1', timestamp, '{"x":true}'))
    assert.equal(headers['content-type'], 'application/json')
    assert.equal(headers['user-agent'], 'Shopnex-Webhooks/1.0')
  })

  test('a retry signs a new timestamp, so its signature differs while the id stays', () => {
    const secret = generateSecret()
    const first = signedHeaders(secret, 'del_1', 'b', new Date(1_700_000_000_000))
    const retry = signedHeaders(secret, 'del_1', 'b', new Date(1_700_000_060_000))
    assert.equal(first['webhook-id'], retry['webhook-id'])
    assert.notEqual(first['webhook-signature'], retry['webhook-signature'])
  })
})

describe('assertPublicHost', () => {
  const refused = (host: string) => assertPublicHost(new URL(`http://${host}/hook`))

  test('refuses loopback, private, link-local (cloud metadata) and carrier-grade addresses', async () => {
    for (const host of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
    ])
      await assert.rejects(refused(host), /private network address/, host)
  })

  test('refuses the same in IPv6, including an IPv4 address written as IPv6', async () => {
    for (const host of ['[::1]', '[fc00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', '[::ffff:10.0.0.1]'])
      await assert.rejects(refused(host), /private network address/, host)
  })

  test('refuses a name that resolves to one', async () => {
    await assert.rejects(refused('localhost'), /private network address/)
  })

  test('lets a public address through', async () => {
    await refused('8.8.8.8')
    await refused('[2606:4700:4700::1111]')
    await refused('172.32.0.1')
  })
})
