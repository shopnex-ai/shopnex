import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNewer, newerVersion, shouldCheck, UPDATED_ENV } from '../src/self-update'

const json = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as typeof fetch

test('only a higher release counts as newer (compared by number, prereleases never)', () => {
  assert.equal(isNewer('0.17.0', '0.16.0'), true)
  assert.equal(isNewer('0.16.10', '0.16.9'), true)
  assert.equal(isNewer('1.0.0', '0.99.99'), true)
  assert.equal(isNewer('0.16.0', '0.16.0'), false)
  assert.equal(isNewer('0.15.9', '0.16.0'), false)
  assert.equal(isNewer('0.17.0-edge.abc', '0.16.0'), false)
  assert.equal(isNewer('0.17.0', '0.16.0-edge.abc'), false)
})

test('the registry answer is used only when it is newer', async () => {
  assert.equal(await newerVersion('0.16.0', json({ version: '0.17.0' })), '0.17.0')
  assert.equal(await newerVersion('0.16.0', json({ version: '0.16.0' })), undefined)
  assert.equal(await newerVersion('0.17.0', json({ version: '0.16.0' })), undefined)
})

test('a failing, slow, odd or offline registry never blocks the run', async () => {
  assert.equal(await newerVersion('0.16.0', json({}, 500)), undefined)
  assert.equal(await newerVersion('0.16.0', json({ version: 5 })), undefined)
  assert.equal(await newerVersion('0.16.0', (async () => new Response('not json')) as typeof fetch), undefined)
  assert.equal(
    await newerVersion('0.16.0', (async () => Promise.reject(new Error('offline'))) as typeof fetch),
    undefined,
  )
})

test('no check from a checkout, an edge build, CI, the re-run or with --no-update-check', () => {
  const base = { version: '0.16.0', fromSource: false, disabled: false, env: {} }
  assert.equal(shouldCheck(base), true)
  assert.equal(shouldCheck({ ...base, fromSource: true }), false)
  assert.equal(shouldCheck({ ...base, disabled: true }), false)
  assert.equal(shouldCheck({ ...base, version: '0.17.0-edge.abc' }), false)
  assert.equal(shouldCheck({ ...base, env: { CI: 'true' } }), false)
  assert.equal(shouldCheck({ ...base, env: { [UPDATED_ENV]: '1' } }), false)
})
