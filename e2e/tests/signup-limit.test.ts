// The caps on open sign-up (modules/auth/src/signup-limit.ts): per address, for everyone, and where the address
// comes from. Pure functions, no running app needed.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
  checkSignupRate,
  clientIp,
  resetSignupLimits,
  signupsGlobal,
  signupsPerIp,
  takeGlobalSignup,
} from '@shopnex/auth/signup-limit'

const ENV = ['SIGNUP_RATE_PER_IP', 'SIGNUP_RATE_GLOBAL', 'CLIENT_IP_HEADER'] as const
const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]))
const from = (ip: string, header = 'x-forwarded-for') => new Headers({ [header]: ip })
const HOUR_MS = 60 * 60 * 1000

beforeEach(() => {
  for (const name of ENV) delete process.env[name]
  resetSignupLimits()
})

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  resetSignupLimits()
})

describe('limits from the environment', () => {
  test('defaults, and values that are not a positive number fall back to them', () => {
    assert.equal(signupsPerIp(), 5)
    assert.equal(signupsGlobal(), 200)
    for (const bad of ['', '0', '-3', 'abc']) {
      process.env.SIGNUP_RATE_PER_IP = bad
      assert.equal(signupsPerIp(), 5, `"${bad}"`)
    }
    process.env.SIGNUP_RATE_PER_IP = '2'
    process.env.SIGNUP_RATE_GLOBAL = '10'
    assert.equal(signupsPerIp(), 2)
    assert.equal(signupsGlobal(), 10)
  })
})

describe('client address', () => {
  test('a single x-forwarded-for value is used, a chain is not trusted', () => {
    assert.equal(clientIp(from('203.0.113.7')), '203.0.113.7')
    assert.equal(clientIp(from('2001:db8::1')), '2001:db8::1')
    assert.equal(clientIp(from('1.2.3.4, 203.0.113.7')), null)
    assert.equal(clientIp(from('not an address')), null)
    assert.equal(clientIp(new Headers()), null)
  })

  test('CLIENT_IP_HEADER picks the header (a list is tried in order)', () => {
    process.env.CLIENT_IP_HEADER = 'CF-Connecting-IP'
    assert.equal(clientIp(from('203.0.113.7', 'cf-connecting-ip')), '203.0.113.7')
    assert.equal(clientIp(from('203.0.113.7')), null, 'x-forwarded-for is no longer read')
    process.env.CLIENT_IP_HEADER = 'x-real-ip, cf-connecting-ip'
    assert.equal(clientIp(from('203.0.113.9', 'cf-connecting-ip')), '203.0.113.9')
  })
})

describe('per address cap', () => {
  test('allows the cap, then refuses with the time left, and other addresses are unaffected', () => {
    process.env.SIGNUP_RATE_PER_IP = '3'
    const now = Date.now()
    for (let i = 0; i < 3; i++) assert.equal(checkSignupRate(from('203.0.113.7'), now).ok, true)
    const over = checkSignupRate(from('203.0.113.7'), now + 1000)
    assert.equal(over.ok, false)
    assert.equal(over.ok ? 0 : over.retryAfterS, 3599)
    assert.equal(checkSignupRate(from('203.0.113.8'), now).ok, true)
  })

  test('frees up after the hour', () => {
    process.env.SIGNUP_RATE_PER_IP = '1'
    const now = Date.now()
    assert.equal(checkSignupRate(from('203.0.113.7'), now).ok, true)
    assert.equal(checkSignupRate(from('203.0.113.7'), now + HOUR_MS - 1).ok, false)
    assert.equal(checkSignupRate(from('203.0.113.7'), now + HOUR_MS).ok, true)
  })

  test('without a usable address the per address cap does not apply', () => {
    process.env.SIGNUP_RATE_PER_IP = '1'
    for (let i = 0; i < 5; i++) assert.equal(checkSignupRate(new Headers()).ok, true)
  })
})

describe('cap for everyone', () => {
  test('refuses once the cap is used, and frees up after the hour', () => {
    process.env.SIGNUP_RATE_GLOBAL = '3'
    const now = Date.now()
    for (let i = 0; i < 3; i++) assert.equal(takeGlobalSignup(now), null)
    assert.equal(takeGlobalSignup(now + 1000), 3599)
    assert.equal(takeGlobalSignup(now + HOUR_MS), null)
  })
})
