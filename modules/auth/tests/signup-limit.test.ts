// The in-memory limits for open sign-up: where the visitor's address comes from, and the two hourly caps. Pure functions, no database.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
  checkSignupRate,
  clientIp,
  clientIpHeaders,
  resetSignupLimits,
  signupsGlobal,
  signupsPerIp,
  takeGlobalSignup,
} from '../src/signup-limit'

const env = { ...process.env }
const from = (headers: Record<string, string>) => new Headers(headers)

beforeEach(() => {
  resetSignupLimits()
  delete process.env.CLIENT_IP_HEADER
  delete process.env.SIGNUP_RATE_PER_IP
  delete process.env.SIGNUP_RATE_GLOBAL
})
afterEach(() => {
  process.env = { ...env }
})

describe('the visitor’s address', () => {
  test('is x-forwarded-for by default, lower-cased, for IPv4 and IPv6', () => {
    assert.equal(clientIp(from({ 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7')
    assert.equal(clientIp(from({ 'x-forwarded-for': '2001:DB8::1' })), '2001:db8::1')
  })

  test('a header with several values is never trusted: the left ones are chosen by the client', () => {
    assert.equal(clientIp(from({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })), null)
  })

  test('something that is not an address is refused', () => {
    for (const value of ['not-an-ip', 'a', '1.2.3.4/32', '<script>', ''])
      assert.equal(clientIp(from({ 'x-forwarded-for': value })), null, value)
  })

  test('CLIENT_IP_HEADER names the header (a comma list, first hit wins) and the default no longer applies', () => {
    process.env.CLIENT_IP_HEADER = ' CF-Connecting-IP , x-real-ip '
    assert.deepEqual(clientIpHeaders(), ['cf-connecting-ip', 'x-real-ip'])
    assert.equal(clientIp(from({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '203.0.113.7' })), '198.51.100.2')
    assert.equal(clientIp(from({ 'cf-connecting-ip': '198.51.100.9', 'x-real-ip': '198.51.100.2' })), '198.51.100.9')
    assert.equal(clientIp(from({ 'x-forwarded-for': '203.0.113.7' })), null)
  })

  test('an empty CLIENT_IP_HEADER is the default', () => {
    process.env.CLIENT_IP_HEADER = ' , '
    assert.deepEqual(clientIpHeaders(), ['x-forwarded-for'])
  })
})

describe('the caps', () => {
  test('default to 5 per address and 200 for everyone; a number that makes no sense is the default', () => {
    assert.equal(signupsPerIp(), 5)
    assert.equal(signupsGlobal(), 200)
    for (const bad of ['0', '-3', 'many', '']) {
      process.env.SIGNUP_RATE_PER_IP = bad
      assert.equal(signupsPerIp(), 5, bad)
    }
    process.env.SIGNUP_RATE_PER_IP = '2'
    process.env.SIGNUP_RATE_GLOBAL = '9'
    assert.equal(signupsPerIp(), 2)
    assert.equal(signupsGlobal(), 9)
  })

  test('one address can sign up 5 times in an hour; the 6th is told how long to wait', () => {
    const headers = from({ 'x-forwarded-for': '203.0.113.7' })
    const t0 = 1_000_000
    for (let i = 0; i < 5; i++) assert.deepEqual(checkSignupRate(headers, t0 + i * 1000), { ok: true })
    const sixth = checkSignupRate(headers, t0 + 10_000)
    assert.equal(sixth.ok, false)
    assert.equal(sixth.ok === false && sixth.retryAfterS, 3590)
  })

  test('another address has its own count, and the hour starts again after it passes', () => {
    process.env.SIGNUP_RATE_PER_IP = '1'
    const a = from({ 'x-forwarded-for': '203.0.113.7' })
    const b = from({ 'x-forwarded-for': '203.0.113.8' })
    assert.equal(checkSignupRate(a, 0).ok, true)
    assert.equal(checkSignupRate(a, 1).ok, false)
    assert.equal(checkSignupRate(b, 1).ok, true)
    assert.equal(checkSignupRate(a, 3_600_000).ok, true, 'a new hour')
  })

  test('without a usable address only the global cap applies: the per-address one never refuses', () => {
    process.env.SIGNUP_RATE_PER_IP = '1'
    const nobody = from({})
    for (let i = 0; i < 10; i++) assert.equal(checkSignupRate(nobody, i).ok, true)
  })

  test('the global cap counts every new account and says how long to wait once it is used up', () => {
    process.env.SIGNUP_RATE_GLOBAL = '3'
    assert.equal(takeGlobalSignup(0), null)
    assert.equal(takeGlobalSignup(1), null)
    assert.equal(takeGlobalSignup(2), null)
    assert.equal(takeGlobalSignup(1000), 3599)
    assert.equal(takeGlobalSignup(3_600_000), null, 'a new hour')
  })

  test('a refused attempt is not counted against the address', () => {
    process.env.SIGNUP_RATE_PER_IP = '2'
    const h = from({ 'x-forwarded-for': '203.0.113.7' })
    checkSignupRate(h, 0)
    checkSignupRate(h, 1)
    for (let i = 0; i < 20; i++) assert.equal(checkSignupRate(h, 2 + i).ok, false)
    assert.equal(checkSignupRate(h, 3_600_000).ok, true, 'and it frees up exactly an hour after the first use')
  })
})
