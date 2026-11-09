// The Configuration docs page is generated from ENV_VARS. This keeps it true: every variable the server reads
// must be listed (or be internal), and every listed variable must still be read.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ENV_VARS, INTERNAL_ENV_VARS } from '../src/env-vars'

const root = join(import.meta.dirname, '../../..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'tests') return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

const dirs = [
  ...readdirSync(join(root, 'modules')).map((m) => join(root, 'modules', m, 'src')),
  join(root, 'apps/admin-ui/src'),
].filter((d) => {
  try {
    return statSync(d).isDirectory()
  } catch {
    return false
  }
})

// process.env.NAME / import.meta.env.NAME (Vite), plus bundled apps' `urlEnv: 'X_APP_URL'`, which is read as process.env[urlEnv]
const used = new Set<string>()
for (const file of dirs.flatMap(sources)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/(?:process|import\.meta)\.env\.([A-Z][A-Z0-9_]*)/g)) used.add(m[1]!)
  for (const m of text.matchAll(/urlEnv:\s*'([A-Z][A-Z0-9_]*)'/g)) used.add(m[1]!)
}

const listed = new Set(ENV_VARS.map((v) => v.name))
const internal = new Set<string>(INTERNAL_ENV_VARS)

test('every variable the server reads is documented in ENV_VARS', () => {
  const missing = [...used].filter((n) => !listed.has(n) && !internal.has(n)).sort()
  assert.deepEqual(
    missing,
    [],
    `Add these to modules/api/src/env-vars.ts (or INTERNAL_ENV_VARS): ${missing.join(', ')}`,
  )
})

test('every variable in ENV_VARS is still read by the server', () => {
  const stale = ENV_VARS.filter((v) => !v.name.includes('<') && !used.has(v.name)).map((v) => v.name)
  assert.deepEqual(stale, [], `No longer read, remove from modules/api/src/env-vars.ts: ${stale.join(', ')}`)
})
