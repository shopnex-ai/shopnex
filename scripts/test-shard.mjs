// Runs the unit tests of one shard: `node scripts/test-shard.mjs <shard> <of>` (1-based, e.g. `1 2`). CI runs the shards on
// separate runners (.github/workflows/ci.yaml); `pnpm test` still runs every package in one go.
//
// Every workspace package with a `test` script (except the e2e suite, which needs a running app) goes to exactly one shard.
// A package's weight is its number of test files: each file boots its own in-memory database, which is most of the cost.
// Packages are handed out heaviest first, each to the shard that is lightest so far, so the shards come out about even and
// the same packages land in the same shard on every run. `--list` prints the shards without running anything.
import { execFileSync, spawnSync } from 'node:child_process'
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
  const result = spawnSync('pnpm', [...mine.names.flatMap((name) => ['--filter', name]), 'test'], {
    cwd: root,
    stdio: 'inherit',
  })
  process.exit(result.status ?? 1)
}
