import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { bundleDir, bundleUrl, isEdge, isInstalled, resolveBundle } from '../src/bundle'
import { UnavailableError } from '../src/errors'

/** A tgz like the release's, for `version`, and the checksum file's text */
function fixture(version: string, { manifestVersion = version, content = '// admin' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'create-shopnex-fixture-'))
  const stage = join(dir, 'stage')
  mkdirSync(join(stage, 'admin'), { recursive: true })
  writeFileSync(join(stage, 'admin/server.mjs'), content)
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ version: manifestVersion }))
  const file = join(dir, 'bundle.tgz')
  assert.equal(spawnSync('tar', ['-czf', file, '-C', stage, '.']).status, 0)
  const bytes = readFileSync(file)
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') }
}

let requests: string[] = []
let routes: Record<string, { status?: number; body: Buffer | string }> = {}
const server: Server = createServer((request, response) => {
  requests.push(request.url ?? '')
  const route = routes[request.url ?? '']
  response.statusCode = route?.status ?? (route ? 200 : 404)
  response.end(route?.body ?? 'not found')
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
after(() => void server.close())

beforeEach(() => {
  requests = []
  routes = {}
  process.env.SHOPNEX_APP_DIR = mkdtempSync(join(tmpdir(), 'create-shopnex-cache-'))
  process.env.SHOPNEX_BUNDLE_URL = `${base}/shopnex.tgz`
})

const publish = (bundle: { bytes: Buffer; sha: string }, sha = bundle.sha) => {
  routes['/shopnex.tgz'] = { body: bundle.bytes }
  routes['/shopnex.tgz.sha256'] = { body: `${sha}  shopnex-v1.0.0-node.tgz\n` }
}

test('the default URL is the release asset of the same version', () => {
  delete process.env.SHOPNEX_BUNDLE_URL
  assert.equal(
    bundleUrl('0.14.0'),
    'https://github.com/shopnex-ai/shopnex/releases/download/v0.14.0/shopnex-v0.14.0-node.tgz',
  )
})

test('it downloads, checks the checksum, unpacks into the version folder, and the second run downloads nothing', async () => {
  publish(fixture('1.0.0'))
  const dir = await resolveBundle({ version: '1.0.0' })
  assert.equal(dir, bundleDir('1.0.0'))
  assert.ok(isInstalled('1.0.0'))
  assert.equal(readFileSync(join(dir, 'admin/server.mjs'), 'utf8'), '// admin')
  assert.equal(requests.length, 2) // the checksum and the file

  requests = []
  assert.equal(await resolveBundle({ version: '1.0.0' }), dir)
  assert.deepEqual(requests, [])
})

test('a download that does not match its checksum installs nothing and leaves nothing behind', async () => {
  publish(fixture('1.0.0'), 'a'.repeat(64))
  await assert.rejects(resolveBundle({ version: '1.0.0' }), (error: Error) => {
    assert.ok(error instanceof UnavailableError)
    assert.match(error.message, /damaged/)
    return true
  })
  assert.equal(isInstalled('1.0.0'), false)
  assert.deepEqual(readdirSync(process.env.SHOPNEX_APP_DIR as string), [])
})

test('a build of another version is refused', async () => {
  publish(fixture('1.0.0', { manifestVersion: '2.0.0' }))
  await assert.rejects(resolveBundle({ version: '1.0.0' }), /manifest says 2\.0\.0/)
  assert.equal(isInstalled('1.0.0'), false)
})

test('a version that was never released says so, and points at --from', async () => {
  await assert.rejects(resolveBundle({ version: '1.0.0' }), (error: Error) => {
    assert.match(error.message, /no packaged build/)
    assert.match(error.message, /--from/)
    return true
  })
})

test('no connection is a readable error, not a stack trace', async () => {
  process.env.SHOPNEX_BUNDLE_URL = 'http://127.0.0.1:1/shopnex.tgz'
  await assert.rejects(resolveBundle({ version: '1.0.0' }), /Could not download the checksum/)
})

test('a folder without manifest.json is a leftover: it is replaced, not trusted', async () => {
  mkdirSync(bundleDir('1.0.0'), { recursive: true })
  writeFileSync(join(bundleDir('1.0.0'), 'half'), 'x')
  assert.equal(isInstalled('1.0.0'), false)
  publish(fixture('1.0.0'))
  await resolveBundle({ version: '1.0.0' })
  assert.equal(existsSync(join(bundleDir('1.0.0'), 'half')), false)
  assert.ok(isInstalled('1.0.0'))
})

const EDGE = '0.0.0-edge.abc1234'
const keyOf = (bundle: { sha: string }) => `edge-${bundle.sha.slice(0, 12)}`

test('an edge version reads the rolling edge release, a normal one its own', () => {
  delete process.env.SHOPNEX_BUNDLE_URL
  assert.ok(isEdge(EDGE) && !isEdge('0.14.0') && !isEdge('1.0.0-rc.1'))
  assert.equal(bundleUrl(EDGE), 'https://github.com/shopnex-ai/shopnex/releases/download/edge/shopnex-edge-node.tgz')
})

test('edge: named by its checksum, so the next run only asks for the checksum', async () => {
  const build = fixture(EDGE, { manifestVersion: '0.0.0-edge.def5678' }) // built by a later push than this CLI
  publish(build)
  const dir = await resolveBundle({ version: EDGE })
  assert.equal(dir, bundleDir(keyOf(build)))
  assert.ok(isInstalled(keyOf(build)))
  assert.equal(requests.length, 2)

  requests = []
  assert.equal(await resolveBundle({ version: EDGE }), dir)
  assert.deepEqual(requests, ['/shopnex.tgz.sha256'])
})

test('edge: a new build downloads again and the old one is removed', async () => {
  const first = fixture(EDGE, { content: '// one' })
  publish(first)
  await resolveBundle({ version: EDGE })
  const second = fixture(EDGE, { content: '// two' })
  publish(second)
  await resolveBundle({ version: EDGE })
  assert.deepEqual(readdirSync(process.env.SHOPNEX_APP_DIR as string), [keyOf(second)])
})

test('edge: without a connection it runs the build it has, and says so', async () => {
  const build = fixture(EDGE)
  publish(build)
  await resolveBundle({ version: EDGE })
  process.env.SHOPNEX_BUNDLE_URL = 'http://127.0.0.1:1/shopnex.tgz'
  assert.equal(await resolveBundle({ version: EDGE }), bundleDir(keyOf(build)))
})

test('edge: without a connection and nothing downloaded it is the usual error', async () => {
  process.env.SHOPNEX_BUNDLE_URL = 'http://127.0.0.1:1/shopnex.tgz'
  await assert.rejects(resolveBundle({ version: EDGE }), /Could not download the checksum/)
})
