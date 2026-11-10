import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', join(packageDir, 'src/main.ts'), ...args], {
    cwd: packageDir,
    encoding: 'utf8',
  })

/** A folder with just the files that make it look like a checkout */
function fakeCheckout() {
  const root = mkdtempSync(join(tmpdir(), 'create-shopnex-checkout-'))
  for (const file of [
    'apps/admin-ui/package.json',
    'templates/storefront/package.json',
    'modules/db/migrations/meta/_journal.json',
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), '{}')
  }
  return root
}

test('--help and --version', () => {
  assert.match(run('--help').stdout, /Usage/)
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+/)
})

test('without --from it says the packaged build is not available yet (exit 1)', () => {
  const result = run('--data', join(tmpdir(), 'create-shopnex-none'))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not available yet/)
})

test('a folder that is not a checkout is refused (exit 2)', () => {
  const result = run('--from', tmpdir())
  assert.equal(result.status, 2)
  assert.match(result.stderr, /does not look like a ShopNex checkout/)
})

test('--dry-run shows the data folder and the addresses and starts nothing', () => {
  const result = run(
    '--from',
    fakeCheckout(),
    '--data',
    '/tmp/shop-data',
    '--port',
    '3100',
    '--storefront-port',
    '4400',
    '--dry-run',
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Data\s+\/tmp\/shop-data/)
  assert.match(result.stdout, /http:\/\/localhost:3100\/admin/)
  assert.match(result.stdout, /http:\/\/localhost:4400/)
  assert.match(result.stdout, /nothing was started/)
})

test('a usage mistake is exit 2 with a message, not a stack trace', () => {
  const result = run('--port', 'nope')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--port must be a port number/)
  assert.doesNotMatch(result.stderr, /at .*\.(mjs|ts)/)
})

test('a taken port is refused before anything starts (exit 2)', async () => {
  const { createServer } = await import('node:net')
  const server = createServer((socket) => socket.end())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as import('node:net').AddressInfo
  try {
    // spawnSync would block this process, which is the one that has to accept the probe: run it asynchronously
    const { spawn } = await import('node:child_process')
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        join(packageDir, 'src/main.ts'),
        '--from',
        fakeCheckout(),
        '--port',
        String(port),
        '--no-open',
      ],
      { cwd: packageDir },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const code = await new Promise((resolve) => child.on('exit', resolve))
    assert.equal(code, 2)
    assert.match(stderr, new RegExp(`Port ${port} is already in use`))
  } finally {
    server.close()
  }
})
