#!/usr/bin/env node
// One command for local development: the TanStack Shopnex app + one storefront template.
//
//   pnpm dev                                     app (:3000) + the Shopnex storefront (:4321, templates/storefront)
//   STOREFRONT=<folder> pnpm dev                 pick another template (folder name in templates/)
//   STOREFRONT=none pnpm dev                     app only
//   STOREFRONT_PORT=4400 pnpm dev                template port
//   STRIPE=none pnpm dev                         skip a bundled app (apps/<name> runs when .env sets <NAME>_APP_URL)
//
// The template gets COMMERCE_PROVIDER=shopnex and SHOPNEX_URL automatically (unless already set).
// Ctrl+C (or either process exiting) stops both.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_TEMPLATE = 'storefront'
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'

const template = process.env.STOREFRONT ?? DEFAULT_TEMPLATE
const templatePort = process.env.STOREFRONT_PORT ?? '4321'
const templateDir = join(root, 'templates', template)

const color = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const fail = (message) => {
  console.error(color(31, `✖ ${message}`))
  process.exit(1)
}

// ── checks before starting anything ──────────────────────────────────────────
if (template !== 'none') {
  if (!existsSync(join(templateDir, 'package.json'))) {
    const available = readdirSync(join(root, 'templates')).filter((d) =>
      existsSync(join(root, 'templates', d, 'package.json')),
    )
    fail(`Unknown template "${template}". Available: ${available.join(', ') || '(none)'} — or STOREFRONT=none`)
  }
  const required = requiredNode(templateDir)
  if (required && !satisfies(process.versions.node, required)) {
    fail(
      `Template "${template}" needs Node ${required}, you have ${process.versions.node}.\n` +
        `  Run: nvm install && nvm use   (reads .nvmrc)   — or STOREFRONT=none pnpm dev for the app only`,
    )
  }
}

// ── processes ────────────────────────────────────────────────────────────────
const children = []
let stopping = false

function run(name, code, args, options = {}) {
  // detached → own process group, so stopping kills the whole tree (pnpm → next/astro → workers)
  const child = spawn('pnpm', args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  const prefix = color(code, `[${name}]`.padEnd(12))
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`${prefix} ${line}`))
  }
  child.on('exit', (exitCode, signal) => {
    if (!stopping) {
      console.log(`${prefix} exited (${signal ?? exitCode}) — stopping everything`)
      stop(exitCode ?? 1)
    }
  })
  children.push(child)
}

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  setTimeout(() => process.exit(exitCode), 1500).unref()
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

run('app', 36, ['--filter', '@shopnex/admin-ui', 'dev'])

// Bundled apps (apps/<name> on @shopnex/app, e.g. apps/stripe): each runs when .env sets <NAME>_APP_URL
const bundledApps = listBundledApps().filter((app) => process.env[app.envName] !== 'none')
for (const app of bundledApps) run(app.name, 34, ['--dir', app.dir, 'dev'])

if (template !== 'none') {
  run('storefront', 35, ['--dir', templateDir, 'dev', '--port', templatePort], {
    env: {
      ...process.env,
      COMMERCE_PROVIDER: process.env.COMMERCE_PROVIDER ?? 'shopnex',
      SHOPNEX_URL: process.env.SHOPNEX_URL ?? APP_URL,
    },
  })
}

console.log(
  color(1, '\nShopnex dev') +
    `\n  admin + API + checkout  ${APP_URL}/admin` +
    (template !== 'none' ? `\n  storefront (${template})  http://localhost:${templatePort}` : '') +
    bundledApps.map((app) => `\n  ${`${app.name} app`.padEnd(24)} ${app.url}`).join('') +
    '\n',
)

// ── helpers ──────────────────────────────────────────────────────────────────
// A value from the root .env (the apps read it themselves; this script only needs to know what to start)
function envFileValue(name) {
  if (process.env[name]) return process.env[name]
  const file = join(root, '.env')
  if (!existsSync(file)) return null
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim() || null
}

// Folders in apps/ built on @shopnex/app whose <NAME>_APP_URL is set (same env registerBundledApps reads)
function listBundledApps() {
  const appsDir = join(root, 'apps')
  return readdirSync(appsDir).flatMap((name) => {
    const file = join(appsDir, name, 'package.json')
    if (!existsSync(file)) return []
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (!pkg.dependencies?.['@shopnex/app']) return []
    const envName = name.toUpperCase().replace(/-/g, '_')
    const url = envFileValue(`${envName}_APP_URL`)
    return url ? [{ name, envName, dir: join(appsDir, name), url }] : []
  })
}

// Node requirement from the template's own engines, else from its framework (e.g. astro)
function requiredNode(dir) {
  const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
  const pkg = read(join(dir, 'package.json'))
  if (pkg?.engines?.node) return pkg.engines.node
  for (const dep of Object.keys(pkg?.dependencies ?? {})) {
    const engines = read(join(dir, 'node_modules', dep, 'package.json'))?.engines?.node
    if (engines && dep === 'astro') return engines
  }
  return null
}

// Supports the common ">=x.y.z" form; anything else is not checked
function satisfies(version, range) {
  const match = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range.trim())
  if (!match) return true
  const want = match.slice(1).map(Number)
  const have = version.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (have[i] !== want[i]) return have[i] > want[i]
  }
  return true
}
