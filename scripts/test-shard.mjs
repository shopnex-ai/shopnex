// Runs the unit tests of one shard: `node scripts/test-shard.mjs <shard> <of>` (1-based, e.g. `1 2`). CI runs the shards on
// separate runners (.github/workflows/ci.yaml); `pnpm test` still runs every package in one go.
//
// Every workspace package with a `test` script (except the e2e suite, which needs a running app) goes to exactly one shard.
// A package's weight is its number of test files: each file boots its own in-memory database, which is most of the cost.
// Packages are handed out heaviest first, each to the shard that is lightest so far, so the shards come out about even and
// the same packages land in the same shard on every run. `--list` prints the shards without running anything.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.next'])
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mjs|js)$/

function countTestFiles(dir) {
  let n = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.isDirectory()) n += countTestFiles(join(dir, entry.name))
    else if (TEST_FILE.test(entry.name)) n++
  }
  return n
}

/** The workspace packages that have unit tests, heaviest first (ties by name) */
export function testPackages() {
  const listed = JSON.parse(
    execFileSync('pnpm', ['-r', 'ls', '--json', '--depth', '-1'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }),
  )
  return listed
    .filter((pkg) => resolve(pkg.path) !== root)
    .map((pkg) => ({
      name: pkg.name,
      json: JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8')),
      path: pkg.path,
    }))
    .filter((pkg) => pkg.json.scripts?.test && pkg.name !== '@shopnex/e2e')
    .map((pkg) => ({ name: pkg.name, weight: Math.max(1, existsSync(pkg.path) ? countTestFiles(pkg.path) : 1) }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
}

export function shards(packages, count) {
  const out = Array.from({ length: count }, () => ({ weight: 0, names: [] }))
  for (const pkg of packages) {
    const lightest = out.reduce((a, b) => (b.weight < a.weight ? b : a))
    lightest.weight += pkg.weight
    lightest.names.push(pkg.name)
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const list = args.includes('--list')
  const [shard, of] = args.filter((a) => !a.startsWith('--')).map(Number)
  if (!Number.isInteger(shard) || !Number.isInteger(of) || shard < 1 || of < 1 || shard > of) {
    console.error('usage: node scripts/test-shard.mjs <shard> <of> [--list]   (for example: 1 2)')
    process.exit(2)
  }
  const packages = testPackages()
  const all = shards(packages, of)
  // Every package is in exactly one shard
  const assigned = all.flatMap((s) => s.names)
  if (assigned.length !== packages.length || new Set(assigned).size !== packages.length) {
    throw new Error('the shards do not cover each package exactly once')
  }
  const mine = all[shard - 1]
  console.log(`shard ${shard}/${of}: ${mine.names.length} packages, weight ${mine.weight}: ${mine.names.join(', ')}`)
  if (list) {
    all.forEach((s, i) => console.log(`  ${i + 1}: weight ${s.weight}  ${s.names.join(' ')}`))
    process.exit(0)
  }
  const pnpmArgs = [...mine.names.flatMap((name) => ['--filter', name]), 'test']
  let result = await run(pnpmArgs)
  // Node 24.22.0 sometimes dies with a V8 internal error in a test process (a fatal `jit_page` check, seen on unrelated pull
  // requests in files that boot the in-memory database). That is the runtime, not the test, so a shard that failed and shows
  // that crash is run once more; any other failure, or a second crash, fails as usual.
  if (result.code !== 0 && isV8Crash(result.output)) {
    console.warn('\n::warning::A test process crashed inside V8 (not a test failure). Running the shard once more.\n')
    result = await run(pnpmArgs)
  }
  process.exit(result.code)
}

/** True when the output holds V8's fatal error from the `jit_page` check (a bug in the runtime, not in a test) */
export function isV8Crash(output) {
  return /Fatal error in[^\n]*\n(?:[^\n]*\n){0,3}[^\n]*Check failed: jit_page\.has_value\(\)/.test(output)
}

// Runs pnpm, showing its output as it comes and keeping a copy to look at afterwards
function run(args) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', args, { cwd: root, stdio: ['inherit', 'pipe', 'pipe'] })
    let output = ''
    for (const [from, to] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      from.on('data', (chunk) => {
        output += chunk
        to.write(chunk)
      })
    }
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}
