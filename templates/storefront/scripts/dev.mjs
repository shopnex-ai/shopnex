#!/usr/bin/env node
// pnpm dev: rebuilds the themes' assets on change (scripts/themes.mjs) while `astro dev` serves the storefront.
// Arguments go to astro (e.g. --port 4321).
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildThemes } from './themes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stopThemes = await buildThemes({ watch: true })
const astro = spawn(join(root, 'node_modules/.bin/astro'), ['dev', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
})

async function stop(code = 0) {
  astro.kill()
  await stopThemes()
  process.exit(code)
}
astro.on('exit', (code) => stop(code ?? 0))
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
