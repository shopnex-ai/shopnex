#!/usr/bin/env node
// `pnpm bundle:check` bundles, for the browser, everything the admin UI's client code takes from the server-side packages,
// and fails when server code comes along: a Node-only module (node:fs, node:async_hooks, ...), the database client, a
// module's service, router or manifest. The admin UI loads those bundles in the browser, where such code fails at runtime
// (`Buffer is not defined`) and only a browser test notices.
//
// It checks:
//   - every `@shopnex/...` entry that a .tsx file of apps/admin-ui imports (the client code; server functions are .ts);
//   - every module's `*.contract.ts` and `*.schema.ts`, which are meant to be safe for the browser.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const adminUi = join(root, 'apps/admin-ui')

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'dist') return []
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

// Files that must never end up in a browser bundle
const SERVER_ONLY = [
  /modules\/db\/src\/index\.ts$/,
  /modules\/[^/]+\/src\/[^/]+\.(service|router|module)\.ts$/,
  /node_modules\/(\.pnpm\/)?(pg@|pg\/|@electric-sql)/,
]

const entries = new Map() // label -> { stdin contents }
const specifier = /(?:from|import\()\s*'(@shopnex\/[^']+)'/g
for (const file of walk(join(adminUi, 'src')).filter((f) => f.endsWith('.tsx'))) {
  for (const match of readFileSync(file, 'utf8').matchAll(specifier)) entries.set(match[1], `import '${match[1]}'`)
}
for (const dir of readdirSync(join(root, 'modules'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const src = join(root, 'modules', dir.name, 'src')
  if (!existsSync(src)) continue
  for (const file of readdirSync(src).filter((f) => /\.(contract|schema)\.ts$/.test(f)))
    entries.set(relative(root, join(src, file)), `import '${join(src, file)}'`)
}

const problems = []
for (const [label, contents] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
  try {
    const result = await build({
      stdin: { contents, resolveDir: adminUi, loader: 'js' },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
    })
    const bad = Object.keys(result.metafile.inputs).filter((file) => SERVER_ONLY.some((pattern) => pattern.test(file)))
    if (bad.length) problems.push(`${label} pulls in server code: ${bad.slice(0, 3).join(', ')}`)
  } catch (error) {
    const first = error.errors?.[0]
    const where = first?.location ? ` (imported from ${first.location.file})` : ''
    problems.push(`${label} does not bundle for the browser: ${first?.text ?? error.message}${where}`)
  }
}

// A bare `import '@shopnex/x'` (no names) in the admin UI's own code. Server-function files (.ts) are imported by client code; the
// framework strips a handler, and the imports only it uses, from the browser bundle, but it keeps an import that has no names.
// That is how `import '@shopnex/content'` once took server code into the page and made every browser test time out. Load a
// module for its side effect inside the handler instead: `await import('@shopnex/x')`. (The server entry is not client code.)
const bare = /^import\s+'(@shopnex\/[^']+)'/gm
let bareImports = 0
for (const file of walk(join(adminUi, 'src')).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('/src/server.ts'))) {
  for (const match of readFileSync(file, 'utf8').matchAll(bare)) {
    bareImports++
    problems.push(
      `${relative(root, file)} has a bare \`import '${match[1]}'\`, which stays in the browser bundle: use \`await import()\` inside the server function`,
    )
  }
}

console.log(`${entries.size} browser entries checked, ${bareImports} bare workspace imports in the admin UI's code.`)
if (problems.length) {
  console.error(
    `\n${problems.length} with server code in the browser bundle:\n${problems.map((p) => `  ${p}`).join('\n')}`,
  )
  console.error(
    '\nA browser entry may import only the browser-safe parts of a module (/schema, /contract), never its root index,\nservice, router or manifest. See "What a module exposes" in docs/architecture.md.',
  )
  process.exit(1)
}
console.log('No server code in the browser bundles.')
