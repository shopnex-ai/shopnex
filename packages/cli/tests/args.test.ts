import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageError } from '@shopnex/cli-core/errors'
import { parse } from '../src/args'

test('defaults: the current folder and the admin on 3000', () => {
  assert.deepEqual(parse(['migrate-db', '--to', 'postgres://db/shop']), {
    command: 'migrate-db',
    rest: [],
    to: 'postgres://db/shop',
    toEnv: undefined,
    dir: '.',
    port: 3000,
    help: false,
    version: false,
  })
})

test('--to-env, --dir and --port', () => {
  const options = parse(['migrate-db', '--to-env', 'TARGET', '--dir', '../my-shop', '--port', '3100'])
  assert.deepEqual([options.toEnv, options.dir, options.port], ['TARGET', '../my-shop', 3100])
})

test('an unknown flag, two commands and a bad port are usage errors', () => {
  assert.throws(() => parse(['--nope']), UsageError)
  assert.throws(() => parse(['migrate-db', 'upgrade']), /one command/)
  assert.throws(() => parse(['migrate-db', '--port', '70000']), /--port/)
})

test('generate takes a kind and a name, other commands take no more than one word', () => {
  assert.deepEqual(parse(['generate', 'app', 'my-app']).rest, ['app', 'my-app'])
})
