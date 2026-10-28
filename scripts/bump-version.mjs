// Sets the release version in every package.json that has a "version" field.
//   node scripts/bump-version.mjs patch|minor|major   → bumps the latest git tag
//   node scripts/bump-version.mjs 1.2.3               → sets that exact version
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const arg = process.argv[2]
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

let next = arg
if (['patch', 'minor', 'major'].includes(arg)) {
  const [major, minor, patch] = git('describe', '--tags', '--abbrev=0')
    .replace(/^v/, '')
    .split('-')[0]
    .split('.')
    .map(Number)
  next = {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
  }[arg]
}
if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
  console.error('Usage: pnpm bump <patch|minor|major|x.y.z>')
  process.exit(1)
}

// Versioned on its own: the storefront API contract, not the Shopnex release
const independent = new Set(['packages/storefront-sdk/package.json'])

const files = git('ls-files', '*package.json').split('\n')
for (const file of files) {
  if (independent.has(file)) continue
  const raw = readFileSync(file, 'utf8')
  if (!/^\s*"version":/m.test(raw)) continue
  writeFileSync(file, raw.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${next}"`))
  console.log(`${file} → ${next}`)
}
console.log(`\nNext: commit, merge to main, then \`git tag v${next} && git push origin v${next}\``)
