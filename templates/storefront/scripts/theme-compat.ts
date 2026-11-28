// The theme compatibility check: compares the themes' structure in the working tree with a base branch, and fails when a
// change would orphan what merchants saved (a removed or renamed setting, section or block type, or a removed theme).
// The pull request check (.github/workflows/theme-compat.yaml) runs it; locally:
//
//   pnpm --filter shopnex-storefront themes:compat                 # against origin/main
//   pnpm --filter shopnex-storefront themes:compat -- --base v1.2.0
//
// Adding things is always fine. A break passes only when it is intended (`--allow`, the `breaking-theme-change` label)
// and the pull request adds a SQL migration for the data, in modules/db/migrations.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareThemes, describe, isBreaking, type ThemeFiles } from './theme-compat-lib'

const args = process.argv.slice(2)
const base = args.includes('--base') ? args[args.indexOf('--base') + 1]! : 'origin/main'
const allowed = args.includes('--allow')

const THEMES = 'templates/storefront/themes'
const MIGRATIONS = 'modules/db/migrations'
const run = (cwd: string | null, ...git: string[]) =>
  execFileSync('git', cwd ? ['-C', cwd, ...git] : git, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const root = run(null, 'rev-parse', '--show-toplevel').trim()
const fromBase = (path: string): string | null => {
  try {
    return run(root, 'show', `${base}:${path}`)
  } catch {
    return null // not in the base branch
  }
}
const themeIds = (text: string) => (JSON.parse(text) as { themes: string[] }).themes

const headIds = themeIds(readFileSync(join(root, THEMES, 'index.json'), 'utf8'))
const baseIndex = fromBase(`${THEMES}/index.json`)
const baseIds = baseIndex ? themeIds(baseIndex) : []

const head: ThemeFiles = {}
for (const id of headIds) head[id] = JSON.parse(readFileSync(join(root, THEMES, id, 'theme.json'), 'utf8'))
const before: ThemeFiles = {}
for (const id of baseIds) {
  const text = fromBase(`${THEMES}/${id}/theme.json`)
  if (text) before[id] = JSON.parse(text)
}

const comparison = compareThemes(before, head)
const summary = `## Theme structure changes against \`${base}\`\n\n${describe(comparison)}\n`
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)

if (!isBreaking(comparison)) process.exit(0)

const fail = (message: string): never => {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : `Error: ${message}`)
  process.exit(1)
}

if (!allowed) {
  fail(
    'This change removes or renames what a saved theme may hold, and nothing says why (listed above). ' +
      'If it is dropped on purpose, list its path in the theme\'s "removed". If merchants\' content should move, ' +
      'add a SQL migration for it (pnpm --filter @shopnex/db exec drizzle-kit generate --custom) and add the ' +
      '`breaking-theme-change` label.',
  )
}

const newMigrations = run(root, 'diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', MIGRATIONS)
  .split('\n')
  .filter((file) => file.endsWith('.sql'))
if (newMigrations.length === 0) {
  fail(
    'The breaking-theme-change label needs a migration for the saved data: this pull request adds none to ' +
      `${MIGRATIONS}. Add one (pnpm --filter @shopnex/db exec drizzle-kit generate --custom), or list the paths in ` +
      'the theme\'s "removed" if the content is dropped on purpose.',
  )
}
console.log(
  `${process.env.GITHUB_ACTIONS ? '::warning::' : ''}Breaking theme change, allowed by the label, with migration ${newMigrations.join(', ')}`,
)
