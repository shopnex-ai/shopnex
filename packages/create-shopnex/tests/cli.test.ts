import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const main = join(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')
const packageDir = join(dirname(main), '..')

/** A cache folder of its own and a download URL nothing answers on, so no test touches ~/.shopnex or the network */
const isolated = (cache = mkdtempSync(join(tmpdir(), 'create-shopnex-cache-'))) => ({
  ...process.env,
  SHOPNEX_APP_DIR: cache,
  SHOPNEX_BUNDLE_URL: 'http://127.0.0.1:1/shopnex.tgz',
})
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', main, ...args], {
    cwd: packageDir,
    encoding: 'utf8',
    env: isolated(),
  })

test('--help and --version', () => {
  assert.match(run('--help').stdout, /Usage/)
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+/)
})

test('without a connection it says what failed (exit 1)', () => {
  const result = run('--data', join(tmpdir(), 'create-shopnex-none'))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Could not download/)
})

test('--dry-run shows the data folder and the addresses, downloads nothing and starts nothing', () => {
  const cache = mkdtempSync(join(tmpdir(), 'create-shopnex-cache-'))
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', main, '--data', '/tmp/shop-data', '--port', '3100', '--storefront-port', '4400', '--dry-run'],
    { cwd: packageDir, encoding: 'utf8', env: isolated(cache) },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Data\s+\/tmp\/shop-data/)
  assert.match(result.stdout, /http:\/\/localhost:3100\/admin/)
  assert.match(result.stdout, /http:\/\/localhost:4400/)
  assert.match(result.stdout, /downloaded on the first run/)
  assert.match(result.stdout, /nothing was started/)
  assert.equal(readdirSync(cache).length, 0)
})

test('a usage mistake is exit 2 with a message, not a stack trace', () => {
  const result = run('--port', 'nope')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--port must be a port number/)
  assert.doesNotMatch(result.stderr, /at .*\.(mjs|ts)/)
})

test('a taken port is refused before anything is downloaded (exit 2)', async () => {
  const server = createServer((socket) => socket.end())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    // spawnSync would block this process, which is the one that has to accept the probe: run it asynchronously
    const child = spawn(process.execPath, ['--import', 'tsx', main, '--port', String(port), '--no-open'], {
      cwd: packageDir,
      env: isolated(),
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const code = await new Promise((resolve) => child.on('exit', resolve))
    assert.equal(code, 2)
    assert.match(stderr, new RegExp(`Port ${port} is already in use`))
  } finally {
    server.close()
  }
})
