import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from '../src/args'
import { UsageError } from '../src/errors'

test('defaults: the ports, the browser opens, nothing is deleted', () => {
  const options = parse([])
  assert.equal(options.port, 3000)
  assert.equal(options.storefrontPort, 4321)
  assert.equal(options.open, true)
  assert.equal(options.reset, false)
  assert.equal(options.from, undefined)
})

test('flags are read', () => {
  const options = parse([
    '--port',
    '3100',
    '--storefront-port',
    '4400',
    '--no-open',
    '--data',
    '/tmp/x',
    '--from',
    '/repo',
    '--dry-run',
  ])
  assert.deepEqual(
    [options.port, options.storefrontPort, options.open, options.data, options.from, options.dryRun],
    [3100, 4400, false, '/tmp/x', '/repo', true],
  )
})

test('a bad port, the same port twice and an unknown flag are usage errors', () => {
  const bad = [
    ['--port', 'abc'],
    ['--port', '70000'],
    ['--port', '0'],
    ['--port', '4000', '--storefront-port', '4000'],
    ['--nope'],
    ['stray'],
  ]
  for (const argv of bad) assert.throws(() => parse(argv), UsageError, argv.join(' '))
})

test('--app and --verbose are read, and are off by default', () => {
  assert.equal(parse([]).app, undefined)
  assert.equal(parse([]).verbose, false)
  const options = parse(['--app', 'shop', '--verbose'])
  assert.deepEqual([options.app, options.verbose], ['shop', true])
})
