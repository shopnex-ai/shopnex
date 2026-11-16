// `shopnex migrate-db` without a real build: a stub stands in for admin/migrate-db.mjs, so these tests cover what the
// command itself does (its checks, the backup, the .env) and what it hands to the script. The script is tested in
// modules/db/tests/move-data.test.ts.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const main = join(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')
const { version } = JSON.parse(readFileSync(join(dirname(main), '../package.json'), 'utf8')) as { version: string }
const TARGET = 'postgres://shop:secret@db.example.com:5432/shopnex'

/** A cache folder holding a "build" whose migrate-db.mjs writes what it was given and exits with STUB_EXIT */
function fakeBuild(withScript = true) {
  const cache = mkdtempSync(join(tmpdir(), 'shopnex-cache-'))
  const root = join(cache, version)
  mkdirSync(join(root, 'admin'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version }))
  if (withScript) {
    writeFileSync(
      join(root, 'admin/migrate-db.mjs'),
      `import { writeFileSync } from 'node:fs'
       const { SOURCE_DATABASE_URL: source, TARGET_DATABASE_URL: target, SHOPNEX_MIGRATIONS_DIR: migrations } = process.env
       writeFileSync(process.env.STUB_OUT, JSON.stringify({ source, target, migrations }))
       process.exit(Number(process.env.STUB_EXIT ?? 0))`,
    )
  }
  return { cache, root }
}

/** A shop folder on the embedded database, with some data in it */
function shop(env = 'DATABASE_URL=pglite:./.pglite\nSHOPNEX_SECRET=abc\n') {
  const dir = mkdtempSync(join(tmpdir(), 'shopnex-shop-'))
  writeFileSync(join(dir, '.env'), env)
  mkdirSync(join(dir, '.pglite'))
  writeFileSync(join(dir, '.pglite/PG_VERSION'), '17')
  return dir
}

function run(args: string[], { cache = fakeBuild().cache, exit = 0, extra = {} as Record<string, string> } = {}) {
  const out = join(mkdtempSync(join(tmpdir(), 'shopnex-out-')), 'seen.json')
  const result = spawnSync(process.execPath, ['--import', 'tsx', main, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SHOPNEX_APP_DIR: cache, STUB_OUT: out, STUB_EXIT: String(exit), ...extra },
  })
  return {
    ...result,
    seen: existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>) : undefined,
  }
}

test('the data is copied by the build’s script, then the .env points at PostgreSQL and the old data stays', () => {
  const dir = shop()
  const build = fakeBuild()
  const result = run(['migrate-db', '--dir', dir, '--to', TARGET, '--port', '39871'], { cache: build.cache })
  assert.equal(result.status, 0, result.stderr + result.stdout)

  // What the script got: the shop's database, the new one, and the migrations of the same build
  assert.deepEqual(result.seen, {
    source: `pglite:${join(dir, '.pglite')}`,
    target: TARGET,
    migrations: join(build.root, 'migrations'),
  })
  const env = readFileSync(join(dir, '.env'), 'utf8')
  assert.match(env, new RegExp(`^DATABASE_URL=${TARGET}$`, 'm'))
  assert.match(env, /^# DATABASE_URL=pglite:\.\/\.pglite {3}\(before shopnex migrate-db, \d{4}-\d\d-\d\d\)$/m)
  assert.match(env, /^SHOPNEX_SECRET=abc$/m)
  // A copy of the data was made before the script ran; the original is still there
  const backups = readdirSync(dir).filter((name) => name.startsWith('.pglite.bak-'))
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(join(dir, backups[0]!, 'PG_VERSION'), 'utf8'), '17')
  assert.ok(existsSync(join(dir, '.pglite/PG_VERSION')))
  assert.doesNotMatch(result.stdout + result.stderr, /secret/, 'the password is not printed')
})

test('the address can come from an environment variable, so it stays out of the shell history', () => {
  const dir = shop()
  const result = run(['migrate-db', '--dir', dir, '--to-env', 'SHOP_TARGET', '--port', '39871'], {
    extra: { SHOP_TARGET: TARGET },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.seen?.target, TARGET)
})

test('when the script fails the .env is not touched, no copy is left behind, and the message says so', () => {
  const dir = shop()
  const before = readFileSync(join(dir, '.env'), 'utf8')
  const result = run(['migrate-db', '--dir', dir, '--to', TARGET, '--port', '39871'], { exit: 1 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Nothing was changed/)
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), before)
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.includes('.bak-')),
    [],
  )
  assert.ok(existsSync(join(dir, '.pglite/PG_VERSION')))
})

test('a running shop is not touched: something answers on the admin port', async () => {
  const server = createServer().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const port = (server.address() as { port: number }).port
    const dir = shop()
    const result = run(['migrate-db', '--dir', dir, '--to', TARGET, '--port', String(port)])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /stop the shop first/)
    assert.equal(result.seen, undefined)
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.includes('.bak-')),
      [],
    )
  } finally {
    server.close()
  }
})

test('the mistakes it can tell before doing anything are usage errors (exit 2) and change nothing', () => {
  const port = ['--port', '39871']
  const dir = shop()
  const ok = ['migrate-db', '--dir', dir, '--to', TARGET, ...port]
  const cases: [string[], RegExp, Record<string, string>?][] = [
    [['migrate-db', '--dir', dir, ...port], /Give where to move/],
    [['migrate-db', '--dir', dir, '--to', TARGET, '--to-env', 'X', ...port], /Give where to move/],
    [['migrate-db', '--dir', dir, '--to-env', 'NOT_SET_ANYWHERE', ...port], /NOT_SET_ANYWHERE is not set/],
    [['migrate-db', '--dir', dir, '--to', 'mysql://root@db/shop', ...port], /must be a postgres:\/\/ address/],
    [['migrate-db', '--dir', tmpdir(), '--to', TARGET, ...port], /not a ShopNex shop/],
    [
      ['migrate-db', '--dir', shop('DATABASE_URL=postgres://u:pw@old/shop\n'), '--to', TARGET, ...port],
      /already uses PostgreSQL \(postgres:\/\/u:\*\*\*@old/,
    ],
    [['upgrade'], /Unknown command "upgrade"/],
  ]
  for (const [args, message] of cases) {
    const result = run(args)
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`)
    assert.match(result.stderr, message)
    assert.equal(result.seen, undefined)
  }
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.includes('.bak-')),
    [],
  )
  assert.equal(run(ok).status, 0)
})

test('a shop that never ran has no data to move', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopnex-shop-'))
  writeFileSync(join(dir, '.env'), 'DATABASE_URL=pglite:./.pglite\nSHOPNEX_SECRET=abc\n')
  const result = run(['migrate-db', '--dir', dir, '--to', TARGET, '--port', '39871'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /no data to move/)
})

test('a build without the script says so', () => {
  const result = run(['migrate-db', '--dir', shop(), '--to', TARGET, '--port', '39871'], {
    cache: fakeBuild(false).cache,
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /cannot move a database yet/)
})

test('apps with data of their own are named, because their data is not moved', () => {
  const dir = shop()
  mkdirSync(join(dir, 'apps/cj-dropshipping/.pglite'), { recursive: true })
  const result = run(['migrate-db', '--dir', dir, '--to', TARGET, '--port', '39871'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /apps\/cj-dropshipping/)
})

test('--help and --version', () => {
  assert.match(run(['--help']).stdout, /migrate-db/)
  assert.match(run(['--version']).stdout, /^\d+\.\d+\.\d+/)
  assert.match(run([]).stdout, /Usage/)
})
